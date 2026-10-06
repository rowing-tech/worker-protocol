import { LEVELS, type LogFacts, type LogLevel } from "@worker-protocol/hono";
import { type DurableObjectClass, ensure, type Mixed, type Rpc } from "./durable.ts";

/**
 * LOG-2's window, in the Durable Object a Worker writes its records to.
 *
 * **Written on purpose, never captured.** There is no API in the Workers runtime for reading a
 * Worker's own `console` back, and this does not go looking for one: a Worker records what is worth
 * a line, in one call, the way it raises an event. A record written on purpose belongs to the work
 * that produced it; a `console` line scraped out of the runtime belongs to whichever isolate was
 * running.
 *
 * SQL, because a read filters by a level floor and a half-open interval (LOG-7, LOG-8), and a store
 * that cannot filter would hand the Worker every row so it could throw most of them away. `seq` is
 * what makes ENDP-33 free: it only grows, a cursor names one, and a page asks for what is below it,
 * so a record written since the last page cannot appear in the next.
 */

/** One record as it crosses the RPC boundary: an instant as a number, and `fields` flat (LOG-9). */
export type LogRow = {
  at: number;
  level: LogLevel;
  message: string;
  fields?: Record<string, string | number | boolean>;
};

const TABLES = [
  `CREATE TABLE IF NOT EXISTS wp_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    level TEXT NOT NULL,
    rank INTEGER NOT NULL,
    message TEXT NOT NULL,
    fields TEXT
  )`,
];

/** One page as the object answers it, before `durableLogs` turns instants into `Date`s. */
export type LogRows = { rows: LogRow[]; nextCursor?: string };

/** A read as the object takes it: `mount()`'s query, with the floor and the cursor as numbers. */
export type LogsQuery = {
  /** LOG-7. The floor: this level and every level above it. */
  minRank: number;
  /** ENDP-21. The position the caller's cursor named, or `null` for the first page. */
  before: number | null;
  from: number | null;
  to: number | null;
  limit: number;
};

/** What `withLogs` adds to a Durable Object. */
export interface LogMethods {
  record(rows: LogRow[]): void;
  logs(query: LogsQuery): LogRows;
}

export function withLogs<B extends DurableObjectClass>(
  Base: B,
  options: {
    /** LOG-2: how many records the window holds. The oldest go first. */
    keep: number;
  },
): Mixed<B, LogMethods> {
  abstract class WithLogs extends Base implements LogMethods {
    /** One write per call, whatever the line count — per line it would be a write per record. */
    record(rows: LogRow[]): void {
      const sql = ensure(this.ctx.storage.sql, TABLES);
      for (const row of rows) {
        sql.exec(
          "INSERT INTO wp_log (at, level, rank, message, fields) VALUES (?, ?, ?, ?, ?)",
          row.at,
          row.level,
          // LOG-5's ladder as a number, so that LOG-7's floor is a comparison the store can make.
          LEVELS.indexOf(row.level),
          row.message,
          row.fields === undefined ? null : JSON.stringify(row.fields),
        );
      }
      // A window rather than an archive, which is what makes the end of the collection mean *the
      // end of what this Worker still holds*.
      sql.exec("DELETE FROM wp_log WHERE seq <= (SELECT MAX(seq) FROM wp_log) - ?", options.keep);
    }

    /** LOG-3, LOG-7, LOG-8, ENDP-33 — one page, most recent first, in one query. */
    logs(query: LogsQuery): LogRows {
      const sql = ensure(this.ctx.storage.sql, TABLES);
      const found = sql
        .exec<{
          seq: number;
          at: number;
          level: LogLevel;
          message: string;
          fields: string | null;
        }>(
          `SELECT seq, at, level, message, fields FROM wp_log
            WHERE rank >= ?1
              AND (?2 IS NULL OR seq < ?2)
              AND (?3 IS NULL OR at >= ?3)
              AND (?4 IS NULL OR at < ?4)
            ORDER BY seq DESC
            LIMIT ?5`,
          query.minRank,
          query.before,
          query.from,
          query.to,
          // One more than asked for, which is how the cursor knows whether there IS a next page.
          query.limit + 1,
        )
        .toArray();
      const page = found.slice(0, query.limit);
      const rows = page.map((row) => ({
        at: row.at,
        level: row.level,
        message: row.message,
        ...(row.fields === null ? {} : { fields: JSON.parse(row.fields) as LogRow["fields"] }),
      }));
      // ENDP-20: the cursor exists exactly when the query found a row beyond the cap.
      const last = found.length > query.limit ? page.at(-1) : undefined;
      return last === undefined ? { rows } : { rows, nextCursor: String(last.seq) };
    }
  }
  return WithLogs;
}

/** What `durableLogs` needs of a stub: the read `withLogs` adds, over RPC. */
export type LogsRpc = Pick<Rpc<LogMethods>, "logs">;

/** `logs` for `mount()`, over the object with `withLogs`. `mount()` decodes the query. */
export const durableLogs = (stub: LogsRpc, options: { pageSize: number }): LogFacts => ({
  pageSize: options.pageSize,
  read: async ({ levels, from, to, cursor, limit }) => {
    const page = await stub.logs({
      // LOG-7's floor: the levels arrive in order, so the first is the lowest asked for.
      minRank: LEVELS.indexOf(levels[0] ?? "debug"),
      before: cursor === undefined ? null : Number(cursor),
      from: from?.getTime() ?? null,
      to: to?.getTime() ?? null,
      limit,
    });
    return {
      records: page.rows.map((row) => ({
        at: new Date(row.at),
        level: row.level,
        message: row.message,
        ...(row.fields === undefined ? {} : { fields: row.fields }),
      })),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  },
});

/**
 * What a Tail Worker records of the invocations it is handed: an exception nobody caught, and an
 * invocation that ended badly — the two things a Worker cannot record about itself, because by
 * then it has stopped running.
 *
 * **It throws `event.logs` away**, which is every `console` call the producer made: forwarding it
 * would be the capture `spec/logs.md` argues against. That filter is also what stops a tail from
 * feeding itself — its own write to the object is traced, comes back as `ok` with no exceptions,
 * and records nothing.
 */
export function tailRecords(events: TraceItem[]): LogRow[] {
  const lines: LogRow[] = [];
  for (const event of events) {
    const at = event.eventTimestamp ?? Date.now();
    const fields = { script: event.scriptName ?? "unknown", outcome: event.outcome };
    for (const thrown of event.exceptions) {
      lines.push({
        at: thrown.timestamp ?? at,
        level: "error",
        message: `uncaught ${thrown.name}: ${String(thrown.message)}`,
        fields,
      });
    }
    // `ok` says nothing an operator needs; `canceled` is a client that hung up, worth knowing when
    // it happens a hundred times an hour; `exceededCpu` is what nothing inside a Worker can report.
    if (event.outcome !== "ok" && event.exceptions.length === 0) {
      lines.push({
        at,
        level: event.outcome === "canceled" ? "warn" : "error",
        message: `the invocation ended \`${event.outcome}\``,
        fields,
      });
    }
  }
  return lines;
}

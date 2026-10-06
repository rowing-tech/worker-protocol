import type { Publishable } from "@worker-protocol/hono";
import {
  asJson,
  BATCH,
  type DurableObjectClass,
  type EnvOf,
  ensure,
  first,
  type Mixed,
} from "./durable.ts";

/**
 * An outbox, in every Durable Object whose changes raise events.
 *
 * **The row is written in the same operation as the change it reports.** `enqueue` is synchronous
 * SQL, so called from a domain method between the domain's own writes it lands in the same
 * transaction: there is no moment at which a Fact changed and its event was not yet owed. That is
 * what makes it an outbox rather than a send that might not happen.
 *
 * **It holds the whole event**, as `Publishable` JSON with its id, until it is sent. A Worker's own
 * retention then need not wait for what is pending — the copy lives for the seconds it takes to
 * leave. An id still waiting is not enqueued twice; once sent, the same id enqueued again is sent
 * again, which is a republication under the same `source` and `id` that a consumer remembering them
 * discards (EVT-8). A domain that writes `INSERT OR IGNORE` and enqueues only what it inserted
 * raises nothing twice at all.
 *
 * **It drains when the call ends, and retries by the one alarm.** The domain calls `flush()` at the
 * end of a method; what does not reach the events Queue stays, in order, and the alarm tries again
 * with a backoff. A Durable Object has one alarm, so the domain does not set its own: it asks with
 * `wakeAt(at)` and is called back at `wake()`, and the alarm fires at the earlier of the two. A base
 * class that sets the alarm itself does not compose with this one.
 */

/** One event on the events Queue: what was enqueued, with the id and instant the row kept. */
export type OutboxEvent = Publishable & { id: string; time: number };

/** What a `flush()` did: how many events left, and how many are still waiting. */
export type Flushed = { sent: number; pending: number };

const TABLES = [
  `CREATE TABLE IF NOT EXISTS wp_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    at INTEGER NOT NULL,
    event TEXT NOT NULL
  )`,
  // The instants the one alarm is shared between: `wake` is the domain's, `retry` the outbox's.
  `CREATE TABLE IF NOT EXISTS wp_alarm (
    name TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    attempts INTEGER NOT NULL
  )`,
];

/** The first retry of an outbox that could not be sent, and the longest wait between two. */
const RETRY_FIRST_MS = 5_000;
const RETRY_MOST_MS = 300_000;

/** The send in flight per object, so a call and the alarm never send the same rows at once. */
const inFlight = new WeakMap<DurableObjectStorage, Promise<Flushed>>();

const depthOf = (sql: SqlStorage): number =>
  sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM wp_outbox").one().n;

/** Whether a table exists, asked without creating it: after `deleteAll()` nothing should come back. */
const exists = (sql: SqlStorage, table: string): boolean =>
  first(sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table)) !==
  undefined;

/** Points the one alarm at the earliest instant anybody asked for, or clears it. */
async function settle(storage: DurableObjectStorage): Promise<void> {
  if (!exists(storage.sql, "wp_alarm")) return;
  const next = storage.sql
    .exec<{ at: number | null }>("SELECT MIN(at) AS at FROM wp_alarm")
    .one().at;
  const current = await storage.getAlarm();
  if (next === null) {
    if (current !== null) await storage.deleteAlarm();
    return;
  }
  if (current !== next) await storage.setAlarm(next);
}

async function drain(given: {
  storage: DurableObjectStorage;
  queue: Queue<OutboxEvent>;
}): Promise<Flushed> {
  const { storage, queue } = given;
  const sql = storage.sql;
  const retrying = (): boolean =>
    first(sql.exec("SELECT 1 FROM wp_alarm WHERE name = 'retry'")) !== undefined;
  // The common case: a call that raised nothing ends in a flush with nothing to send, and the
  // alarm has nothing to change. It is every write of every object, so it touches nothing else.
  if (depthOf(sql) === 0 && !retrying()) return { sent: 0, pending: 0 };
  let sent = 0;
  try {
    for (;;) {
      const rows = sql
        .exec<{ seq: number; id: string; at: number; event: string }>(
          "SELECT seq, id, at, event FROM wp_outbox ORDER BY seq LIMIT ?",
          BATCH,
        )
        .toArray();
      const last = rows.at(-1);
      if (last === undefined) break;
      await queue.sendBatch(
        asJson(
          rows.map((row) => ({
            ...(JSON.parse(row.event) as Publishable),
            id: row.id,
            time: row.at,
          })),
        ),
      );
      // Up to the last row sent and no further: a row enqueued during the send has a later `seq`.
      sql.exec("DELETE FROM wp_outbox WHERE seq <= ?", last.seq);
      sent += rows.length;
    }
    sql.exec("DELETE FROM wp_alarm WHERE name = 'retry'");
    await settle(storage);
    return { sent, pending: 0 };
  } catch {
    // What did not go stays, in order, and the alarm tries again: sooner the first time, never
    // more often than every five minutes, so a Queue that is down for an hour is not woken
    // thousands of times by thousands of objects.
    if (!exists(sql, "wp_alarm")) return { sent, pending: 0 };
    const held = first(
      sql.exec<{ attempts: number }>("SELECT attempts FROM wp_alarm WHERE name = 'retry'"),
    );
    const attempts = held?.attempts ?? 0;
    const wait = Math.min(RETRY_FIRST_MS * 2 ** attempts, RETRY_MOST_MS);
    sql.exec(
      "INSERT OR REPLACE INTO wp_alarm (name, at, attempts) VALUES ('retry', ?, ?)",
      Date.now() + wait,
      attempts + 1,
    );
    await settle(storage);
    return { sent, pending: depthOf(sql) };
  }
}

/** What `withOutbox` adds to a Durable Object. */
export interface OutboxMethods {
  enqueue(at: number, events: Publishable[]): void;
  outbox(): { depth: number; oldestAt: number | null };
  flush(): Promise<Flushed>;
  wakeAt(at: number | null): Promise<void>;
  wake(): void | Promise<void>;
  alarm(): Promise<void>;
}

export function withOutbox<B extends DurableObjectClass>(
  Base: B,
  options: {
    /**
     * The events Queue `flush()` sends to, whose consumer fans each event out (`consumeQueues`).
     * Resolved on every flush rather than once, so it reads whatever `env` the object holds then.
     */
    events: (env: EnvOf<B>) => Queue<OutboxEvent>;
  },
): Mixed<B, OutboxMethods> {
  abstract class WithOutbox extends Base implements OutboxMethods {
    /**
     * Owes each event, in the transaction the calling method is already in.
     *
     * `at` is when the Fact changed, for an event that does not carry its own `time`. An event
     * whose `id` is still waiting is not enqueued again. Public only because TypeScript cannot
     * emit a mixin's protected members; over RPC it would lose the transaction that is its point.
     */
    enqueue(at: number, events: Publishable[]): void {
      const sql = ensure(this.ctx.storage.sql, TABLES);
      for (const one of events) {
        const { id, time, ...rest } = one;
        const when = time === undefined ? at : typeof time === "number" ? time : time.getTime();
        sql.exec(
          "INSERT OR IGNORE INTO wp_outbox (id, at, event) VALUES (?, ?, ?)",
          id ?? crypto.randomUUID(),
          when,
          JSON.stringify(rest),
        );
      }
    }

    /** How deep the outbox is and when its oldest event was raised, which `health` may report. */
    outbox(): { depth: number; oldestAt: number | null } {
      const sql = ensure(this.ctx.storage.sql, TABLES);
      const row = sql
        .exec<{ n: number; oldest: number | null }>(
          "SELECT COUNT(*) AS n, MIN(at) AS oldest FROM wp_outbox",
        )
        .one();
      return { depth: row.n, oldestAt: row.oldest };
    }

    /**
     * Sends what is waiting to the events Queue, in order, a hundred at a time. Never rejects: what
     * could not be sent stays and the alarm is pointed at a retry. A send already in flight is
     * joined rather than repeated.
     */
    flush(): Promise<Flushed> {
      const storage = this.ctx.storage;
      ensure(storage.sql, TABLES);
      const running =
        inFlight.get(storage) ??
        drain({ storage, queue: options.events(this.env as EnvOf<B>) }).finally(() =>
          inFlight.delete(storage),
        );
      inFlight.set(storage, running);
      return running;
    }

    /** The domain's own alarm, sharing the one this object has. `null` withdraws it. */
    async wakeAt(at: number | null): Promise<void> {
      const storage = this.ctx.storage;
      ensure(storage.sql, TABLES);
      if (at === null) storage.sql.exec("DELETE FROM wp_alarm WHERE name = 'wake'");
      else {
        storage.sql.exec(
          "INSERT OR REPLACE INTO wp_alarm (name, at, attempts) VALUES ('wake', ?, 0)",
          at,
        );
      }
      await settle(storage);
    }

    /** What the domain does when the instant it asked for with `wakeAt` comes. Nothing, unless overridden. */
    wake(): void | Promise<void> {}

    /**
     * The one alarm: the outbox first, then the domain's `wake()` if its instant has come. The
     * domain overrides `wake()`, never this. `wake()` may empty the object with `deleteAll()`, and
     * nothing here writes to it afterwards; if it throws, its instant stays and the platform's own
     * retry of the alarm calls it again.
     */
    async alarm(): Promise<void> {
      const storage = this.ctx.storage;
      const sql = storage.sql;
      ensure(sql, TABLES);
      const now = Date.now();
      if (depthOf(sql) > 0) await this.flush();
      const wake = first(sql.exec<{ at: number }>("SELECT at FROM wp_alarm WHERE name = 'wake'"));
      if (wake !== undefined && wake.at <= now) {
        await this.wake();
        // Only the instant that fired: a `wake()` that asked again with `wakeAt` keeps its answer.
        if (exists(sql, "wp_alarm")) {
          sql.exec("DELETE FROM wp_alarm WHERE name = 'wake' AND at = ?", wake.at);
        }
      }
      await settle(storage);
    }
  }
  return WithOutbox;
}

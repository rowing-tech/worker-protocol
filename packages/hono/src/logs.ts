/**
 * The `logs` surface: every rule in `spec/logs.md` that is not a record.
 *
 * What a Worker knows is what it wrote down. What it would otherwise write is the parameter
 * validation, the level ladder LOG-7 reads a floor off, the half-open interval, the instant's
 * format and the page envelope — all of it fixed by LOG-2 through LOG-10 and identical in every
 * Worker. So this hands a Worker a decoded query and answers the rest itself.
 *
 * **The read is the Worker's and not this module's, and it is the only surface here where that is
 * true.** `alerts` and `activity` hand over a whole list because what they hold is bounded by what
 * is happening now; `metrics` hands over values over buckets this package cut. Both are paged here.
 * A feed is neither: a Worker keeping a day of records cannot load them to answer one page, so the
 * filtering belongs to whatever store holds them.
 *
 * **The cursor is the Worker's for a second reason, and it is the one that matters.** Every other
 * collection here is paged by `collection()`, which can mint a cursor because every item it pages
 * carries an `id`. LOG-4 gives a record no identity — an instant, a level, a message, and LOG-6
 * says the instant does not even order them — so there is nothing in a record for this package to
 * name a position with. The Worker names it, because only the Worker's store has a key.
 *
 * What a Worker therefore still owes: LOG-3's order and ENDP-33's cursor. Both are properties of a
 * query against a store this package never sees, and both come free from keying that store on
 * something that only grows.
 */

import { logLevel, type logPage } from "@worker-protocol/schemas";
import type * as z from "zod";
import { halfOpen, rfc3339 } from "./buckets.ts";
import type { ErrorCode } from "./codes.ts";
import { onlyKnown } from "./collection.ts";
import type { Refusal } from "./worker.ts";

/** LOG-5. The four levels, in order. The ladder LOG-7's floor is read off. */
export const LEVELS = logLevel.options;

export type LogLevel = (typeof LEVELS)[number];

/** LOG-4, LOG-9 — one record, as a Worker hands it over: a `Date`, and nothing serialized. */
export type LogRecord = {
  /** LOG-4. When the Worker recorded it. LOG-6: it does not establish the order. */
  at: Date;
  level: LogLevel;
  /** LOG-4. For a person. Nothing parses it. */
  message: string;
  /** LOG-9. One level deep, values scalar. Absent is the ordinary case. */
  fields?: Record<string, string | number | boolean | null>;
};

/** What a Worker is asked for: a page of its own store, over a query it did not have to decode. */
export type LogQuery = {
  /**
   * LOG-7. The levels this read answers — the one the caller named and every one above it, in
   * order. Expanded here so that a Worker never re-derives the ladder: it is a set to match, or
   * the tail of one, whichever its store finds cheaper.
   */
  levels: LogLevel[];
  /** LOG-8. Inclusive, where the caller sent one. */
  from?: Date;
  /** LOG-8. Exclusive, where the caller sent one — so two adjacent reads add up and overlap in none. */
  to?: Date;
  /** ENDP-21. Exactly the string this Worker last answered as `nextCursor`, or absent for the first page. */
  cursor?: string;
  /** ENDP-19. The most records one page carries. */
  limit: number;
};

/**
 * One page, as the Worker answers it.
 *
 * The cursor is the Worker's because the position it names is a position in the Worker's store —
 * ENDP-21 asks only that a caller never construct one, and a caller never sees inside this. ENDP-33
 * is what it owes in return: a page reached through one carries only records older than the
 * position it names.
 */
export type LogPage = {
  /** LOG-3. Most recent first. The order is the Worker's and nothing here re-sorts it. */
  records: LogRecord[];
  /** ENDP-20. Absent at the end of what the Worker still holds — absent, not null. */
  nextCursor?: string;
};

export type LogFacts = {
  /** The Worker's own store. Everything around this call is the specification's. */
  read: (query: LogQuery) => LogPage | Refusal | Promise<LogPage | Refusal>;
  /** ENDP-19 (recommended). The most records one page carries. */
  pageSize?: number;
};

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/** LOG-7, LOG-8, ENDP-20 — what this read defines. Anything else is ENDP-24's. */
const OWN_PARAMETERS = new Set(["level", "from", "to", "cursor"]);

export function logs(facts: LogFacts) {
  const cap = facts.pageSize ?? 100;

  return async function read(query: URLSearchParams): Promise<Refusal | z.infer<typeof logPage>> {
    const unknown = onlyKnown(query, OWN_PARAMETERS);
    if (unknown !== null) return unknown;

    // LOG-7: one parameter naming a floor, because the filter an operator applies is *stop showing
    // me the ordinary ones*. Absent, the floor is the bottom of the ladder and nothing is excluded.
    const asked = (query.get("level") ?? LEVELS[0]) as LogLevel;
    const floor = LEVELS.indexOf(asked);
    if (floor < 0) {
      return refuse("invalid_parameter", `A level is one of: ${LEVELS.join(", ")}.`);
    }

    // LOG-8: MET-11's interval, parsed by MET-11's code. One rule, one spelling.
    const interval = halfOpen(query);
    if (interval === null) {
      return refuse("invalid_parameter", "`from` and `to` are RFC 3339 instants with an offset.");
    }
    const at = (ms: number | null) => (ms === null ? undefined : new Date(ms));

    const answered = await facts.read({
      levels: LEVELS.slice(floor),
      from: at(interval.from),
      to: at(interval.to),
      cursor: query.get("cursor") ?? undefined,
      limit: cap,
    });
    if ("code" in answered) return answered;

    // The page is not truncated to the cap here, and that is deliberate. Slicing would strand every
    // record past the cut: the cursor the Worker answered names a position beyond them, so nothing
    // would ever reach them again and the caller would never learn they existed. ENDP-19 is a
    // recommendation, the cap is handed over as `limit`, and a Worker that ignores it answers a
    // large page rather than a wrong one.
    const items = answered.records.map((record) => ({
      at: rfc3339(record.at),
      level: record.level,
      message: record.message,
      // Absent rather than `undefined` on the wire: `JSON.stringify` drops the key either way.
      fields: record.fields,
    }));

    // ENDP-20: absent at the end of the collection — absent, not null.
    return answered.nextCursor === undefined
      ? { items }
      : { items, nextCursor: answered.nextCursor };
  };
}

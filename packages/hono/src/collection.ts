/**
 * The page envelope every collection surface answers in, in one place.
 *
 * ENDP-19's cap, ENDP-20's envelope and its absent cursor, ENDP-21's opaque cursor and ENDP-23's
 * order are the protocol's, not a Worker's, and they were written out three times: once inside
 * `tasks.ts`, and once inline per handler for `alerts` and `activity` — which carried neither the
 * cursor nor the cap, while `openapi/` published a `cursor` parameter both of them refused with
 * `unknown_filter`. A document that describes a call the Worker will not take is the fault this
 * repository names everywhere else, and one implementation is what stops it recurring.
 *
 * What a surface still owns is what it filters on and what its items look like. This carries the
 * rest.
 */

import { rfc3339 } from "./buckets.ts";
import type { ErrorCode } from "./codes.ts";
import type { Refusal } from "./worker.ts";

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/** One page: the items as they travel, and ENDP-20's cursor where there is more. */
export type Page = { items: Record<string, unknown>[]; nextCursor?: string };

/** ENDP-19 (recommended). A Worker caps rather than negotiating; this is the cap when none is set. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * One page of a collection, ordered, cut and serialized.
 *
 * The cursor is an offset spelled as a string, which satisfies ENDP-21 without pretending to more:
 * it is produced only here, a caller sends back what it was given, and anything else is refused as
 * a parameter this Worker did not mint. ENDP-23's order is by `id` — minted by the Worker and the
 * one field every collection here has that nothing else reorders — so paging terminates.
 */
export function collection<T extends { id: string; since: Date }>(
  items: T[],
  query: URLSearchParams,
  serialize: (one: T) => Record<string, unknown>,
  pageSize = DEFAULT_PAGE_SIZE,
  /** What this surface defines beyond the cursor — TASK-8's `type` is the only one today. */
  filters: readonly string[] = [],
): Refusal | Page {
  // ENDP-24: an unrecognized filter is `400` and is never ignored. A filter dropped in silence
  // answers with MORE than the caller asked for, in a shape it will happily parse. It is checked
  // here rather than by a middleware because a surface that reads a cursor has to opt out of the
  // one that refuses every parameter, and opting out must not mean opting out of this.
  const defined = new Set(["cursor", ...filters]);
  for (const key of query.keys()) {
    if (!defined.has(key)) {
      return refuse("unknown_filter", `This address takes no parameter named ${key}.`);
    }
  }

  const from = Number(query.get("cursor") ?? "0");
  if (!Number.isInteger(from) || from < 0) {
    return refuse("invalid_parameter", "That cursor was not produced by this Worker.");
  }

  // Mapped before sorted, so the copy the ordering needs is the one the serialization already made
  // — `sort` mutates, and the array handed in is the Worker's own.
  const ordered = items
    .map((one) => ({ id: one.id, row: serialize(one) }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const next = from + pageSize;
  const page = ordered.slice(from, next).map((one) => one.row);
  // ENDP-20: the cursor is absent at the end of the collection — absent, not null.
  return next < ordered.length ? { items: page, nextCursor: String(next) } : { items: page };
}

/**
 * The instant every item in this protocol carries, serialized once.
 *
 * TASK-28, ALRT-3 and ACTV-3 all fix an RFC 3339 instant with an offset, and a Worker hands each
 * of them a `Date` — so no Worker writes the format and no surface here writes it twice.
 */
export const serializeSince = <T extends { since: Date }>(one: T): Record<string, unknown> => ({
  ...one,
  since: rfc3339(one.since),
});

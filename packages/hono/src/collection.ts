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

/**
 * ENDP-24 — a parameter this surface did not define is `400`, and is never ignored.
 *
 * Here rather than per surface because a filter dropped in silence answers with MORE than the
 * caller asked for, in a shape it will happily parse, and that is one sentence rather than one per
 * address. A surface that reads a cursor has to opt out of the middleware that refuses every
 * parameter, and opting out must not mean opting out of this.
 */
export const onlyKnown = (query: URLSearchParams, defined: Set<string>): Refusal | null => {
  for (const key of query.keys()) {
    if (!defined.has(key)) {
      return refuse("unknown_filter", `This address takes no parameter named ${key}.`);
    }
  }
  return null;
};

/** One page: the items as they travel, and ENDP-20's cursor where there is more. */
export type Page = { items: Record<string, unknown>[]; nextCursor?: string };

/** ENDP-19 (recommended). A Worker caps rather than negotiating; this is the cap when none is set. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * ENDP-21 — the cursor, which names a POSITION in the order and never a count into it.
 *
 * That distinction is ENDP-33, and it is the whole reason this is not a number. Every collection in
 * this protocol is derived on each read — an Alert fires, a Task's condition stops holding — so a
 * count is a count into a list that is not the list the caller was paging. Two items appearing
 * above an offset push two the caller already saw into the next page; two disappearing skip two it
 * will never see, and neither is visible to the caller. A position has neither failure: the next
 * page asks for what is beyond it, so nothing that arrived meanwhile can be inside it.
 *
 * It is encoded rather than handed over bare because ENDP-21 has a caller never construct one, and
 * an id a caller can read off a page is an id a caller will build a cursor out of. `encodeURI`
 * first, because `btoa` takes Latin-1 and an id is any string a Worker minted.
 */
const MINTED = "wp\u0000";

export const encodeCursor = (id: string): string =>
  btoa(encodeURIComponent(MINTED + id)).replaceAll("=", "");

/**
 * The other half of ENDP-21: a cursor this Worker did not mint is refused rather than acted on.
 *
 * The tag is what makes that checkable. Without it, any string that happened to be base64 would
 * decode to *something* and the Worker would answer a page for a position a caller invented —
 * which is the format lock-in ENDP-21 exists to prevent, arrived at by accident.
 */
export const decodeCursor = (cursor: string): string | null => {
  try {
    const decoded = decodeURIComponent(atob(cursor));
    return decoded.startsWith(MINTED) ? decoded.slice(MINTED.length) : null;
  } catch {
    return null;
  }
};

/**
 * One page of a collection, ordered, cut and serialized.
 *
 * ENDP-23's order is by `id` — minted by the Worker and the one field every collection here has
 * that nothing else reorders — so paging terminates, and ENDP-33 comes free from it: the cursor
 * names the last id the page carried, and the page after it holds ids strictly greater.
 */
export function collection<T extends { id: string; since: Date }>(
  items: T[],
  query: URLSearchParams,
  serialize: (one: T) => Record<string, unknown>,
  pageSize = DEFAULT_PAGE_SIZE,
  /** What this surface defines beyond the cursor — TASK-8's `type` is the only one today. */
  filters: readonly string[] = [],
): Refusal | Page {
  const unknown = onlyKnown(query, new Set(["cursor", ...filters]));
  if (unknown !== null) return unknown;

  const sent = query.get("cursor");
  const after = sent === null ? null : decodeCursor(sent);
  if (sent !== null && after === null) {
    return refuse("invalid_parameter", "That cursor was not produced by this Worker.");
  }

  // Mapped before sorted, so the copy the ordering needs is the one the serialization already made
  // — `sort` mutates, and the array handed in is the Worker's own.
  const ordered = items
    .map((one) => ({ id: one.id, row: serialize(one) }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // ENDP-33: everything beyond the position, which is where the last page stopped. A cursor whose
  // id no longer exists is not an error — the item it named ended between two reads, which is
  // ordinary — and paging carries on from where it would have been.
  const rest = after === null ? ordered : ordered.filter((one) => one.id.localeCompare(after) > 0);
  const page = rest.slice(0, pageSize);
  const last = page.at(-1);
  // ENDP-20: the cursor is absent at the end of the collection — absent, not null.
  return rest.length > pageSize && last !== undefined
    ? { items: page.map((one) => one.row), nextCursor: encodeCursor(last.id) }
    : { items: page.map((one) => one.row) };
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

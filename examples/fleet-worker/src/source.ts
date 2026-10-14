import type { CycleConfig } from "./config.ts";
import type { Reading } from "./quiet.ts";

/**
 * The poll, and the mapping from what the source says to what this Worker records.
 *
 * **It runs in the Worker in front of the Durable Object, never inside it, and that is a rule
 * rather than a preference.** A Durable Object holds incoming requests while a storage operation is
 * outstanding, and lets them through while it awaits an outbound `fetch`: a cycle that read the
 * source from inside the object would let an inspection, a subscription or a read interleave under
 * it, and would keep the object running — and billed — for as long as the source took to answer.
 * Read here, the object is entered once, with the readings already in hand, and `ingest` writes them
 * in one transaction.
 */

/** The `fetch` a poll uses: the global one in a deployment, a fake in a test. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The source answered, but not with something this Worker can read. */
export class UpstreamError extends Error {
  override name = "UpstreamError";
}

/** What one poll read: the readings, how many entries the source sent, and what was dropped. */
export type Poll = {
  readings: Reading[];
  seen: number;
  /** Entries the mapping could not read: a unit with no name, or an instant that does not parse. */
  dropped: number;
};

/**
 * Reads the source and maps it.
 *
 * The source answers `{ "positions": [{ "unit": "ABC-123", "lastReportAt": "<RFC 3339>" }] }` —
 * a stand-in for a GPS provider, and the shape is the provider's, not the protocol's. An entry this
 * cannot read is dropped and counted rather than failing the cycle: one malformed unit should not
 * stop the rest of the fleet being recorded, and the count is what tells an operator it happened.
 */
export async function poll(given: { config: CycleConfig; fetch: Fetch }): Promise<Poll> {
  const { config } = given;
  const response = await given.fetch(config.sourceUrl.toString(), {
    headers: {
      accept: "application/json",
      ...(config.sourceToken === undefined
        ? {}
        : { authorization: `Bearer ${config.sourceToken}` }),
    },
  });
  if (!response.ok) throw new UpstreamError(`the source answered ${response.status}`);
  let document: unknown;
  try {
    document = await response.json();
  } catch {
    throw new UpstreamError("the source answered something that is not JSON");
  }
  const positions = (document as { positions?: unknown } | null)?.positions;
  if (!Array.isArray(positions)) throw new UpstreamError("the source answered no `positions`");

  const readings: Reading[] = [];
  for (const entry of positions) {
    const { unit, lastReportAt } = (entry ?? {}) as { unit?: unknown; lastReportAt?: unknown };
    const at = typeof lastReportAt === "string" ? Date.parse(lastReportAt) : Number.NaN;
    if (typeof unit === "string" && unit.length > 0 && Number.isFinite(at)) {
      readings.push({ vehicle: unit, at });
    }
  }
  return { readings, seen: positions.length, dropped: positions.length - readings.length };
}

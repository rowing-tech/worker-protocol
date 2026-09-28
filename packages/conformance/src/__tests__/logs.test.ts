import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkLogs } from "../checks/logs.ts";
import { universe } from "../index.ts";
import { transcript } from "../transcript.ts";

/**
 * LOG-8 against a feed whose records sit exactly where the boundary is decided.
 *
 * The check sends an instant sixty seconds back, and `iso()` writes it without milliseconds. It
 * used to compare against the instant before that rounding, so a record in the fraction between the
 * two was right on both reads and failed one of them — and whether a Worker held one depended on the
 * millisecond the check started in. The clock is pinned here so that it is always inside it.
 */

/** 700 ms past a whole second, so the fraction `iso()` drops is wide enough to hold a record in. */
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0, 700);
/** The whole second LOG-8 sends: sixty seconds before `NOW`, without the 700 ms. */
const BOUNDARY = NOW - 60_000 - 700;

type Bounds = {
  from: (at: number, bound: number) => boolean;
  to: (at: number, bound: number) => boolean;
};

/** LOG-8: `from` inclusive, `to` exclusive. */
const HALF_OPEN: Bounds = { from: (at, bound) => at >= bound, to: (at, bound) => at < bound };

/** A Worker's `/logs`, holding records at the given instants and bounding them as it is told. */
const feed =
  (held: number[], bounds: Bounds = HALF_OPEN): typeof globalThis.fetch =>
  async (input) => {
    const query = new URL(input instanceof Request ? input.url : String(input)).searchParams;
    const from = query.get("from");
    const to = query.get("to");
    const items = held
      .filter((at) => from === null || bounds.from(at, Date.parse(from)))
      .filter((at) => to === null || bounds.to(at, Date.parse(to)))
      .sort((a, b) => b - a)
      .map((at) => ({ at: new Date(at).toISOString(), level: "info", message: "held" }));
    return Response.json({ items });
  };

const log8 = async (fetch: typeof globalThis.fetch) => {
  const { rules, attribution } = await universe();
  const results = await checkLogs(
    { version: 1, address: "../logs" },
    "https://worker.invalid/logs",
    new Map(rules.map((rule) => [rule.id, rule])),
    attribution,
    transcript(fetch),
  );
  return results.find((result) => result.rule.id === "LOG-8");
};

describe("LOG-8, at the boundary it sends", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a Worker holding a record inside the second the boundary rounds away", async () => {
    // At or after the boundary sent, so `from` is right to answer it, and before the unrounded
    // instant — which is where the check used to look, and why it failed this Worker.
    const result = await log8(feed([BOUNDARY + 200, NOW - 1_000, BOUNDARY - 5_000]));
    expect(result?.verdict).toBe("passes");
  });

  it("fails a `to` that answers the record at the boundary itself", async () => {
    // The other side of the same rounding: compared against the unrounded instant, this record was
    // before it, and an inclusive `to` passed.
    const inclusive: Bounds = { ...HALF_OPEN, to: (at, bound) => at <= bound };
    const result = await log8(feed([BOUNDARY, BOUNDARY - 5_000], inclusive));
    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toMatch(/`to` answered a record at or after it/);
  });

  it("fails a `from` that answers a record before the boundary", async () => {
    const early: Bounds = { ...HALF_OPEN, from: (at, bound) => at >= bound - 1_000 };
    const result = await log8(feed([BOUNDARY - 500, NOW - 1_000], early));
    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toMatch(/`from` answered a record before it/);
  });
});

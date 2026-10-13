import { describe, expect, it } from "vitest";
import { checkMetrics } from "../checks/metrics.ts";
import { universe } from "../index.ts";
import { transcript } from "../transcript.ts";

/**
 * ENDP-23 against a metric that is being counted while it is read.
 *
 * The check used to compare two reads byte for byte and call any difference an order that moved.
 * Against a deployed Worker the current day kept accumulating between the two reads, a second apart,
 * and a value going from 5916 to 5917 was reported as buckets answered in a different order. A
 * metric declares its order — ascending by start (MET-14) — and that is what is judged now.
 */

const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY) * DAY;
const bucket = (start: number, value: number) => ({
  start: new Date(start).toISOString(),
  end: new Date(start + DAY).toISOString(),
  value,
});

/** A Worker's `/metrics`, answering each read of the month with the next of `reads`. */
const counting = (reads: ReturnType<typeof bucket>[][]): typeof globalThis.fetch => {
  let read = 0;
  return async (input) => {
    const query = new URL(input instanceof Request ? input.url : String(input)).searchParams;
    if (query.get("metric") !== "documents-processed") {
      return Response.json({ code: "not_found", class: "reject", message: "no" }, { status: 404 });
    }
    if (query.get("granularity") === "fortnight") {
      return Response.json(
        { code: "invalid_parameter", class: "reject", message: "no" },
        { status: 400 },
      );
    }
    if (query.get("from") === null) return Response.json({ items: [] });
    const items = reads[Math.min(read, reads.length - 1)] ?? [];
    read += 1;
    return Response.json({ items });
  };
};

const endp23 = async (fetch: typeof globalThis.fetch) => {
  const { rules, attribution } = await universe();
  const results = await checkMetrics(
    {
      version: 1,
      address: "../metrics",
      timeZone: "UTC",
      publishes: {
        "documents-processed": {
          unit: "documents",
          additive: true,
          granularities: ["day"],
          dimensions: {},
        },
      },
    },
    "https://worker.invalid/metrics",
    new Map(rules.map((rule) => [rule.id, rule])),
    attribution,
    transcript(fetch),
  );
  return results.find((result) => result.rule.id === "ENDP-23");
};

describe("ENDP-23, on a metric counted between two reads", () => {
  it("passes when only the current bucket's value moved", async () => {
    const result = await endp23(
      counting([
        [bucket(today - DAY, 40), bucket(today, 5916)],
        [bucket(today - DAY, 40), bucket(today, 5917)],
      ]),
    );
    expect(result?.verdict).toBe("passes");
  });

  it("passes when a bucket was born between them", async () => {
    // A day that accumulated nothing is absent (MET-15) until the first thing lands in it.
    const result = await endp23(
      counting([[bucket(today - DAY, 40)], [bucket(today - DAY, 40), bucket(today, 1)]]),
    );
    expect(result?.verdict).toBe("passes");
  });

  it("fails a read whose buckets are not ascending by start", async () => {
    const result = await endp23(
      counting([
        [bucket(today, 5916), bucket(today - DAY, 40)],
        [bucket(today, 5916), bucket(today - DAY, 40)],
      ]),
    );
    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toMatch(/comes after a later one/);
  });
});

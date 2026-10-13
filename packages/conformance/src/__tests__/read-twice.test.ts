import { describe, expect, it } from "vitest";
import { callSurfaces } from "../checks/surfaces.ts";
import { universe } from "../index.ts";
import { transcript } from "../transcript.ts";

/**
 * ENDP-2 against collections that change on their own.
 *
 * The check reads each collection twice and calls a loss with nothing gained a read that consumed
 * what it read. Against a deployed Worker an asynchronous job finished between the two reads of
 * `activity`, which a Worker is right to stop listing (ACTV-7), and the check failed it. A loss is
 * now confirmed on a second pair of reads, which a read that consumes would lose again and the world
 * would not.
 */

/** A Worker's `/activity`, answering each read with the next of `reads`, the last one thereafter. */
const answering = (reads: string[][]): typeof globalThis.fetch => {
  let read = 0;
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.searchParams.has("no-such-filter-8e31")) {
      return Response.json(
        { code: "unknown_filter", class: "reject", message: "no" },
        { status: 400 },
      );
    }
    const ids = reads[Math.min(read, reads.length - 1)] ?? [];
    read += 1;
    return Response.json({ items: ids.map((id) => ({ id })) });
  };
};

const endp2 = async (fetch: typeof globalThis.fetch) => {
  const { rules } = await universe();
  const results = await callSurfaces(
    [{ capability: "activity", url: "https://worker.invalid/activity" }],
    "https://worker.invalid/.well-known/worker-protocol",
    [],
    new Map(rules.map((rule) => [rule.id, rule])),
    transcript(fetch),
    undefined,
    false,
  );
  return results.find((result) => result.rule.id === "ENDP-2");
};

describe("ENDP-2, on a collection that changes on its own", () => {
  it("does not fail a job that finished between the reads, with others still held", async () => {
    // The first pair loses `job-1`, which finished; the second pair holds what it read.
    const result = await endp2(answering([["job-1", "job-2"], ["job-2"], ["job-2"], ["job-2"]]));
    expect(result?.verdict).toBe("passes");
  });

  it("does not fail the only job finishing, and says it could not tell", async () => {
    // The case reproduced in production: one item, gone, and nothing left to read again.
    const result = await endp2(answering([["reprocess-1"], []]));
    expect(result?.verdict).toBe("notExercised");
    expect(result?.detail).toMatch(/held nothing to read again/);
  });

  it("fails a read that consumes what it read, seen on both pairs", async () => {
    // Every read empties what the one before it answered, and something new keeps arriving to be
    // consumed, so the second pair loses again.
    const result = await endp2(answering([["a", "b"], ["a"], ["c", "d"], ["c"]]));
    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toMatch(/on two pairs of reads/);
  });
});

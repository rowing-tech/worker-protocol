import type { Recorded } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import { durableOutcomes } from "../src/index.ts";
import { whole } from "./outbound.ts";

/** ENDP-16's store, over a Durable Object of the test's own. */
const store = () => durableOutcomes(whole());

const later = () => Date.now() + 60_000;

describe("withOutcomes", () => {
  it("reserves a key once, and answers the outcome recorded under it (ENDP-16)", async () => {
    const outcomes = store();
    expect(await outcomes.begin("k", later())).toBe("reserved");
    expect(await outcomes.begin("k", later())).toBe("in-flight");

    const recorded: Recorded = {
      body: "{}",
      answer: { status: 200, body: { ok: true } },
      until: later(),
    };
    await outcomes.complete("k", recorded);
    expect(await outcomes.begin("k", later())).toEqual({ held: recorded });
  });

  it("gives a key back when released, and when its reservation expires", async () => {
    const outcomes = store();
    await outcomes.begin("released", later());
    await outcomes.release("released");
    expect(await outcomes.begin("released", later())).toBe("reserved");

    // A request that died between `begin` and `complete` holds the key only until `until`.
    await outcomes.begin("abandoned", Date.now() - 1);
    expect(await outcomes.begin("abandoned", later())).toBe("reserved");
  });
});

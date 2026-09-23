import { env } from "cloudflare:workers";
import { LEVELS } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";
import tail from "../src/tail.ts";

/**
 * The Tail Worker, over the same Durable Object the producer writes to.
 *
 * The handler is called directly rather than through a deployment, because a tail consumer is
 * driven by Cloudflare and not by a request: what is worth testing is the decision it makes about
 * each event, which is the part this repository wrote. The binding and the delivery are the
 * platform's, and `wrangler.tail.jsonc` is where they are declared.
 */

/** A Durable Object of this test's own, so nothing it writes reaches the next one. */
const fresh = () => env.FLEET.get(env.FLEET.newUniqueId());

/**
 * A namespace that hands back this test's own object.
 *
 * `fleetOf` asks for the object by name, which is right in the Worker — one fleet, one object — and
 * would make every test here share one store. This is the one thing about the platform the test
 * stands in for; everything below it is the real Durable Object on workerd.
 */
const namespaceOf = (fleet: ReturnType<typeof fresh>): Env["FLEET"] =>
  ({ idFromName: () => "the-one", get: () => fleet }) as unknown as Env["FLEET"];

/** One tail event, with only the members `src/tail.ts` reads. */
const traced = (over: Partial<TraceItem>): TraceItem =>
  ({
    scriptName: "fleet-worker",
    eventTimestamp: Date.parse("2026-09-23T10:00:00Z"),
    outcome: "ok",
    logs: [],
    exceptions: [],
    ...over,
  }) as TraceItem;

const recorded = async (fleet: ReturnType<typeof fresh>) =>
  (await fleet.logs({ minRank: 0, before: null, from: null, to: null, limit: 50 })).rows;

describe("what the producer could not record about itself", () => {
  it("records an exception nobody caught, with the outcome beside it", async () => {
    const fleet = fresh();
    await tail.tail(
      [
        traced({
          outcome: "exception",
          exceptions: [
            {
              name: "TypeError",
              message: "cannot read properties of undefined",
              timestamp: Date.parse("2026-09-23T10:00:01Z"),
            },
          ],
        }),
      ],
      { FLEET: namespaceOf(fleet) },
    );

    const rows = await recorded(fleet);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.level).toBe("error");
    expect(rows[0]?.message).toContain("uncaught TypeError");
    expect(rows[0]?.fields).toMatchObject({ outcome: "exception", script: "fleet-worker" });
  });

  it("records an invocation that ended badly with nothing thrown, which is the CPU case", async () => {
    const fleet = fresh();
    await tail.tail([traced({ outcome: "exceededCpu" })], { FLEET: namespaceOf(fleet) });

    const rows = await recorded(fleet);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain("exceededCpu");
    // Nothing inside the Worker can ever report this one: it is what stopped the Worker reporting.
    expect(rows[0]?.level).toBe("error");
  });

  it("calls a client that hung up a warning and not an error", async () => {
    const fleet = fresh();
    await tail.tail([traced({ outcome: "canceled" })], { FLEET: namespaceOf(fleet) });

    const rows = await recorded(fleet);
    expect(rows[0]?.level).toBe("warn");
    expect(LEVELS.indexOf("warn")).toBeLessThan(LEVELS.indexOf("error"));
  });

  it("writes nothing for an ordinary invocation, however much it logged", async () => {
    const fleet = fresh();
    await tail.tail(
      [
        traced({
          outcome: "ok",
          logs: [
            { level: "log", message: ["cycle complete"], timestamp: Date.now() },
            { level: "error", message: ["something the Worker handled"], timestamp: Date.now() },
          ],
        }),
      ],
      { FLEET: namespaceOf(fleet) },
    );

    // `event.logs` is thrown away on purpose. Forwarding it would be the `console` capture
    // `spec/logs.md` argues against — one feed per process, blind to whose work produced each line
    // — and the `error` above is a line the producer chose to handle, not a fact about the
    // invocation. This Worker records what the producer could not, and nothing else.
    expect(await recorded(fleet)).toHaveLength(0);
  });

  it("records one batch in one call, whatever the producer's traffic was", async () => {
    const fleet = fresh();
    await tail.tail(
      Array.from({ length: 5 }, () => traced({ outcome: "exceededMemory" })),
      { FLEET: namespaceOf(fleet) },
    );

    expect(await recorded(fleet)).toHaveLength(5);
  });
});

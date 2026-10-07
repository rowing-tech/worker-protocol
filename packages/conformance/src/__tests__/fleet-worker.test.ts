import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev } from "wrangler";
import { type Report, type Result, universe, verify } from "../index.ts";
import { type ListeningSink, listenAsSink } from "../sink.ts";

/**
 * The verifier against a Worker deployed the way this protocol's architecture assumes.
 *
 * The other two suites here start a Node server in this process. This one starts `workerd` — the
 * runtime Cloudflare actually runs — from `examples/fleet-worker/wrangler.jsonc`, over a real
 * socket, and points the same tool at it with nothing changed. That is the whole reason the file
 * exists: every rule the verifier checks is checked over HTTP against a document, so a Worker on
 * another runtime is not a different subject, and a suite that could only ever reach a Node worker
 * would have been quietly reporting on Node.
 *
 * **What it actually catches is the store.** ENDP-16's rules are the only ones here whose verdict
 * depends on where a Worker keeps something between two requests, and a `Map` in a process answers
 * them correctly in one isolate and wrongly in two. Reaching this Worker through workerd is what
 * makes the pass mean what it says.
 *
 * It is slower than the other two by the time it takes a runtime to boot, which is the price of
 * the claim and is paid once.
 */

const FLEET = join(import.meta.dirname, "..", "..", "..", "..", "examples", "fleet-worker");

/** REG-3's token. `wrangler.jsonc` does not carry it, because a secret is not in a committed file. */
const CREDENTIAL = "f-token";

/**
 * What this Worker's operators would tell a verifier: an Action that is safe to perform, and the
 * Action that makes it publish, delivered to a sink of the verifier's own.
 *
 * `record-inspection` records that somebody looked at a vehicle, and changes nothing but this
 * Worker's Facts. `run-cycle` reads the stub provider, and with `QUIET_AFTER_MINUTES` at zero every
 * vehicle it hears from goes quiet at once — so the cycle raises a Task per vehicle, and each
 * `task-raised` crosses the outbox, the events Queue and the deliveries Queue to reach the sink:
 * the whole of `subscriptions` on the runtime it is built for, over the Queues Miniflare runs.
 */
const arrangementWith = (sink: ListeningSink) => ({
  safeAction: { name: "record-inspection", input: { vehicle: "ABC-123", reachable: true } },
  sink: { url: sink.url, received: sink.received },
  publishingAction: {
    name: "run-cycle",
    input: {},
    publishes: "tech.rowing.worker-protocol.task-raised",
  },
});

describe("a Worker on workerd, verified over HTTP", () => {
  let report: Report;
  let worker: Awaited<ReturnType<typeof unstable_dev>>;
  let sink: ListeningSink;

  beforeAll(async () => {
    sink = await listenAsSink({ port: 0 });
    worker = await unstable_dev(join(FLEET, "src", "worker.ts"), {
      config: join(FLEET, "wrangler.jsonc"),
      experimental: { disableExperimentalWarning: true },
      // The sink's origin exempted from SUB-5 and SUB-6, as a local backend is in development.
      vars: { CREDENTIAL, DEV_SINK_ORIGINS: sink.origin, QUIET_AFTER_MINUTES: "0" },
    });
    report = await verify({
      baseUrl: `http://127.0.0.1:${worker.port}`,
      credential: CREDENTIAL,
      mayPerform: true,
      arrangement: arrangementWith(sink),
    });
  }, 60_000);

  afterAll(async () => {
    await worker.stop();
    await sink.close();
  });

  const result = (id: string): Result | undefined =>
    report.results.find((one) => one.rule.id === id);

  it("fails nothing, over plaintext on a loopback address", () => {
    // DESC-35 requires `https` wherever a network is crossed, and a dev server on 127.0.0.1 crosses
    // none — so the one rule this harness used to fail for want of a certificate is satisfied, and
    // the day any rule fails, this test says which.
    const failing = report.results.filter((one) => one.verdict === "fails").map((r) => r.rule.id);
    expect(failing).toEqual([]);
  });

  it("keeps ENDP-16's promise across requests, which is what the Durable Object is for", () => {
    // The rules that need a store outliving the request. A Worker holding them in a Map passes
    // these in one isolate and breaks them in two, and nothing in the report would say so — which
    // is why this Worker exists and why this assertion is here rather than in the other suites.
    for (const id of ["ENDP-38", "ENDP-16", "ENDP-17", "ACT-19"]) {
      expect(result(id)?.verdict, `${id} over a durable store`).toBe("passes");
    }
  });

  it("is judged on the same rules as a Worker on Node, from the same universe", async () => {
    // Nothing in `verify` knows what runtime answered, so every rule in the universe is reported
    // on here exactly as it is against a Worker on Node. The count is of DISTINCT ids rather than
    // of results, because a rule observed on several surfaces is reported once per surface.
    const judged = new Set(report.results.map((one) => one.rule.id));
    expect(judged.size).toBe((await universe()).rules.length);
    // DESC-33 did not stop the run, so what follows is a verdict rather than a version complaint.
    expect(report.older).toBeUndefined();
    expect(report.edition).toBe(report.verifierEdition);
  });

  it("delivers what it publishes to a subscriber's sink, across both of its Queues", () => {
    // Each of these is observed at the sink: the handshake before anything was stored (SUB-10), a
    // delivery with the sink's own credential (SUB-11), nothing for the subscription whose filter
    // no event satisfies (SUB-13), the delivery on record in the list (SUB-16), and a lifecycle
    // event carrying its Task in `subject` and `tasktype` (EVT-15).
    for (const id of ["SUB-2", "SUB-7", "SUB-10", "SUB-11", "SUB-13", "SUB-16", "EVT-15"]) {
      expect(result(id)?.verdict, id).toBe("passes");
    }
    // What reached the sink were the cycle's Tasks. Not necessarily all three: the verifier ends its
    // subscriptions once the first delivery has had a moment's company, and a delivery the Queue
    // carries after that finds no subscription to make it for.
    const delivered = sink
      .received()
      .filter((one) => one.method === "POST")
      .map((one) => (JSON.parse(one.body) as { subject?: string }).subject);
    expect(delivered.length).toBeGreaterThan(0);
    for (const subject of delivered) {
      expect(["quiet:ABC-123", "quiet:DEF-456", "quiet:GHI-789"]).toContain(subject);
    }
  });

  it("declares its Capabilities under the names this edition fixed", () => {
    // ACT-16, MET-21 and EVT-12 renamed the map inside three Capability entries. They pass here
    // only if the Descriptor this Worker actually serves carries the new spelling, which makes
    // this the one check that reads the bytes on the wire rather than the TypeScript behind them.
    for (const id of ["ACT-16", "MET-21", "EVT-12"]) {
      expect(result(id)?.verdict, id).toBe("passes");
    }

    // TASK-33 moved OUT of a Capability entry and onto the Descriptor root. This Worker raises
    // Tasks and answers none, so it declares no Skill at all — which under the old shape it could
    // not have said without also declaring a `tasks` entry it had nothing to put in.
    expect(result("TASK-33")?.verdict).toBe("notExercised");
  });
});

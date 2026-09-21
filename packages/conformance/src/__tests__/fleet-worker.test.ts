import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev } from "wrangler";
import { type Report, type Result, verify } from "../index.ts";

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
 * What this Worker's operators would tell a verifier, which is one Action that is safe to perform.
 *
 * `record-inspection` records that somebody looked at a vehicle. It is safe in the sense the
 * arrangement means: performing it changes this Worker's own Facts and reaches nothing else.
 */
const ARRANGEMENT = {
  safeAction: { name: "record-inspection", input: { vehicle: "ABC-123", reachable: true } },
};

describe("a Worker on workerd, verified over HTTP", () => {
  let report: Report;
  let worker: Awaited<ReturnType<typeof unstable_dev>>;

  beforeAll(async () => {
    worker = await unstable_dev(join(FLEET, "src", "worker.ts"), {
      config: join(FLEET, "wrangler.jsonc"),
      experimental: { disableExperimentalWarning: true },
      vars: { CREDENTIAL },
    });
    report = await verify({
      baseUrl: `http://127.0.0.1:${worker.port}`,
      credential: CREDENTIAL,
      mayPerform: true,
      arrangement: ARRANGEMENT,
    });
  }, 60_000);

  afterAll(async () => {
    await worker.stop();
  });

  const result = (id: string): Result | undefined =>
    report.results.find((one) => one.rule.id === id);

  it("fails nothing but DESC-3, which a loopback address cannot satisfy", () => {
    // DESC-3 fixes `https`, and a dev server on 127.0.0.1 serves `http`. It is the one rule this
    // harness cannot satisfy rather than one the Worker gets wrong, and it is asserted rather than
    // excluded so that the day a SECOND rule fails, this test says which.
    const failing = report.results.filter((one) => one.verdict === "fails").map((r) => r.rule.id);
    expect(failing).toEqual(["DESC-3"]);
  });

  it("keeps ENDP-16's promise across requests, which is what the Durable Object is for", () => {
    // The rules that need a store outliving the request. A Worker holding them in a Map passes
    // these in one isolate and breaks them in two, and nothing in the report would say so — which
    // is why this Worker exists and why this assertion is here rather than in the other suites.
    for (const id of ["ENDP-15", "ENDP-16", "ENDP-17", "ACT-12"]) {
      expect(result(id)?.verdict, `${id} over a durable store`).toBe("passes");
    }
  });

  it("is judged on the same rules as a Worker on Node, from the same universe", () => {
    // Nothing in `verify` knows what runtime answered, so every rule in the universe is reported
    // on here exactly as it is against a Worker on Node. The count is of DISTINCT ids rather than
    // of results, because a rule observed on several surfaces is reported once per surface.
    const judged = new Set(report.results.map((one) => one.rule.id));
    expect(judged.size).toBe(150);
    // DESC-25 did not stop the run, so what follows is a verdict rather than a version complaint.
    expect(report.older).toBeUndefined();
    expect(report.edition).toBe(report.verifierEdition);
  });

  it("declares its Capabilities under the names this edition fixed", () => {
    // ACT-16, MET-21 and EVT-12 renamed the map inside three Capability entries. They pass here
    // only if the Descriptor this Worker actually serves carries the new spelling, which makes
    // this the one check that reads the bytes on the wire rather than the TypeScript behind them.
    for (const id of ["ACT-16", "MET-21", "EVT-12"]) {
      expect(result(id)?.verdict, id).toBe("passes");
    }

    // TASK-29 moved OUT of a Capability entry and onto the Descriptor root. This Worker raises
    // Tasks and answers none, so it declares no Skill at all — which under the old shape it could
    // not have said without also declaring a `tasks` entry it had nothing to put in.
    expect(result("TASK-29")?.verdict).toBe("notExercised");
  });
});

import type { AddressInfo } from "node:net";
import { createWorker } from "@worker-protocol/reference-worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verify } from "../index.ts";
import { tally } from "../report.ts";

/**
 * The verifier against a live Worker, over a real socket.
 *
 * This is the whole reason the reference Worker exists. A verifier with nothing to run against is
 * the failure this repository names everywhere else — checks that have never run are claims nobody
 * verified — and the way out is not more checks, it is one check that has actually reached a
 * server and come back with a verdict.
 */

const start = (options: Parameters<typeof createWorker>[0] = {}) =>
  new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = createWorker(options);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}${options.basePath ?? ""}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });

/**
 * What this Worker's operators would tell a verifier, if it had any.
 *
 * `conformance/verifiability.md` classes a rule `H` when nothing a tool can do to an UNARRANGED
 * Worker will ever see a violation. The arrangement cannot come from the protocol — test
 * scaffolding in a Descriptor would be carried by every Worker in the network — so it arrives out
 * of band, the way the base URL and the credential do.
 */
const ARRANGEMENT = {
  safeAction: { name: "record-verification", input: { vehicle: "ABC-123", verified: true } },
  refusedInput: { name: "price-quote", input: { amount: -1 } },
  asyncAction: { name: "rebuild-index", input: {} },
};

describe("the reference worker, verified", () => {
  let worker: Awaited<ReturnType<typeof start>>;

  beforeAll(async () => {
    worker = await start({ credential: "a-token" });
  });

  afterAll(async () => {
    await worker.close();
  });

  it("reads the Descriptor and reports on every rule in the specification", async () => {
    const report = await verify({
      baseUrl: worker.url,
      credential: "a-token",
      mayPerform: true,
      arrangement: ARRANGEMENT,
    });

    expect(report.edition).toBe("0.1");

    // Every rule gets a verdict, never only the ones a check claimed.
    const rules = new Set(report.results.map((r) => r.rule.id));
    expect(rules.size).toBe(report.results.length);
    expect(report.results.length).toBeGreaterThan(100);
  });

  it("passes every rule it judges but DESC-3, which the harness cannot satisfy", async () => {
    const report = await verify({
      baseUrl: worker.url,
      credential: "a-token",
      mayPerform: true,
      arrangement: ARRANGEMENT,
    });

    // Derived from the report rather than restated here. A hand-written list of the rules this
    // verifier judges is a second source that drifts, and it drifts SILENTLY: a check added
    // without touching the list leaves the test passing while asserting less, which is a gate that
    // only knows how to say yes — the thing this repository objects to everywhere else.
    const failing = report.results.filter((r) => r.verdict === "fails").map((r) => r.rule.id);

    // DESC-3 fixes `https`, and this test reaches the Worker over a loopback socket in plaintext.
    // The verdict is correct and the fault is the harness's: a Worker is not conformant at an
    // address nobody may send it a credential to. The tool is not taught an exception for
    // localhost, because a verifier that quietly excused a rule would be deciding something the
    // specification did not.
    expect(failing).toEqual(["DESC-3"]);
  });

  it("judges every rule a tool can observe but the one nothing has provoked", async () => {
    const report = await verify({
      baseUrl: worker.url,
      credential: "a-token",
      mayPerform: true,
      arrangement: ARRANGEMENT,
    });

    const observable = report.results.filter((r) => r.rule.reach === "W");
    const unexercised = observable
      .filter((r) => r.verdict === "notExercised")
      .map((r) => r.rule.id);

    // ENDP-19's witness is a collection longer than a Worker's page cap, and every collection here
    // fits in one page: an honest gap rather than a missing check.
    //
    // The rest are a debt with a date on it. spec/tasks-and-claims.md was drafted before its
    // checks were written and before the reference Worker served a `tasks` surface, so seven TASK
    // rules and NAME-7 — which that draft unblocked, by giving this protocol its first name that
    // crosses between Workers — are observable and not yet observed. This assertion is derived
    // from the report precisely so a rule cannot become observable in silence, and it has now
    // announced two drafts' worth of debt without anybody having to remember to look.
    expect(unexercised).toEqual([
      "ENDP-19",
      "NAME-7",
      "TASK-1",
      "TASK-2",
      "TASK-3",
      "TASK-4",
      "TASK-5",
      "TASK-7",
      "TASK-8",
    ]);
  });

  it("resolves a declared address against the Descriptor's route, not the base URL", async () => {
    // DESC-12 resolves a relative reference against `<base>/.well-known/worker-protocol`, so a
    // bare `health` lands under `.well-known/` where nothing is served. The reference Worker
    // declares `../health` and this is what holds it to it — under a path as well as at the root,
    // which is the case an absolute `/health` would have got wrong.
    const mounted = await start({ credential: "a-token", basePath: "/fleet/" });
    try {
      const report = await verify({
        baseUrl: mounted.url,
        credential: "a-token",
        mayPerform: true,
        arrangement: ARRANGEMENT,
      });
      const verdict = (id: string) => report.results.find((r) => r.rule.id === id)?.verdict;
      expect(verdict("DESC-18")).toBe("passes");
      expect(verdict("HLTH-5")).toBe("passes");
      expect(verdict("ACT-15")).toBe("passes");
    } finally {
      await mounted.close();
    }
  });

  it("says which kind of silence every unclaimed rule is", async () => {
    const report = await verify({
      baseUrl: worker.url,
      credential: "a-token",
      mayPerform: true,
      arrangement: ARRANGEMENT,
    });
    const counts = tally(report.results);

    // A rule binding a verifier, a Tower, a consumer, an issuer or the specification is never
    // passed by a tool that only ever contacted the Worker.
    expect(counts.otherSubject).toBe(22);
    // A rule nothing outside can observe is reported rather than counted as passed.
    expect(counts.unverified).toBe(20);
    // And the rest is the honest measure of how far this verifier has got.
    expect(counts.passes).toBe(70);
    expect(counts.fails).toBe(1);
    expect(counts.passes + counts.fails + counts.notExercised).toBe(
      report.results.length - counts.otherSubject - counts.unverified,
    );
  });

  it("does not POST to a Worker it was not given permission to perform on", async () => {
    // Every other surface in this protocol is read, and a read leaves the Worker as it found it.
    // An Action is an operation somebody's operators chose to expose, so the default is that a
    // tool pointed at a Worker to inspect it does not perform work on it uninvited.
    const report = await verify({ baseUrl: worker.url, credential: "a-token" });
    const result = (id: string) => report.results.find((r) => r.rule.id === id);

    for (const id of ["ACT-6", "ACT-7", "ACT-8", "ENDP-3", "ENDP-18"]) {
      expect(result(id)?.verdict, `${id} should not have been exercised`).toBe("notExercised");
      expect(result(id)?.detail).toContain("not permitted to POST");
    }

    // What the Descriptor alone establishes is judged either way: asking permission costs the
    // rules that need a request, and none of the ones that need only the document.
    for (const id of ["ACT-1", "ACT-2", "ACT-3", "ACT-4", "ACT-12", "ACT-15", "ENDP-15"]) {
      expect(result(id)?.verdict, `${id} needs no POST`).toBe("passes");
    }
  });

  it("reports what an arrangement was missing rather than a verdict", async () => {
    // A rule with no ordinary witness is not failed for want of scaffolding. Permitted to perform
    // but told nothing, the verifier says which arrangement each rule was waiting for — a gap
    // somebody can close, and not a claim about the Worker.
    const report = await verify({
      baseUrl: worker.url,
      credential: "a-token",
      mayPerform: true,
    });
    const result = (id: string) => report.results.find((r) => r.rule.id === id);

    for (const id of ["ACT-5", "ACT-10", "ENDP-16", "ENDP-17"]) {
      expect(result(id)?.verdict, id).toBe("notExercised");
      expect(result(id)?.detail).toContain("safe to perform");
    }
    expect(result("ACT-9")?.detail).toContain("refuses on its own rules");
    expect(result("ACT-11")?.detail).toContain("does not complete within the call");

    // And nothing that needed only a POST is held back by the missing arrangement.
    for (const id of ["ACT-6", "ACT-7", "ACT-8", "ENDP-3", "ENDP-18", "REG-31"]) {
      expect(result(id)?.verdict, id).toBe("passes");
    }
  });

  it("attributes a fault to the rule that states the thing it broke", async () => {
    // Not "the Descriptor is invalid". An operator cannot act on that, and two very different
    // faults read identically — which is what the ids exist to prevent.
    const broken = await start({ edition: "banana" });
    try {
      const report = await verify({ baseUrl: broken.url });
      const result = report.results.find((r) => r.rule.id === "DESC-23");

      expect(result?.verdict).toBe("fails");
      expect(result?.detail).toContain("edition");
      // And nothing the broken document could not support is claimed as passing.
      expect(report.results.find((r) => r.rule.id === "DESC-8")?.verdict).toBe("notExercised");
    } finally {
      await broken.close();
    }
  });

  it("names DESC-8 for a reserved Capability the edition does not define", async () => {
    // The precision this costs machinery for. The key schema is a union of the reserved
    // enumeration and the vendor pattern, so a key that fails it matched neither and nothing in
    // schemas/ says which branch it was reaching for — attribution alone would report DESC-22 and
    // leave DESC-8 a rule that can pass and never fail. DESC-14 is what tells them apart: no dot
    // means reserved, and reserved means this edition defines it or it is nothing.
    const canned = (document: unknown): typeof globalThis.fetch =>
      (async () =>
        new Response(JSON.stringify(document), {
          headers: {
            "content-type": "application/json",
            "worker-protocol-edition": "0.1",
            "worker-protocol-capability-version": "1",
          },
        })) as unknown as typeof globalThis.fetch;

    const report = await verify({
      baseUrl: "https://worker.example.com",
      fetch: canned({ id: "w", edition: "0.1", capabilities: { telemetry: { version: 1 } } }),
    });
    const result = (id: string) => report.results.find((r) => r.rule.id === id);

    expect(result("DESC-8")?.verdict).toBe("fails");
    expect(result("DESC-8")?.detail).toContain("telemetry");
    // And the coarser verdict on the same mistake is suppressed, so an operator gets one finding.
    expect(result("DESC-22")?.verdict).not.toBe("fails");
  });

  it("names DESC-14 for a dotted name that is not a well-formed vendor Capability", async () => {
    const canned: typeof globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "w",
          edition: "0.1",
          capabilities: { "acme..billing": { version: 1 } },
        }),
        {
          headers: {
            "content-type": "application/json",
            "worker-protocol-edition": "0.1",
            "worker-protocol-capability-version": "1",
          },
        },
      )) as unknown as typeof globalThis.fetch;

    const report = await verify({ baseUrl: "https://worker.example.com", fetch: canned });
    const result = report.results.find((r) => r.rule.id === "DESC-14");

    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toContain("acme..billing");
  });

  it("names MET-5 for a dimension named after a parameter of a read", async () => {
    // MET-5 has no schema witness — excluding a word list needs a negative lookahead that
    // RE2-backed validators refuse — so it is one of the rules a verifier exists to carry. A
    // dimension called `from` would be unreachable: the Worker could never tell the filter from
    // the parameter that bounds the interval.
    const canned: typeof globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "w",
          edition: "0.1",
          capabilities: {
            metrics: {
              version: 1,
              address: "../metrics",
              timeZone: "UTC",
              metrics: {
                "tasks-resolved": {
                  unit: "tasks",
                  additive: true,
                  granularities: ["day"],
                  dimensions: { from: {} },
                },
              },
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
            "worker-protocol-edition": "0.1",
            "worker-protocol-capability-version": "1",
          },
        },
      )) as unknown as typeof globalThis.fetch;

    const report = await verify({ baseUrl: "https://worker.example.com", fetch: canned });
    const result = report.results.find((r) => r.rule.id === "MET-5");

    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toContain("from");
  });

  it("fails DESC-1 when the credential is refused, and judges nothing else on the document", async () => {
    const report = await verify({ baseUrl: worker.url, credential: "the-wrong-token" });
    const result = report.results.find((r) => r.rule.id === "DESC-1");

    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toContain("401");
    expect(report.edition).toBeNull();
  });
});

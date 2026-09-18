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

describe("the reference worker, verified", () => {
  let worker: Awaited<ReturnType<typeof start>>;

  beforeAll(async () => {
    worker = await start({ credential: "a-token" });
  });

  afterAll(async () => {
    await worker.close();
  });

  it("reads the Descriptor and reports on every rule in the specification", async () => {
    const report = await verify({ baseUrl: worker.url, credential: "a-token" });

    expect(report.edition).toBe("0.1");

    // Every rule gets a verdict, never only the ones a check claimed.
    const rules = new Set(report.results.map((r) => r.rule.id));
    expect(rules.size).toBe(report.results.length);
    expect(report.results.length).toBeGreaterThan(100);
  });

  it("passes every rule it judges but DESC-3, which the harness cannot satisfy", async () => {
    const report = await verify({ baseUrl: worker.url, credential: "a-token" });

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

  it("judges every rule a tool can observe, but the two nothing has yet provoked", async () => {
    const report = await verify({ baseUrl: worker.url, credential: "a-token" });

    const observable = report.results.filter((r) => r.rule.reach === "W");
    const unexercised = observable
      .filter((r) => r.verdict === "notExercised")
      .map((r) => r.rule.id);

    // Two kinds of entry, and the list is pinned so that a NEW one is visible rather than quiet.
    //
    // ENDP-3 and ENDP-19 have no witness against this Worker at all: nothing here changes state
    // until it serves `actions`, and every collection fits in one page. Those are honest gaps.
    //
    // The rest are a debt with a date on it. spec/actions.md was drafted before its checks were
    // written and before the reference Worker served an `actions` surface, so ten ACT rules and
    // the three that actions unblocked — DESC-11, ENDP-15, ENDP-18 — are observable and not yet
    // observed. This assertion failing was how that landed: it is derived from the report, so a
    // rule that becomes observable without a check cannot slip past.
    expect(unexercised).toEqual([
      "ACT-1",
      "ACT-2",
      "ACT-3",
      "ACT-4",
      "ACT-6",
      "ACT-7",
      "ACT-8",
      "ACT-12",
      "ACT-13",
      "ACT-15",
      "DESC-11",
      "ENDP-3",
      "ENDP-15",
      "ENDP-18",
      "ENDP-19",
    ]);
  });

  it("resolves a declared address against the Descriptor's route, not the base URL", async () => {
    // DESC-12 resolves a relative reference against `<base>/.well-known/worker-protocol`, so a
    // bare `health` lands under `.well-known/` where nothing is served. The reference Worker
    // declares `../health` and this is what holds it to it — under a path as well as at the root,
    // which is the case an absolute `/health` would have got wrong.
    const mounted = await start({ credential: "a-token", basePath: "/fleet/" });
    try {
      const report = await verify({ baseUrl: mounted.url, credential: "a-token" });
      const verdict = (id: string) => report.results.find((r) => r.rule.id === id)?.verdict;
      expect(verdict("DESC-18")).toBe("passes");
      expect(verdict("HLTH-5")).toBe("passes");
    } finally {
      await mounted.close();
    }
  });

  it("says which kind of silence every unclaimed rule is", async () => {
    const report = await verify({ baseUrl: worker.url, credential: "a-token" });
    const counts = tally(report.results);

    // A rule binding a verifier, a Tower, a consumer, an issuer or the specification is never
    // passed by a tool that only ever contacted the Worker.
    expect(counts.otherSubject).toBe(21);
    // A rule nothing outside can observe is reported rather than counted as passed.
    expect(counts.unverified).toBe(16);
    // And the rest is the honest measure of how far this verifier has got.
    expect(counts.passes).toBe(47);
    expect(counts.fails).toBe(1);
    expect(counts.passes + counts.fails + counts.notExercised).toBe(
      report.results.length - counts.otherSubject - counts.unverified,
    );
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

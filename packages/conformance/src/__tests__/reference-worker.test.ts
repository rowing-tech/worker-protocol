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

  it("passes every rule it claims but DESC-3, which the harness cannot satisfy", async () => {
    const report = await verify({ baseUrl: worker.url, credential: "a-token" });
    const verdict = (id: string) => report.results.find((r) => r.rule.id === id)?.verdict;

    const claimed = [
      // The Descriptor document alone.
      "DESC-1",
      "DESC-5",
      "DESC-6",
      "DESC-8",
      "DESC-9",
      "DESC-12",
      "DESC-14",
      "DESC-22",
      "DESC-23",
      // What calling each declared address establishes.
      "DESC-18",
      "REG-3",
      "REG-7",
      "REG-21",
      // The `health` Capability.
      "HLTH-1",
      "HLTH-2",
      "HLTH-3",
      "HLTH-5",
      // Judged over every response the run provoked.
      "ENDP-1",
      "ENDP-4",
      "ENDP-5",
      "ENDP-25",
      "ENDP-26",
      "ENDP-29",
    ];
    for (const id of claimed) expect(verdict(id), `${id} should pass`).toBe("passes");

    // DESC-3 fixes `https`, and this test reaches the Worker over a loopback socket in plaintext.
    // The verdict is correct and the fault is the harness's: a Worker is not conformant at an
    // address nobody may send it a credential to. The tool is not taught an exception for
    // localhost, because a verifier that quietly excused a rule would be deciding something the
    // specification did not.
    expect(verdict("DESC-3")).toBe("fails");
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
    expect(counts.passes).toBe(23);
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

  it("fails DESC-1 when the credential is refused, and judges nothing else on the document", async () => {
    const report = await verify({ baseUrl: worker.url, credential: "the-wrong-token" });
    const result = report.results.find((r) => r.rule.id === "DESC-1");

    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toContain("401");
    expect(report.edition).toBeNull();
  });
});

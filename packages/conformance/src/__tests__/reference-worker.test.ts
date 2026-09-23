import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "../../../../conformance/reference-worker/src/server.ts";
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
  // What no Worker has by accident: a second credential live beside the first, one issued under
  // a Contract rather than at enrollment, one that authenticates and carries no right, settings
  // its operators will let go of, and an event it already published — because a verifier holds no
  // broker and will never see one itself.
  secondCredential: "b-token",
  consumerCredential: "d-token",
  unprivilegedCredential: "c-token",
  replaceableSettings: true,
  // LOG-3 and ENDP-33: this Worker records what it serves, which is the whole arrangement — a
  // verifier with no knowledge of its domain can make a record exist by reading anything.
  recordsEveryRequest: true,
  publishedEvent: {
    specversion: "1.0",
    id: "e-1",
    source: "tech.rowing.worker-protocol.reference",
    type: "tech.rowing.worker-protocol.vehicle-verified",
    data: { vehicle: "ABC-123" },
  },
};

describe("the reference worker, verified", () => {
  let worker: Awaited<ReturnType<typeof start>>;

  // A fresh Worker for every test, because a full run changes one: the safe Action resolves the
  // condition of a Task this Worker was raising (TASK-15), so a second run against the same
  // process would read a shorter list. A Worker arranged to be checked is arranged for one check.
  beforeEach(async () => {
    worker = await start({
      credential: "a-token",
      secondCredential: "b-token",
      consumerCredential: "d-token",
      unprivilegedCredential: "c-token",
      // TASK-6: the Contract credential covers one Task and the recorded ones cover all of them, so
      // the two lists differ and filtering is something a check can actually see happen.
      visibleTasks: { "d-token": ["task-1"] },
    });
  });

  afterEach(async () => {
    await worker.close();
  });

  it("reads the Descriptor and reports on every rule in the specification", async () => {
    const report = await verify({
      baseUrl: worker.url,
      credential: "a-token",
      mayPerform: true,
      arrangement: ARRANGEMENT,
    });

    expect(report.edition).toBe("0.2");

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

    // TASK-31's positive witness. This is the only Worker here that HAS a Skill, so it is the only
    // place the rule can be seen passing — the other two suites assert its absence, and a pair of
    // tests that only ever saw a field missing would prove nothing about the field.
    expect(report.results.find((r) => r.rule.id === "TASK-31")?.verdict).toBe("passes");
  });

  it("declares its Skill on the Descriptor root, where TASK-31 puts it", async () => {
    const descriptor = await fetch(new URL("/.well-known/worker-protocol", worker.url), {
      headers: { authorization: "Bearer a-token" },
    });
    const document = (await descriptor.json()) as {
      skills?: Record<string, unknown>;
      capabilities: { tasks?: Record<string, unknown> };
    };

    // Beside the id, not inside a Capability — read off the bytes on the wire rather than off the
    // TypeScript that produced them. The verdict itself is asserted on the report the test above
    // already ran; a second full sweep to look up one rule id is a whole verification wasted.
    expect(document.skills).toEqual({
      "tech.rowing.worker-protocol.verify-vehicle": {
        payload: expect.any(Object),
        produces: expect.any(Object),
      },
    });
    expect(document.capabilities.tasks).not.toHaveProperty("skills");
    expect(document.capabilities.tasks).not.toHaveProperty("answers");
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

    // Empty, and that is the point this whole exercise was for: every rule a tool can observe
    // against an ordinary Worker has a check that has actually run against one. The assertion
    // stays derived rather than deleted, because what it is now guarding is the opposite of what
    // it guarded before — not a debt to pay down, but a state to keep.
    expect(unexercised).toEqual([]);
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
    expect(counts.otherSubject).toBe(26);
    // A rule nothing outside can observe is reported rather than counted as passed.
    expect(counts.unverified).toBe(22);
    // How many of the rules that need a Worker ARRANGED to be observed this double actually buys.
    // `conformance/README.md` states the number in prose and `scripts/lint-verifiability.ts` can
    // only locate that sentence, not compute it — the count lives here, where the report does.
    const arranged = report.results.filter(
      (r) => r.rule.reach === "H" && (r.verdict === "passes" || r.verdict === "fails"),
    );
    expect(arranged.length).toBe(19);

    // And the rest is the honest measure of how far this verifier has got.
    expect(counts.passes).toBe(113);
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
    for (const id of ["ACT-16", "ACT-2", "ACT-3", "ACT-4", "ACT-12", "ACT-15", "ENDP-15"]) {
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

  it("catches a Worker that answers `healthy` before it has established its state", async () => {
    // HLTH-4's window is between a process starting and its first evaluation, and only whoever
    // started it knows a poll is inside one — which is why it is the one arrangement that is a
    // fact about the moment rather than about the Worker.
    const booting = await start({ credential: "a-token", readyAfterMs: 10_000 });
    try {
      const report = await verify({
        baseUrl: booting.url,
        credential: "a-token",
        arrangement: { justStarted: true },
      });
      expect(report.results.find((r) => r.rule.id === "HLTH-4")?.verdict).toBe("passes");
      // And the summary it gives meanwhile is the one HLTH-4 requires, not a default.
      expect(report.results.find((r) => r.rule.id === "HLTH-3")?.verdict).toBe("passes");
    } finally {
      await booting.close();
    }
  });

  it("verifies nothing against a Worker whose edition it does not hold", async () => {
    // DESC-25 binds a verifier, and publishing an edition is what made it ours to obey. A tool
    // that met an edition it could not read and failed the Worker for it would be blaming a party
    // for what is the reader's problem — so it verifies nothing and says which of the two is
    // behind, which is a sentence an operator can act on.
    const ahead = await start({ edition: "9.0" });
    try {
      const report = await verify({ baseUrl: ahead.url });

      expect(report.older).toBe(true);
      expect(report.edition).toBe("9.0");
      expect(report.verifierEdition).toBe("0.2");
      expect(report.results.every((r) => r.verdict === "notExercised")).toBe(true);
      expect(report.results[0]?.detail).toContain("holds edition 0.2");
    } finally {
      await ahead.close();
    }
  });

  it("catches a Worker that refuses an unanswerable version on a read and performs one on a write", async () => {
    // ENDP-6 says `on a request`, and a write is one. A Worker that refuses the version it cannot
    // answer where nothing was at stake and performs it where something was has done exactly what
    // the rule exists to prevent — so the probe goes to the write addresses too, which is what
    // needs `mayPerform` and what a Worker obeying the rule performs nothing in response to.
    const canned: typeof globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = {
        "content-type": "application/json",
        "worker-protocol-edition": "0.1",
        "worker-protocol-capability-version": "1",
      };
      const asked = new Headers(init?.headers).get("worker-protocol-capability-version");
      const refusal = (code: string) =>
        new Response(JSON.stringify({ code, message: "no", class: "reject" }), {
          status: 400,
          headers,
        });

      if (String(url).endsWith("/.well-known/worker-protocol")) {
        if (asked === "99999") return refusal("unsupported_version");
        return new Response(
          JSON.stringify({
            id: "w",
            edition: "0.1",
            capabilities: { actions: { version: 1, address: "../actions", actions: {} } },
          }),
          { headers },
        );
      }
      // The write address takes the request whatever version it was asked for.
      return refusal("invalid_parameter");
    }) as unknown as typeof globalThis.fetch;

    const report = await verify({
      baseUrl: "https://worker.example.com",
      mayPerform: true,
      fetch: canned,
    });
    const result = report.results.find((r) => r.rule.id === "ENDP-6");

    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toContain("write address");
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
              publishes: {
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

/**
 * TASK-32's second obligation, which had no check until now.
 *
 * The rule has two halves. The first is the NAME: the Action a Task type is answered by is one of
 * the owner's own, so a name its `actions` entry does not accept is a Descriptor disagreeing with
 * itself. The second is that Action's INPUT: where a Task can end more than one way the endings are
 * variants of it, told apart by a discriminator.
 *
 * The second half is what makes the first one worth anything. TASK-32 replaced a list of one Action
 * per ending precisely so that nobody has to agree a mapping out of band — but a union whose
 * variants cannot be told apart puts that conversation straight back: a consumer holding a schema
 * it can satisfy still cannot say WHICH ending it is reporting. A Worker in that state passed every
 * check this tool ran, which is the silence a register full of ids exists to prevent.
 */
describe("a Descriptor whose answering Action cannot say which ending it carries", () => {
  const SILENT = "tech.rowing.fleet.check-silent-vehicle";

  const canned = (input: unknown): typeof globalThis.fetch =>
    (async () =>
      new Response(
        JSON.stringify({
          id: "tech.rowing.fleet.watcher",
          edition: "0.1",
          capabilities: {
            tasks: {
              version: 1,
              address: "../tasks",
              raises: { [SILENT]: { payload: { type: "object" }, answeredBy: "answer-check" } },
            },
            actions: {
              version: 1,
              address: "../actions",
              accepts: { "answer-check": { input, completesWithinCall: true } },
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

  const variant = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties,
    required,
  });

  const verdict = async (input: unknown) => {
    const report = await verify({ baseUrl: "https://worker.example.com", fetch: canned(input) });
    return report.results.find((r) => r.rule.id === "TASK-32");
  };

  it("fails TASK-32 where the two endings share no member fixed to a constant", async () => {
    const result = await verdict({
      anyOf: [
        variant({ vehicle: { type: "string" }, reachable: { type: "boolean" } }, ["vehicle"]),
        variant({ vehicle: { type: "string" }, lastSeen: { type: "string" } }, ["vehicle"]),
      ],
    });
    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toContain("union of 2");
  });

  it("fails it where a member is in both variants and fixed in neither", async () => {
    // The near miss, and why the check compares constants rather than names: `outcome` is in both
    // and says nothing, so a reader still cannot tell which ending it is holding.
    const result = await verdict({
      anyOf: [
        variant({ outcome: { type: "string" }, reachable: { type: "boolean" } }, ["outcome"]),
        variant({ outcome: { type: "string" }, lastSeen: { type: "string" } }, ["outcome"]),
      ],
    });
    expect(result?.verdict).toBe("fails");
  });

  it("passes where the variants are told apart, and where the input is not a union at all", async () => {
    const discriminated = await verdict({
      anyOf: [
        variant({ outcome: { const: "found" }, reachable: { type: "boolean" } }, ["outcome"]),
        variant({ outcome: { const: "missing" }, lastSeen: { type: "string" } }, ["outcome"]),
      ],
    });
    expect(discriminated?.verdict).toBe("passes");

    // A Task that ends one way has nothing to tell apart, and failing it would be this tool
    // requiring a union the specification never asked for.
    const single = await verdict(variant({ vehicle: { type: "string" } }, ["vehicle"]));
    expect(single?.verdict).toBe("passes");
  });
});

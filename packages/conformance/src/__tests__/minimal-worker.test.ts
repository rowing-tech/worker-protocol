import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Report, verify } from "../index.ts";

/**
 * The claim `packages/README.md` makes, verified rather than asserted.
 *
 * `examples/reference-worker` proves that a Worker CAN conform: it is arranged so that every rule
 * with a witness has one, and it is explicitly not a template. This suite proves the other half,
 * which is the one a reader actually cares about — that a Worker written the way somebody would
 * write one, with nothing in it but its own domain, conforms without being arranged to.
 *
 * `pnpm dx:check` holds that file under a line count and this holds it to the protocol. Either one
 * alone would be worth little: a short file that does not conform proves nothing, and a conformant
 * one of a thousand lines is the problem this pair exists to keep measuring.
 *
 * **One run, asserted from several tests.** The minimal Worker keeps its Facts in module scope, as
 * the smallest honest Worker would, so a verification is not repeatable against the same process:
 * the Action it performs resolves the condition of the Task it claimed, which is TASK-15 working
 * and is the thing being demonstrated. Running the tool once and reading the one report is both
 * more honest and what an operator does.
 */

/**
 * What this Worker's operators would tell a verifier — and it is short, which is the point.
 *
 * The reference Worker needs a second credential, an unprivileged one, a boot window, replaceable
 * settings and a published event, because it exists to put the `H` rules within reach. A Worker
 * that was merely written needs none of that: what it has is an Action that is safe to perform and
 * a Task it does not mind having claimed.
 */
const ARRANGEMENT = {
  safeAction: { name: "record-check", input: { vehicle: "ABC-123", reachable: true } },
  mayClaim: true,
  // The Task the safe Action answers, and not merely any Task: TASK-22's witness is an outcome
  // posted on a Claim whose Task the Action has already closed, so the two have to be about the
  // same vehicle. Naming a different one leaves the rule reporting `not exercised`, correctly.
  claimableTask: "silent:ABC-123",
};

describe("the minimal worker", () => {
  let report: Report;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // REG-3: the minimal Worker reads its credential from the environment, as a deployed one
    // would, so this is set before the module is imported and its Worker is built.
    process.env.CREDENTIAL = "m-token";
    const { server } = await import("@worker-protocol/minimal-worker");
    const listening = server();
    await new Promise<void>((done) => listening.listen(0, "127.0.0.1", () => done()));
    const { port } = listening.address() as AddressInfo;
    close = () => new Promise<void>((done) => listening.close(() => done()));

    report = await verify({
      baseUrl: `http://127.0.0.1:${port}`,
      credential: "m-token",
      mayPerform: true,
      arrangement: ARRANGEMENT,
    });
  });

  afterAll(async () => {
    await close();
  });

  const verdict = (id: string) => report.results.find((r) => r.rule.id === id)?.verdict;

  it("conforms, with nothing in it but its own domain", () => {
    // DESC-3 fixes `https` and this test reaches the Worker over a loopback socket in plaintext,
    // which is the harness's fault and not the Worker's — the verifier is deliberately not taught
    // an exception for localhost, because a tool that quietly excused a rule would be deciding
    // something the specification did not.
    const failing = report.results.filter((r) => r.verdict === "fails").map((r) => r.rule.id);
    expect(failing).toEqual(["DESC-3"]);
  });

  it("is judged on every rule a tool can observe against a Worker nobody arranged", () => {
    // The `W` rules this Worker exercises have a verdict. The ones it does not are the states it
    // does not happen to be in, which is `not exercised` and is a fact about this Worker rather
    // than a gap in the tool.
    const judged = report.results.filter(
      (r) => r.rule.reach === "W" && (r.verdict === "passes" || r.verdict === "fails"),
    );
    expect(judged.length).toBeGreaterThan(60);

    // And the rules that need a Worker ARRANGED to be observed report what was missing rather than
    // a verdict, which is the whole difference between this Worker and the reference one.
    const arranged = report.results.filter((r) => r.rule.reach === "H");
    expect(arranged.some((r) => r.verdict === "notExercised")).toBe(true);
  });

  it("carries the Claim lifecycle it never wrote a line of", () => {
    // The whole of `spec/tasks-and-claims.md` that a Worker would otherwise implement: the lease
    // and its expiry, exclusivity, renewal, the outcome, the fencing token, the Claim that
    // survives its Task, the claim by type. `examples/minimal-worker` declares `open()` and
    // `claimByType` and nothing else, and every one of these passes.
    for (const id of [
      "TASK-9",
      "TASK-10",
      "TASK-12",
      "TASK-13",
      "TASK-14",
      "TASK-17",
      "TASK-21",
      "TASK-22",
      "TASK-23",
      "TASK-24",
      "TASK-25",
    ]) {
      expect(verdict(id), id).toBe("passes");
    }

    // TASK-26 is the one that cannot pass here, and the tool saying so is the point rather than a
    // gap. Its negative half — that a Contract's credential does NOT read `holder` — needs a
    // Contract credential to compare against, and a Worker nobody has brokered a Contract over has
    // none to give. A verifier that passed it on the positive half alone would be vouching for the
    // half that matters.
    expect(verdict("TASK-26")).toBe("notExercised");
    expect(report.results.find((r) => r.rule.id === "TASK-26")?.detail).toContain("Contract");
  });

  it("cuts its metric buckets in a zone that observes daylight saving", () => {
    // MET-20 and MET-7 are the rules a Worker author would have got right in UTC and wrong
    // everywhere else. This Worker declares `Europe/Madrid` and writes no calendar arithmetic.
    for (const id of ["MET-6", "MET-13", "MET-20"]) expect(verdict(id), id).toBe("passes");
  });

  it("answers the page envelope and the refusals it never wrote either", () => {
    // ENDP-20 through ENDP-24 and the error vocabulary: a Worker that declared a Capability got
    // the cursor, the ordering, the unknown-filter refusal and the envelope with it.
    for (const id of ["ENDP-5", "ENDP-20", "ENDP-24", "ENDP-25", "ENDP-26", "ENDP-29"]) {
      expect(verdict(id), id).toBe("passes");
    }
  });
});

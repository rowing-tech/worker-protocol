import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readDescriptor } from "./checks/descriptor.ts";
import { type Code, judgeTranscript } from "./checks/endpoints.ts";
import { checkHealth } from "./checks/health.ts";
import { callSurfaces } from "./checks/surfaces.ts";
import { type Report, type Result, type Rule, unclaimed } from "./report.ts";
import { transcript } from "./transcript.ts";

export type { Report, Result, Rule, Verdict } from "./report.ts";
export { tally } from "./report.ts";
export type { Exchange } from "./transcript.ts";

/**
 * `@worker-protocol/conformance` — point it at a Worker's base URL, get a report of what it
 * complies with.
 *
 * Its subject is a Worker and nothing else. Twenty-one rules in `spec/` bind a verifier, a Control
 * Tower, a consumer, an issuer or the specification itself; this tool reports those as
 * `otherSubject` rather than passing them, because it never contacted the party they oblige.
 * `conformance/verifiability.md` is where that classification is decided and `conformance/
 * README.md` holds the verdict vocabulary.
 *
 * Nothing here carries behaviour of its own. Every check reports against a rule id, and a check
 * that observed something `spec/` does not require would be this package making the standard.
 */

export type VerifyOptions = {
  /** The Worker's enrolled base URL, with or without a path. */
  baseUrl: string;
  /** Presented as `Authorization: Bearer <token>` (REG-3). */
  credential?: string;
  /** For tests and for a caller that needs its own agent. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
};

type Universe = { rules: Rule[]; codes: Code[] };

/** Generated from `spec/` by `src/generate-rules.ts` and committed beside the source. */
export async function universe(): Promise<Universe> {
  const path = join(import.meta.dirname, "..", "rules.json");
  return JSON.parse(await readFile(path, "utf8")) as Universe;
}

export async function verify(options: VerifyOptions): Promise<Report> {
  const { rules: all, codes } = await universe();
  const byId = new Map(all.map((rule) => [rule.id, rule]));
  const tape = transcript(options.fetch ?? globalThis.fetch, options.credential);

  const descriptor = await readDescriptor(options.baseUrl, byId, tape);
  const results: Result[] = [...descriptor.results];

  if (descriptor.document !== null && descriptor.url !== null) {
    results.push(
      ...(await callSurfaces(descriptor.surfaces, descriptor.url, byId, tape, options.credential)),
    );
    results.push(
      ...(await checkHealth(
        descriptor.document.capabilities.health,
        descriptor.surfaces.find((s) => s.capability === "health")?.url ?? null,
        byId,
        tape,
      )),
    );
  }

  // Last, and over everything the run provoked. ENDP-26 is a statement about a set of responses
  // rather than about one, so it cannot be asked until there are no more to come.
  const declared = new Set([
    ...(descriptor.url === null ? [] : [descriptor.url]),
    ...descriptor.surfaces.map((s) => s.url),
  ]);
  results.push(...judgeTranscript(tape.exchanges, codes, declared, byId));

  // Every rule gets a verdict, never only the ones a check claimed. A report covering 23 rules of
  // 102, all green, tells an operator the Worker was checked against the protocol — and the reader
  // concludes more than was established, which is the fault this whole directory is written
  // against. `unclaimed` is what says which kind of silence each remaining rule is.
  const claimed = new Set(results.map((result) => result.rule.id));
  const complete: Result[] = [
    ...results,
    ...all.filter((rule) => !claimed.has(rule.id)).map(unclaimed),
  ];
  complete.sort((a, b) => a.rule.id.localeCompare(b.rule.id, "en", { numeric: true }));

  return {
    baseUrl: options.baseUrl,
    edition: descriptor.document?.edition ?? null,
    results: complete,
  };
}

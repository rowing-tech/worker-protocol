import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readDescriptor } from "./checks/descriptor.ts";
import { type Report, type Result, type Rule, unclaimed } from "./report.ts";

export type { Report, Result, Rule, Verdict } from "./report.ts";
export { tally } from "./report.ts";

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
  /** Presented as `Authorization: Bearer <token>` on every request (REG-3). */
  credential?: string;
  /** For tests and for a caller that needs its own agent. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
};

/** The rule universe, generated from `spec/` by `src/generate-rules.ts` and committed beside it. */
export async function rules(): Promise<Rule[]> {
  const path = join(import.meta.dirname, "..", "rules.json");
  const { rules: all } = JSON.parse(await readFile(path, "utf8")) as { rules: Rule[] };
  return all;
}

export async function verify(options: VerifyOptions): Promise<Report> {
  const all = await rules();
  const byId = new Map(all.map((rule) => [rule.id, rule]));
  const send = options.fetch ?? globalThis.fetch;

  const request = (url: string) =>
    send(url, {
      headers: options.credential ? { authorization: `Bearer ${options.credential}` } : {},
      redirect: "manual",
    });

  const { results, document } = await readDescriptor(options.baseUrl, byId, request);

  // Every rule gets a verdict, never only the ones a check claimed. A report covering 10 rules of
  // 102, all green, tells an operator the Worker was checked against the protocol — and the reader
  // concludes more than was established, which is the fault this whole directory is written
  // against. `unclaimed` is what says which kind of silence each remaining rule is.
  const claimed = new Set(results.map((result) => result.rule.id));
  const complete: Result[] = [
    ...results,
    ...all.filter((rule) => !claimed.has(rule.id)).map(unclaimed),
  ];
  complete.sort((a, b) => a.rule.id.localeCompare(b.rule.id, "en", { numeric: true }));

  return { baseUrl: options.baseUrl, edition: document?.edition ?? null, results: complete };
}

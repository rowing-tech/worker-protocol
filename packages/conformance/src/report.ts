/**
 * The verdict vocabulary, which `conformance/README.md` states and this file encodes.
 *
 * Nothing here decides anything. Every verdict corresponds to a sentence in that document, and the
 * one property worth protecting in code is the one the prose spends a paragraph on: `notExercised`
 * and `unverified` are separate, because they read alike on a page and are opposite facts.
 */

/** A rule as `packages/conformance/rules.json` records it, generated from `spec/`. */
export type Rule = {
  id: string;
  /** The `spec/` file that defines it, so a report can group by subject. */
  file: string;
  /** `spec/README.md`: a contract, or advice this specification has standing to give. */
  class: "required" | "recommended";
  /** `conformance/verifiability.md`: what a check can observe. */
  reach: "W" | "H" | "P" | "N" | "—";
};

export type Verdict =
  /** The check ran and the Worker satisfied it. */
  | "passes"
  /**
   * The check ran and the Worker did not satisfy it. A `recommended` rule is still reported with
   * this verdict; it is the rule's class, printed beside it, that keeps a report from reading as a
   * verdict where the specification has no standing to give one.
   */
  | "fails"
  /**
   * A check exists and this run did not reach it: the Worker declares no such Capability, or the
   * check needs a Worker arranged to be observed and this one is not.
   */
  | "notExercised"
  /** The rule's subject is the Worker and no party outside it can observe a violation. */
  | "unverified"
  /** The rule binds a verifier, a Tower, a consumer, an issuer or this specification. */
  | "otherSubject";

export type Result = {
  rule: Rule;
  verdict: Verdict;
  /** Why, in one line. Required for every verdict but `passes`, where the rule says it already. */
  detail?: string;
};

export type Report = {
  /** The base URL the Worker was enrolled as, exactly as the caller gave it. */
  baseUrl: string;
  /** The edition the Descriptor declared, or null where none could be read. */
  edition: string | null;
  /**
   * The edition this verifier holds.
   *
   * DESC-25 binds a verifier rather than a Worker, and publishing an edition is what made it ours
   * to obey: a tool that does not hold the declared MAJOR verifies nothing and says it is the one
   * that is behind. A report that left this out would leave a reader unable to tell a Worker that
   * failed from a verifier that could not read it.
   */
  verifierEdition: string;
  /** Set where DESC-25 stopped the run: this verifier is older than the Worker. */
  older?: true;
  results: Result[];
};

/**
 * The verdict a rule gets when no check claimed it.
 *
 * This is the whole reason a report covers every rule rather than only the ones it exercised. A
 * rule whose reach says a Worker could be observed and that nothing observed is `notExercised` —
 * a gap somebody can close. One that binds another party, or that nothing can ever see, is not a
 * gap and says so under its own name.
 */
export const unclaimed = (rule: Rule): Result => {
  switch (rule.reach) {
    case "P":
      return { rule, verdict: "otherSubject", detail: "the subject of this rule is not a Worker" };
    case "N":
      return { rule, verdict: "unverified", detail: "no party outside the Worker can observe it" };
    case "—":
      return {
        rule,
        verdict: "notExercised",
        detail: "the surface it is about belongs to a spec/ file that is still open",
      };
    default:
      return { rule, verdict: "notExercised", detail: "no check in this verifier claims it yet" };
  }
};

/** Counts by verdict, for the one line a report ends with. */
export const tally = (results: Result[]): Record<Verdict, number> => {
  const counts: Record<Verdict, number> = {
    passes: 0,
    fails: 0,
    notExercised: 0,
    unverified: 0,
    otherSubject: 0,
  };
  for (const result of results) counts[result.verdict] += 1;
  return counts;
};

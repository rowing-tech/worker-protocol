/**
 * Whether one Worker can answer another's Tasks, decided from what both of them declared.
 *
 * This is the question an operator asks when enrolling a Worker — *can it take that one's work?* —
 * and `spec/tasks.md` is what answers it. TASK-2 has the owner declare the payload it sends under
 * `raises`; TASK-30 has the answerer declare what it requires under `skills`. NAME-6 fixes which
 * way to judge the two: a document a Worker receives is judged against the party that sends it.
 *
 * **It compares declarations and calls nothing.** Both Descriptors are already in hand — a Tower
 * holds a dated copy of each (DESC-20) — so the answer arrives at enrollment, before any Task
 * exists and before any work changes hands, which is the whole point of asking. Sampling the
 * Tasks an owner happens to have open answers a weaker question: at enrollment there are usually
 * none, and *nothing was open to check* is not *this pairing works*.
 *
 * It lives here rather than in a Tower because a Tower is a role and not a product, and this is an
 * algorithm `spec/` states rather than a policy anybody chooses. `packages/README.md` puts the
 * rules that bind a consumer in this package for the same reason: the alternative is every Tower,
 * teams app and proxy deriving it again, and disagreeing about the cases below.
 */

import type { descriptor } from "@worker-protocol/schemas";
import type * as z from "zod";

type Descriptor = z.infer<typeof descriptor>;

/** A JSON Schema as it travels in a Descriptor, read only for the two members compared below. */
type Declared = { type?: unknown; required?: unknown; properties?: Record<string, unknown> };

/**
 * What was decided, and why — so that a console can say it rather than showing a boolean.
 *
 * `unknown` is not `false`. An answerer that declares the Skill and states no requirement has
 * claimed the capability and said nothing about what it needs, which TASK-30 admits; a Tower that
 * reported that as a refusal would be inventing an obligation the specification does not carry.
 */
export type Compatibility = {
  verdict: "compatible" | "incompatible" | "unknown";
  why: string;
};

/** The names a JSON Schema requires, or none where it names no `required` array. */
const requiredOf = (schema: Declared): string[] =>
  Array.isArray(schema.required) ? schema.required.filter((one) => typeof one === "string") : [];

/** The `type` a schema fixes for one member, where it fixes one. */
const typeOf = (schema: Declared, member: string): unknown =>
  (schema.properties?.[member] as Declared | undefined)?.type;

/**
 * Can `answerer` answer `owner`'s Tasks of this type?
 *
 * The tractable half of schema comparison, and the half `spec/tasks.md` actually states: **the
 * answerer may ask for less than the owner sends, and may not ask for more.** So every member the
 * answerer requires must be one the owner requires too, and where both fix a `type` for it the two
 * must agree. Full subsumption between two JSON Schemas is undecidable in general, and a Tower
 * that attempted it would refuse pairings nobody could explain; this answers what the rule claims
 * and reports `unknown` for everything else, which is the honest boundary.
 */
export function canAnswer(owner: Descriptor, answerer: Descriptor, type: string): Compatibility {
  const skill = answerer.skills?.[type];
  if (skill === undefined) {
    return { verdict: "incompatible", why: `it declares no Skill for ${type}` };
  }

  // TASK-30: the requirement is optional, and leaving it out means what it says.
  const requires = skill.payload as Declared | undefined;
  if (requires === undefined) {
    return { verdict: "unknown", why: "it declares the Skill and states no requirement" };
  }

  const raises = (owner.capabilities.tasks as { raises?: Record<string, { payload: Declared }> })
    ?.raises;
  const sends = raises?.[type]?.payload;
  if (sends === undefined) {
    return { verdict: "incompatible", why: `the owner raises no ${type}` };
  }

  const missing = requiredOf(requires).filter((member) => !requiredOf(sends).includes(member));
  if (missing.length > 0) {
    return {
      verdict: "incompatible",
      why: `it requires ${missing.join(", ")}, which the owner does not send`,
    };
  }

  const disagreeing = requiredOf(requires).filter((member) => {
    const wanted = typeOf(requires, member);
    const given = typeOf(sends, member);
    return wanted !== undefined && given !== undefined && wanted !== given;
  });
  if (disagreeing.length > 0) {
    return {
      verdict: "incompatible",
      why: `the owner sends ${disagreeing.join(", ")} as another type`,
    };
  }

  return { verdict: "compatible", why: "everything it requires is something the owner sends" };
}

/**
 * Whether one Worker can answer another's Tasks, decided from what both of them declared.
 *
 * This is the question an operator asks when enrolling a Worker — *can it take that one's work?* —
 * and `spec/tasks.md` is what answers it. TASK-32 has the owner declare the payload it sends under
 * `raises`; TASK-31 has the answerer declare what it requires under `skills`. NAME-6 fixes which
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

/** A JSON Schema as it travels in a Descriptor, read only for the members compared below. */
type Declared = {
  type?: unknown;
  const?: unknown;
  required?: unknown;
  properties?: Record<string, Declared>;
  anyOf?: Declared[];
  oneOf?: Declared[];
};

/** The variants of a union schema, or the schema itself where it is not one. */
const variantsOf = (schema: Declared): Declared[] => schema.anyOf ?? schema.oneOf ?? [schema];

/**
 * The member that tells a union's variants apart, where one does — TASK-32's discriminator.
 *
 * It is a member every variant fixes to a different constant, which is what `z.discriminatedUnion`
 * writes and what TASK-32 requires of a Task with several endings.
 */
function discriminator(variants: Declared[]): string | undefined {
  if (variants.length < 2) return undefined;
  const first = variants[0];
  if (first === undefined) return undefined;
  return Object.keys(first.properties ?? {}).find((member) => {
    const fixed = variants.map((one) => one.properties?.[member]?.const);
    return fixed.every((one) => one !== undefined) && new Set(fixed).size === variants.length;
  });
}

/**
 * What was decided, and why — so that a console can say it rather than showing a boolean.
 *
 * `unknown` is not `false`. An answerer that declares the Skill and states no requirement has
 * claimed the capability and said nothing about what it needs, which TASK-31 admits; a Tower that
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
const typeOf = (schema: Declared, member: string): unknown => schema.properties?.[member]?.type;

/**
 * Whether what one party requires is covered by what the other provides — NAME-6, one direction.
 *
 * The tractable part of comparing two JSON Schemas, and the part `spec/tasks.md` states in TASK-31:
 * a receiver may ask for less than the sender produces and may not ask for more. So every member
 * the receiver requires must be one the sender declares, and where both fix a `type` for it the two
 * must agree. Full subsumption is undecidable in general, and a Tower that attempted it would refuse
 * pairings nobody could explain; this decides what the rule claims and no more. It is assignability
 * and it reads the same in both directions, which is why it is stated here once rather than derived
 * from either half's rule.
 *
 * **The discriminator is the owner's word and is not charged to the answerer.** TASK-32 puts a
 * Task's endings in a union told apart by a member the OWNER mints — `outcome: "found"` — and an
 * answerer writing its own Descriptor cannot know that word, because it serves owners it has never
 * read. Counting it as coverage the answerer owes would refuse every honest answerer and would put
 * the per-owner mapping back exactly where withdrawing TASK-2's list took it from. So it is skipped
 * where the answerer says nothing about it, and used to pick the variant where it says something.
 */
function covered(requires: Declared, provides: Declared, noun: string): Compatibility {
  const takes = variantsOf(requires);
  const told = discriminator(takes);

  for (const produced of variantsOf(provides)) {
    // Where the answerer names the ending, that variant is the one it is answering. Where it does
    // not, any variant it satisfies will do — it produces a subtype, which is assignable.
    const said = told === undefined ? undefined : produced.properties?.[told]?.const;
    const against = takes
      .filter((taken) => said === undefined || taken.properties?.[told as string]?.const === said)
      .map((taken) => accepts(taken, produced, told));

    if (against.length === 0) {
      return { verdict: "incompatible", why: `${noun} no ending it names` };
    }
    if (!against.some((one) => one.length === 0)) {
      return { verdict: "incompatible", why: `${noun} ${(against[0] as string[]).join(", ")}` };
    }
  }
  return { verdict: "compatible", why: "" };
}

/**
 * One variant against one: the members it is missing and the ones it disagrees about, or none.
 *
 * `told` is skipped, for the reason `covered` gives. The complaints come back as names rather than
 * a sentence so that the direction is written once, by the caller that knows which way this is.
 */
function accepts(requires: Declared, provides: Declared, told: string | undefined): string[] {
  const offered = Object.keys(provides.properties ?? {});
  const owed = requiredOf(requires).filter((member) => member !== told);
  const missing = owed.filter((member) => !offered.includes(member));
  const disagreeing = owed.filter((member) => {
    const wanted = typeOf(requires, member);
    const given = typeOf(provides, member);
    return wanted !== undefined && given !== undefined && wanted !== given;
  });
  return [...missing, ...disagreeing];
}

/**
 * Can `answerer` answer `owner`'s Tasks of this type?
 *
 * Two documents travel, one each way, so there are two halves to judge and both must hold. The
 * Task goes from owner to answerer: what the answerer REQUIRES (TASK-31 `payload`) must be covered
 * by what the owner SENDS (TASK-32 `payload`). The answer goes back: what the owner's answering
 * Action TAKES (ACT-2 `input`, named by TASK-32 `answeredBy`) must be covered by what the answerer
 * PRODUCES (TASK-31 `produces`). Either half the answerer left undeclared is `unknown` — a claim
 * with nothing to check, which TASK-31 admits and a Tower must not report as a refusal.
 */
export function canAnswer(owner: Descriptor, answerer: Descriptor, type: string): Compatibility {
  const skill = answerer.skills?.[type];
  if (skill === undefined) {
    return { verdict: "incompatible", why: `it declares no Skill for ${type}` };
  }

  const tasks = owner.capabilities.tasks as
    | { raises?: Record<string, { payload: Declared; answeredBy: string }> }
    | undefined;
  const raised = tasks?.raises?.[type];
  if (raised === undefined) {
    return { verdict: "incompatible", why: `the owner raises no ${type}` };
  }

  // Receiving: the Task the owner sends, against what the answerer needs to be handed.
  const requires = skill.payload as Declared | undefined;
  const receiving: Compatibility =
    requires === undefined
      ? { verdict: "unknown", why: "it states no requirement for what it receives" }
      : covered(requires, raised.payload, "it requires what the owner does not send:");

  // Sending: what the answerer produces, against what the one Action the owner names will take.
  // Where the Task has several endings they are variants of that input, and producing some of them
  // is producing a subtype — assignable, and `covered` looks inside the union to say so.
  const declared = (owner.capabilities.actions as { accepts?: Record<string, { input: Declared }> })
    ?.accepts;
  const produces = skill.produces as Declared | undefined;
  const takes = declared?.[raised.answeredBy]?.input;
  let sending: Compatibility;
  if (produces === undefined) {
    sending = { verdict: "unknown", why: "it states nothing about what it produces" };
  } else if (takes === undefined) {
    sending = { verdict: "unknown", why: "the owner's answering Action is not one it accepts" };
  } else {
    sending = covered(takes, produces, "the owner's Action requires what it does not produce:");
  }

  const halves = [receiving, sending];
  const refused = halves.find((one) => one.verdict === "incompatible");
  if (refused !== undefined) return refused;
  const open = halves.filter((one) => one.verdict === "unknown");
  if (open.length > 0) return { verdict: "unknown", why: open.map((one) => one.why).join("; ") };
  return {
    verdict: "compatible",
    why: "it can read what the owner sends and produce what it takes",
  };
}

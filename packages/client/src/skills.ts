/**
 * Whether one Worker can answer another's Tasks, decided from what both of them declared.
 *
 * This is the question an operator asks when enrolling a Worker — *can it take that one's work?* —
 * and `spec/tasks.md` is what answers it. TASK-35 has the owner declare the payload it sends under
 * `raises`, and the Actions that answer it; TASK-36 has the answerer declare what it requires under
 * `skills`, and what it produces for each of those Actions it can perform. NAME-6 fixes which way
 * to judge each pair: a document a Worker receives is judged against the party that sends it.
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
import { type Declared, discriminator, requiredOf, variantsOf } from "./json-schema.ts";

type Descriptor = z.infer<typeof descriptor>;

/**
 * What was decided, and why — so that a console can say it rather than showing a boolean.
 *
 * `unknown` is not `false`. An answerer that declares the Skill and states no requirement has
 * claimed the capability and said nothing about what it needs, which TASK-36 admits; a Tower that
 * reported that as a refusal would be inventing an obligation the specification does not carry.
 *
 * `through` names the owner's Actions this answerer can perform with what it produces, in the order
 * the owner declared them, wherever the answering half found any. A Task type may have several
 * answers and an answerer that gives one of them is a fit; which one is what a Tower shows.
 */
export type Compatibility = {
  verdict: "compatible" | "incompatible" | "unknown";
  why: string;
  through?: string[];
};

/** The `type` a schema fixes for one member, where it fixes one. */
const typeOf = (schema: Declared, member: string): unknown => schema.properties?.[member]?.type;

/**
 * Whether what one party requires is covered by what the other provides — NAME-6, one direction.
 *
 * The tractable part of comparing two JSON Schemas, and the part `spec/tasks.md` states in TASK-36:
 * a receiver may ask for less than the sender produces and may not ask for more. So every member
 * the receiver requires must be one the sender declares, and where both fix a `type` for it the two
 * must agree. Full subsumption is undecidable in general, and a Tower that attempted it would refuse
 * pairings nobody could explain; this decides what the rule claims and no more. It is assignability
 * and it reads the same in both directions, which is why it is stated here once rather than derived
 * from either half's rule.
 *
 * **A discriminator is the owner's word and is not charged to the answerer.** An Action's input
 * may be a union told apart by a member the OWNER mints — `outcome: "found"` — and an answerer
 * writing its own Descriptor need not repeat that word to be producing one of its variants.
 * Counting it as coverage the answerer owes would refuse an answerer that produces exactly one
 * variant and says so by its shape. So it is skipped where the answerer says nothing about it, and
 * used to pick the variant where it says something.
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
 * Task goes from owner to answerer: what the answerer REQUIRES (TASK-36 `payload`) must be covered
 * by what the owner SENDS (TASK-35 `payload`). The answer goes back: for at least one Action the
 * owner names (TASK-35 `answeredBy`), what it TAKES (ACT-2 `input`) must be covered by what the
 * answerer PRODUCES for that name (TASK-36 `produces`). Either half the answerer left undeclared is
 * `unknown` — a claim with nothing to check, which TASK-36 admits and a Tower must not report as a
 * refusal.
 */
export function canAnswer(owner: Descriptor, answerer: Descriptor, type: string): Compatibility {
  const skill = answerer.skills?.[type];
  if (skill === undefined) {
    return { verdict: "incompatible", why: `it declares no Skill for ${type}` };
  }

  const tasks = owner.capabilities.tasks as
    | { raises?: Record<string, { payload: Declared; answeredBy?: string[] }> }
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

  const sending = answering({
    names: raised.answeredBy ?? [],
    produces: skill.produces as Record<string, Declared> | undefined,
    accepts: (owner.capabilities.actions as { accepts?: Record<string, { input: Declared }> })
      ?.accepts,
  });
  const through = sending.through === undefined ? {} : { through: sending.through };

  const halves = [receiving, sending];
  const refused = halves.find((one) => one.verdict === "incompatible");
  if (refused !== undefined) return { verdict: "incompatible", why: refused.why, ...through };
  const open = halves.filter((one) => one.verdict === "unknown");
  if (open.length > 0) {
    return { verdict: "unknown", why: open.map((one) => one.why).join("; "), ...through };
  }
  return {
    verdict: "compatible",
    why: "it can read what the owner sends and produce what it takes",
    ...through,
  };
}

/**
 * The answering half: which of the owner's Actions the answerer can perform with what it produces.
 *
 * Matched by name, and only inside the one Task type both sides already agreed on, which is why the
 * name needs no namespace (TASK-35). One Action that fits is enough — a Task type with several
 * answers is answered by giving any of them — and an Action the answerer produces for and the owner
 * does not name is simply not an answer here: two owners that call one answer by two names are
 * asking for two documents.
 */
function answering(declared: {
  names: string[];
  produces: Record<string, Declared> | undefined;
  accepts: Record<string, { input: Declared }> | undefined;
}): Compatibility {
  const { names, produces, accepts } = declared;
  if (produces === undefined) {
    return { verdict: "unknown", why: "it states nothing about what it produces" };
  }
  if (names.length === 0) {
    return { verdict: "unknown", why: "the owner names no Action that answers this type" };
  }
  const shared = names.filter((name) => produces[name] !== undefined);
  if (shared.length === 0) {
    return {
      verdict: "incompatible",
      why: `it produces for none of the owner's answers: ${names.join(", ")}`,
    };
  }

  const fits: string[] = [];
  const refusals: string[] = [];
  for (const name of shared) {
    const takes = accepts?.[name]?.input;
    // A name the owner's own `actions` entry does not accept is the owner's Descriptor disagreeing
    // with itself, which the verifier reports against it; it is no answer here and no refusal.
    if (takes === undefined) continue;
    const judged = covered(
      takes,
      produces[name] as Declared,
      `\`${name}\` requires what it does not produce:`,
    );
    if (judged.verdict === "compatible") fits.push(name);
    else refusals.push(judged.why);
  }

  if (fits.length > 0) return { verdict: "compatible", why: "", through: fits };
  if (refusals.length > 0) return { verdict: "incompatible", why: refusals.join("; ") };
  return { verdict: "unknown", why: "none of the owner's answering Actions is one it accepts" };
}

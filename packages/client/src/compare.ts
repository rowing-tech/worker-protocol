/**
 * What changed under a name a Worker kept, between two copies of its Descriptor — REG-36.
 *
 * NAME-2 forbids reusing a name for a different thing, and NAME-5 makes a schema that changed
 * breakingly a different thing. Nothing on a call reveals it: a consumer is refused and cannot tell
 * a Worker that broke a name from one it is calling wrongly, or is not refused and reads something
 * else. The Tower is the only party holding two moments of one Worker, because DESC-20 has it keep
 * a dated copy, and REG-36 asks it to compare them. This is that comparison, beside `canAnswer`,
 * for the reason `packages/README.md` gives for that one: it is an algorithm `spec/` states, and
 * every Tower deriving it again would disagree about the edges.
 *
 * **It judges the half of NAME-5 a schema can show, and an empty answer certifies nothing.** A
 * field that kept its type and changed its units passes every comparison two schemas allow, and
 * REG-36's own argument says so. What it finds is said per name and per member, so an operator
 * reads *`currency` is now required* rather than *the Action changed*.
 *
 * **The direction is NAME-6's.** What a Worker receives is judged against every sender built on
 * the old schema, so it is a document the old one accepted and the new one refuses. What it sends
 * is judged against every reader built on the old one, so it is the other way round. A required
 * member added to an Action's input breaks every caller; the same member added to an event's data
 * breaks nobody, and a comparison without the direction would report both.
 *
 * Full subsumption between two JSON Schemas is not decided here, for the reason `canAnswer` gives:
 * a Tower that attempted it would report changes nobody could explain. The keywords below are the
 * ones Zod writes and a Worker's author changes; a keyword outside them that differs between the
 * two copies is reported as `unjudged`, so a change this cannot read is said rather than passed.
 */

import type { descriptor } from "@worker-protocol/schemas";
import type * as z from "zod";
import { type Declared, discriminator, requiredOf, variantsOf } from "./json-schema.ts";

type Descriptor = z.infer<typeof descriptor>;

/** One schema a declaration carries, named for an operator who never read the Descriptor. */
export type Carried = "action input" | "action result" | "task payload" | "event data";

/** One change REG-36 shows an operator. */
export type Change = {
  /** Which schema of which declaration. */
  carried: Carried;
  /** The name the declaration is held under, which is the one that was kept. */
  name: string;
  /** Where inside the schema, as dotted members with `[]` for an array's items; `""` at the root. */
  at: string;
  /**
   * `breaking`: a document valid on one side is refused on the other, in the direction NAME-6
   * gives. `unjudged`: the two differ in a keyword this comparison does not read, so it cannot say.
   */
  verdict: "breaking" | "unjudged";
  why: string;
};

/**
 * Every change under a kept name, between the copy a Tower held and the one it just read.
 *
 * A name in only one of the two is not a change under a kept name: one that left is the
 * announcement NAME-2 relies on, and one that arrived is new. Neither is reported.
 */
export function compare({ before, after }: { before: Descriptor; after: Descriptor }): Change[] {
  const changes: Change[] = [];
  const kept = <T>(
    old: Record<string, T> | undefined,
    now: Record<string, T> | undefined,
  ): [string, T, T][] =>
    Object.entries(old ?? {}).flatMap(([name, was]) => {
      const is = now?.[name];
      return is === undefined ? [] : [[name, was, is] as [string, T, T]];
    });

  const judge = (
    carried: Carried,
    name: string,
    receives: boolean,
    was: Declared,
    is: Declared,
  ) => {
    // NAME-6. Received: what the old schema accepted, refused by the new. Sent: the other way.
    const found = receives
      ? refusals({ wide: was, narrow: is, sides: { wide: "old", narrow: "new" }, at: "" })
      : refusals({ wide: is, narrow: was, sides: { wide: "new", narrow: "old" }, at: "" });
    for (const one of found) changes.push({ carried, name, ...one });
  };

  type Action = { input: Declared; result?: Declared };
  for (const [name, was, is] of kept(
    accepts(before) as Record<string, Action> | undefined,
    accepts(after) as Record<string, Action> | undefined,
  )) {
    judge("action input", name, true, was.input, is.input);
    if (was.result !== undefined && is.result === undefined) {
      changes.push({
        carried: "action result",
        name,
        at: "",
        verdict: "breaking",
        why: "the old declaration answers a result and the new one answers none",
      });
    } else if (was.result !== undefined && is.result !== undefined) {
      judge("action result", name, false, was.result, is.result);
    }
  }

  type Raised = { payload: Declared };
  for (const [name, was, is] of kept(
    raises(before) as Record<string, Raised> | undefined,
    raises(after) as Record<string, Raised> | undefined,
  )) {
    judge("task payload", name, false, was.payload, is.payload);
  }

  type Published = { data: Declared };
  for (const [name, was, is] of kept(
    publishes(before) as Record<string, Published> | undefined,
    publishes(after) as Record<string, Published> | undefined,
  )) {
    judge("event data", name, false, was.data, is.data);
  }

  return changes;
}

const accepts = (document: Descriptor) =>
  (document.capabilities.actions as { accepts?: Record<string, unknown> } | undefined)?.accepts;
const raises = (document: Descriptor) =>
  (document.capabilities.tasks as { raises?: Record<string, unknown> } | undefined)?.raises;
const publishes = (document: Descriptor) =>
  (document.capabilities.events as { publishes?: Record<string, unknown> } | undefined)?.publishes;

/** Read by no validator, so a difference in one of them changes no document's verdict. */
const ANNOTATIONS = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

/** The keywords judged below. Any other that differs is `unjudged`. */
const JUDGED = new Set([
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "anyOf",
  "oneOf",
  "pattern",
  "format",
  "minimum",
  "exclusiveMinimum",
  "minLength",
  "minItems",
  "minProperties",
  "maximum",
  "exclusiveMaximum",
  "maxLength",
  "maxItems",
  "maxProperties",
]);

/** A lower bound refuses more as it rises, an upper one as it falls. */
const LOWER = ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"] as const;
const UPPER = ["maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"] as const;

type Side = "old" | "new";
type Found = Omit<Change, "carried" | "name">;

/**
 * Where `narrow` refuses a document `wide` accepts, member by member.
 *
 * The names say which schema plays which part, because NAME-6 swaps them: for what a Worker
 * receives the old schema is the wide one, and for what it sends the new one is. `sides` carries
 * which is which into every sentence, so the operator reads *required by the new schema* and never
 * has to work out what *narrow* meant.
 */
function refusals({
  wide,
  narrow,
  sides,
  at,
}: {
  wide: unknown;
  narrow: unknown;
  sides: { wide: Side; narrow: Side };
  at: string;
}): Found[] {
  const breaking = (why: string, where = at): Found => ({ at: where, verdict: "breaking", why });

  // Boolean schemas: `true` accepts everything and `false` nothing.
  if (wide === false || narrow === true || isEmpty(narrow)) return [];
  if (narrow === false) return [breaking(`the ${sides.narrow} schema accepts nothing here`)];
  const w = (wide === true ? {} : wide) as Declared;
  const n = narrow as Declared;
  if (same(w, n)) return [];

  // Unions: every alternative the wide side accepts has to be accepted by one on the narrow side.
  const wideVariants = variantsOf(w);
  const narrowVariants = variantsOf(n);
  if (wideVariants.length > 1 || narrowVariants.length > 1) {
    const told = discriminator(narrowVariants);
    const found: Found[] = [];
    for (const variant of wideVariants) {
      const each = narrowVariants.map((other) =>
        refusals({ wide: variant, narrow: other, sides, at }),
      );
      if (each.some((one) => one.length === 0)) continue;
      // The alternative that answers to the same discriminator is the one to explain, where there
      // is one; where there is a single alternative it is the only candidate.
      const said = told === undefined ? undefined : variant.properties?.[told]?.const;
      const match =
        narrowVariants.length === 1
          ? 0
          : narrowVariants.findIndex(
              (other) => said !== undefined && other.properties?.[told as string]?.const === said,
            );
      if (match >= 0) found.push(...(each[match] as Found[]));
      else {
        found.push(
          breaking(
            `an alternative the ${sides.wide} schema accepts is accepted by no alternative of ` +
              `the ${sides.narrow}`,
          ),
        );
      }
    }
    return found;
  }

  const found: Found[] = [];

  // `type`, with `integer` inside `number`.
  const wideTypes = typesOf(w);
  const narrowTypes = typesOf(n);
  if (narrowTypes !== undefined) {
    const lost =
      wideTypes === undefined
        ? undefined
        : wideTypes.filter(
            (type) =>
              !narrowTypes.includes(type) &&
              !(type === "integer" && narrowTypes.includes("number")),
          );
    if (lost === undefined || lost.length > 0) {
      found.push(
        breaking(
          `typed ${narrowTypes.join(" or ")} by the ${sides.narrow} schema and ` +
            `${wideTypes === undefined ? "anything" : wideTypes.join(" or ")} by the ${sides.wide}`,
        ),
      );
    }
  }

  // `const` and `enum`: the values the narrow side admits must include every one the wide did.
  const wideValues = valuesOf(w);
  const narrowValues = valuesOf(n);
  if (narrowValues !== undefined) {
    if (wideValues === undefined) {
      found.push(
        breaking(
          `the ${sides.narrow} schema admits only ${list(narrowValues)} and the ${sides.wide} ` +
            "admitted any value",
        ),
      );
    } else {
      const lost = wideValues.filter((value) => !narrowValues.some((other) => same(value, other)));
      if (lost.length > 0) {
        found.push(breaking(`the ${sides.narrow} schema no longer admits ${list(lost)}`));
      }
    }
  }

  // `required`: a member the narrow side requires and the wide side did not.
  const wideRequired = requiredOf(w);
  for (const member of requiredOf(n)) {
    if (!wideRequired.includes(member)) {
      found.push(
        breaking(
          `required by the ${sides.narrow} schema and not by the ${sides.wide}`,
          join(at, member),
        ),
      );
    }
  }

  // `properties` and `additionalProperties`, member by member.
  const wideMembers = w.properties ?? {};
  const narrowMembers = n.properties ?? {};
  const narrowRest = n.additionalProperties;
  for (const [member, schema] of Object.entries(wideMembers)) {
    const there = narrowMembers[member];
    const where = join(at, member);
    if (there !== undefined) {
      found.push(...refusals({ wide: schema, narrow: there, sides, at: where }));
    } else if (narrowRest === false) {
      found.push(
        breaking(
          `declared by the ${sides.wide} schema and refused by the ${sides.narrow}, which ` +
            "admits no member it does not declare",
          where,
        ),
      );
    } else if (narrowRest !== undefined) {
      found.push(...refusals({ wide: schema, narrow: narrowRest, sides, at: where }));
    }
  }
  if (narrowRest === false && w.additionalProperties !== false) {
    found.push(
      breaking(
        `the ${sides.narrow} schema admits no member it does not declare, and the ` +
          `${sides.wide} admitted ${w.additionalProperties === undefined ? "any" : "some"}`,
      ),
    );
  }

  // `items`.
  if (n.items !== undefined) {
    found.push(...refusals({ wide: w.items ?? true, narrow: n.items, sides, at: `${at}[]` }));
  }

  // Bounds and patterns: refusing more is a lower bound rising, an upper one falling, or a pattern
  // or format that is new or different.
  for (const keyword of LOWER) {
    const was = w[keyword];
    const is = n[keyword];
    if (typeof is === "number" && (typeof was !== "number" || is > was)) {
      found.push(breaking(bound(keyword, was, is, sides)));
    }
  }
  for (const keyword of UPPER) {
    const was = w[keyword];
    const is = n[keyword];
    if (typeof is === "number" && (typeof was !== "number" || is < was)) {
      found.push(breaking(bound(keyword, was, is, sides)));
    }
  }
  for (const keyword of ["pattern", "format"] as const) {
    if (n[keyword] !== undefined && n[keyword] !== w[keyword]) {
      found.push(breaking(bound(keyword, w[keyword], n[keyword], sides)));
    }
  }

  // Anything else that differs is a change this does not read, said rather than passed.
  const keywords = new Set([...Object.keys(w), ...Object.keys(n)]);
  for (const keyword of keywords) {
    if (ANNOTATIONS.has(keyword) || JUDGED.has(keyword)) continue;
    if (!same(w[keyword], n[keyword])) {
      found.push({
        at,
        verdict: "unjudged",
        why: `\`${keyword}\` differs, and this comparison does not read it`,
      });
    }
  }

  return found;
}

const typesOf = (schema: Declared): string[] | undefined =>
  typeof schema.type === "string"
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type.filter((one) => typeof one === "string")
      : undefined;

const valuesOf = (schema: Declared): unknown[] | undefined =>
  "const" in schema ? [schema.const] : Array.isArray(schema.enum) ? schema.enum : undefined;

/** A schema with nothing but annotations accepts every document, as `true` does. */
const isEmpty = (schema: unknown): boolean =>
  typeof schema === "object" &&
  schema !== null &&
  Object.keys(schema).every((keyword) => ANNOTATIONS.has(keyword));

const join = (at: string, member: string): string => (at === "" ? member : `${at}.${member}`);

const list = (values: unknown[]): string => values.map((one) => JSON.stringify(one)).join(", ");

const bound = (keyword: string, was: unknown, is: unknown, sides: { wide: Side; narrow: Side }) =>
  `\`${keyword}\` is ${JSON.stringify(is)} in the ${sides.narrow} schema and ` +
  `${was === undefined ? "absent" : JSON.stringify(was)} in the ${sides.wide}`;

/** Structural equality over JSON, with object keys in any order. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((one, index) => same(one, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  );
}

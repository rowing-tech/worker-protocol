/**
 * Reading the JSON Schemas a Descriptor carries, for the two comparisons this package makes.
 *
 * `canAnswer` judges one Worker's declaration against another's, and `compare` judges one
 * Worker's declaration against its own earlier copy. Both meet the same unions and the same
 * `required` arrays, and the day the two read a union differently a Tower would call one pairing
 * compatible and the same change breaking. So the reading is written once, here.
 */

/**
 * A JSON Schema as it travels in a Descriptor. The members both comparisons read are named, and
 * anything else is reachable by keyword — which is how `compare` notices one it does not judge.
 */
export type Declared = {
  type?: unknown;
  const?: unknown;
  required?: unknown;
  properties?: Record<string, Declared>;
  anyOf?: Declared[];
  oneOf?: Declared[];
  [keyword: string]: unknown;
};

/** The variants of a union schema, or the schema itself where it is not one. */
export const variantsOf = (schema: Declared): Declared[] =>
  schema.anyOf ?? schema.oneOf ?? [schema];

/**
 * The member that tells a union's variants apart, where one does.
 *
 * It is a member every variant fixes to a different constant, which is what `z.discriminatedUnion`
 * writes. Nothing requires one (TASK-35 withdrew that), but where an Action's input has one it is
 * the owner's own word for each variant, and it is how a reader picks the variant meant.
 */
export function discriminator(variants: Declared[]): string | undefined {
  if (variants.length < 2) return undefined;
  const first = variants[0];
  if (first === undefined) return undefined;
  return Object.keys(first.properties ?? {}).find((member) => {
    const fixed = variants.map((one) => one.properties?.[member]?.const);
    return fixed.every((one) => one !== undefined) && new Set(fixed).size === variants.length;
  });
}

/** The names a JSON Schema requires, or none where it names no `required` array. */
export const requiredOf = (schema: Declared): string[] =>
  Array.isArray(schema.required) ? schema.required.filter((one) => typeof one === "string") : [];

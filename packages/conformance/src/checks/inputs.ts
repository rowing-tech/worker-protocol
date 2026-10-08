/**
 * TASK-37 and ALRT-9 — values a Task or an Alert fills in for the Actions it offers.
 *
 * Both rules say the same three things, about two surfaces: each key is an Action the Task or Alert
 * offers, each member is one that Action's input declares, and each value is one that member's
 * schema accepts. So both checks call this, and say the verdict under their own id.
 *
 * **The value is judged against what the member's schema fixes, and no further.** A verifier that
 * ran full JSON Schema validation would need a validator this package does not carry, and TASK-28's
 * payload is not validated against its declared schema either. What is read is `type`, `const` and
 * `enum`, which is what tells a vehicle id from a number and one ending from another — the register
 * in `conformance/verifiability.md` says so, rather than letting a pass claim more than it saw.
 */

/** A declared input, read only for the members and the keywords judged here. */
type Declared = {
  type?: unknown;
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, Declared>;
  anyOf?: Declared[];
  oneOf?: Declared[];
};

/** Whether a value is of one JSON Schema `type`. */
const isOf = (value: unknown, type: unknown): boolean => {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a member's schema accepts a value, as far as `type`, `const` and `enum` say. */
const agrees = (schema: Declared, value: unknown): boolean => {
  if (schema.const !== undefined) return same(schema.const, value);
  if (Array.isArray(schema.enum)) return schema.enum.some((one) => same(one, value));
  if (Array.isArray(schema.type)) return schema.type.some((one) => isOf(value, one));
  return isOf(value, schema.type);
};

/**
 * The faults in one Task's or Alert's `inputs`, judged against the Actions it offers and the inputs
 * those Actions declare. Empty where there are none.
 *
 * A key naming an Action the `actions` entry does not accept is reported by TASK-35 or ALRT-7 and
 * not again here: its input cannot be read, so there is nothing of this rule's to judge.
 */
export function judgeInputs(judged: {
  /** How the faults name what carried them — `task task-1`, `alert alert-1`. */
  owner: string;
  inputs: Record<string, Record<string, unknown>>;
  offered: string[];
  accepts: Record<string, { input?: unknown }>;
}): string[] {
  const { owner, inputs, offered, accepts } = judged;
  const faults: string[] = [];
  for (const [action, values] of Object.entries(inputs)) {
    if (!offered.includes(action)) {
      faults.push(`${owner} fills in \`${action}\`, which it does not offer`);
      continue;
    }
    const input = accepts[action]?.input as Declared | undefined;
    if (input === undefined) continue;
    const variants = input.anyOf ?? input.oneOf ?? [input];
    for (const [member, value] of Object.entries(values)) {
      const schemas = variants
        .map((variant) => variant.properties?.[member])
        .filter((one): one is Declared => one !== undefined);
      if (schemas.length === 0) {
        faults.push(
          `${owner} fills in \`${member}\` for \`${action}\`, whose input has no such member`,
        );
      } else if (!schemas.some((schema) => agrees(schema, value))) {
        faults.push(
          `${owner} fills in \`${member}\` for \`${action}\` with a value its schema refuses`,
        );
      }
    }
  }
  return faults;
}

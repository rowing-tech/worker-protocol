/**
 * TASK-37 and ALRT-9 — values a Task or an Alert fills in for the Actions it offers.
 *
 * Both rules say the same three things, about two surfaces: each key is an Action the Task or Alert
 * offers, each member is one that Action's input declares, and each value is one that member's
 * schema accepts. So both checks call this, and say the verdict under their own id.
 *
 * **The value is judged against what the member's schema fixes about one value, and no further.**
 * A verifier that ran full JSON Schema validation would need a validator this package does not
 * carry, and TASK-28's payload is not validated against its declared schema either. What is read is
 * `type`, `const`, `enum`, `pattern`, the lengths of a string and the bounds of a number — what
 * tells a vehicle id from a number, a well-formed supplier id from a malformed one, and one ending
 * from another. The register in `conformance/verifiability.md` says so, rather than letting a pass
 * claim more than it saw.
 *
 * **What is filled in may be partial, and that is judged too.** TASK-37 and ALRT-9 fill in values
 * for members, not every member the Action requires: an Alert about a paused source fills in the
 * source and leaves the request id to the operator. So a required member that is absent is not a
 * fault here.
 */

/** A declared input, read only for the members and the keywords judged here. */
export type Declared = {
  type?: unknown;
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
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

/** Whether a pattern matches, read as JSON Schema reads it: unanchored, ECMA-262. */
const matching = (pattern: string, value: string): boolean => {
  try {
    return new RegExp(pattern, "u").test(value);
  } catch {
    // A pattern this runtime cannot compile is not the value's fault, and is not judged.
    return true;
  }
};

/**
 * Whether one value's schema accepts it, as far as `type`, `const`, `enum`, `pattern`, the lengths
 * of a string and the bounds of a number say — and nothing about members, items or composition.
 * Shared by TASK-37 and ALRT-9, and by EVT-18 for the value of an extension attribute.
 */
export const agrees = (schema: Declared, value: unknown): boolean => {
  if (schema.const !== undefined) return same(schema.const, value);
  if (Array.isArray(schema.enum)) return schema.enum.some((one) => same(one, value));
  const typed = Array.isArray(schema.type)
    ? schema.type.some((one) => isOf(value, one))
    : isOf(value, schema.type);
  if (!typed) return false;
  if (typeof value === "string") {
    // Length in code points, as JSON Schema counts it.
    const length = [...value].length;
    if (schema.pattern !== undefined && !matching(schema.pattern, value)) return false;
    if (schema.minLength !== undefined && length < schema.minLength) return false;
    if (schema.maxLength !== undefined && length > schema.maxLength) return false;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return false;
  }
  return true;
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

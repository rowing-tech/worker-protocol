import type * as z from "zod";

/**
 * DESC-39 — read what this edition knows of a document a Worker sent, and ignore what it does not.
 *
 * **The schemas stay closed, and this is why that is not a contradiction.** A closed schema is the
 * statement of what a Worker of THIS edition sends: the verifier judges a Worker against it, and a
 * member the edition does not define is a fault there — a misspelt `granularty` is caught that way.
 * A consumer is asked something else. It may be reading a Worker built to a later edition, whose
 * documents carry what this one never heard of, and refusing the whole document for that would make
 * every addition to the protocol a break for every reader already deployed. So the consumer reads
 * with the same schemas, takes out what they do not define, and reads what is left.
 *
 * Two things are taken out, and only two:
 *
 * - **A member an object does not define** — Zod's `unrecognized_keys`, anywhere in the document.
 * - **A Capability name the edition does not define** — an invalid key of the Descriptor's
 *   `capabilities`. Nowhere else is a key ignored: every other record is keyed by names a Worker
 *   declared, and a key there that does not validate is the Worker's fault, not a later edition's.
 *
 * **A value is never taken out.** A `health` status of `maintenance`, a Task without its `since`, a
 * number where a string was declared: each is something this edition defines and the document
 * broke, and ignoring it would be reading a meaning nobody sent. Those still fail, as before.
 *
 * What was ignored is answered beside the data, so that a caller can say so — a Tower that shows
 * "this Worker declares `frobs`, which this console does not know" has told an operator to upgrade
 * it, where silence would have hidden a Capability nobody could use.
 */

/** Where something was ignored, as dotted members: `capabilities.frobs`, `items.0.weight`. */
export type Ignored = string;

export type TolerantRead<T> =
  | { success: true; data: T; ignored: Ignored[] }
  | { success: false; error: z.ZodError };

type Path = PropertyKey[];

const at = (path: Path): string => path.map(String).join(".");

/** The object or array at `path` inside `root`, or undefined where nothing is there. */
const holderAt = (root: unknown, path: Path): unknown => {
  let here: unknown = root;
  for (const step of path) {
    if (typeof here !== "object" || here === null) return undefined;
    here = (here as Record<PropertyKey, unknown>)[step];
  }
  return here;
};

const isCapabilityKey = (path: Path): boolean => path.length === 2 && path[0] === "capabilities";

/**
 * Parse `value` with `schema`, ignoring what DESC-39 lets a consumer ignore. The value handed in is
 * never changed: what is taken out is taken out of a copy.
 */
export function readTolerantly<T>(schema: z.ZodType<T>, value: unknown): TolerantRead<T> {
  let first = schema.safeParse(value);
  if (first.success) return { success: true, data: first.data, ignored: [] };

  // A copy, because the caller's document is the caller's — a transcript, a cache, a log line.
  const copy: unknown = structuredClone(value);
  const ignored: Ignored[] = [];

  // Bounded, because each pass removes at least one key and a document has finitely many; the bound
  // is there so that a schema that kept reporting the same key could never spin a caller.
  for (let pass = 0; pass < 64; pass++) {
    let removed = 0;
    for (const issue of first.error.issues) {
      if (issue.code === "unrecognized_keys") {
        const holder = holderAt(copy, issue.path);
        if (typeof holder !== "object" || holder === null) continue;
        for (const key of issue.keys) {
          if (Object.hasOwn(holder, key)) {
            delete (holder as Record<string, unknown>)[key];
            ignored.push(at([...issue.path, key]));
            removed += 1;
          }
        }
      } else if (issue.code === "invalid_key" && isCapabilityKey(issue.path)) {
        const holder = holderAt(copy, issue.path.slice(0, -1));
        const key = issue.path.at(-1);
        if (typeof holder === "object" && holder !== null && key !== undefined) {
          delete (holder as Record<PropertyKey, unknown>)[key];
          ignored.push(at(issue.path));
          removed += 1;
        }
      }
    }
    // Nothing left this rule may ignore: what remains is a fault in what this edition defines.
    if (removed === 0) return { success: false, error: first.error };
    first = schema.safeParse(copy);
    if (first.success) return { success: true, data: first.data, ignored };
  }
  return { success: false, error: first.error };
}

/**
 * Which rule a failure at a place in a document belongs to.
 *
 * The map is generated from `schemas/` by `src/generate-rules.ts`, which reads the leading rule id
 * off each node's `description`. Nothing is decided here: this file only walks a path against what
 * the normative artifact already says, so that a report names the obligation that was broken
 * rather than announcing that a document is invalid.
 *
 * A segment the schema has nothing to say about — a key under `additionalProperties`, which is the
 * Worker's own — matches `*`.
 */
export type Attribution = Record<string, Record<string, string>>;

export function ruleFor(
  attribution: Attribution,
  schema: string,
  path: PropertyKey[],
): string | null {
  const map = attribution[schema];
  if (map === undefined) return null;

  // The deepest node on the path that cites a rule. Walking rather than looking up the whole path
  // is what lets a failure deep inside a member the schema says nothing finer about still land on
  // the rule that governs the member — a report that is coarse where the schema is coarse, and
  // never more precise than the document it derives from.
  let found: string | null = map[""] ?? null;
  let prefix = "";

  for (const segment of path) {
    const literal = prefix === "" ? String(segment) : `${prefix}/${String(segment)}`;
    const wildcard = prefix === "" ? "*" : `${prefix}/*`;

    if (map[literal] !== undefined) {
      prefix = literal;
      found = map[literal];
    } else if (map[wildcard] !== undefined) {
      prefix = wildcard;
      found = map[wildcard];
    } else {
      break;
    }
  }

  return found;
}

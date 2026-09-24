import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CODES } from "../../hono/src/codes.ts";
import type { Rule } from "./report.ts";

/**
 * Generates `packages/conformance/rules.json` and `src/rules.generated.ts` from `spec/` and
 * `conformance/verifiability.md`, or checks that what is committed matches.
 *
 *   node packages/conformance/src/generate-rules.ts            writes both
 *   node packages/conformance/src/generate-rules.ts --check    compares both, exits 1 on a difference
 *
 * The verifier needs the rule universe at runtime and is published to npm, where `spec/` does not
 * travel with it. So the universe is generated and committed, on exactly the reasoning that has
 * `schemas/` generated and committed: an artifact derived from a source is only trustworthy if
 * something compares the two, and CI does.
 *
 * **It is written twice, from one object, and the two are for different readers.** `rules.json` is
 * for anybody who will never run JavaScript — a verifier in another language, a script, a person —
 * and ships in the tarball for them. `rules.generated.ts` is what `verify()` imports, statically,
 * so that the library reaches its universe without a filesystem: a bundler inlines it, and the
 * package runs wherever a Worker does rather than only where `node:fs` resolves. Neither is derived
 * from the other, so neither can drift from `spec/` while the other holds.
 *
 * Nothing here decides anything. The ids and their classes come from `spec/`, and what a check can
 * observe comes from `conformance/verifiability.md`, which `pnpm verifiability:lint` already holds
 * in step with `spec/`.
 *
 * This file is toolchain and never reaches `dist/`: `tsconfig.build.json` emits only what the
 * package publishes.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SPEC = join(ROOT, "spec");
const INVENTORY = join(ROOT, "conformance", "verifiability.md");
const PACKAGE = join(import.meta.dirname, "..");

/** `spec/README.md`: every file has a prefix, so that two files never race for the same one. */
const readme = await readFile(join(SPEC, "README.md"), "utf8");
const prefixOf = new Map<string, string>();
for (const [, file, prefix] of readme.matchAll(/\[([a-z-]+\.md)\]\([a-z-]+\.md\) \| `([A-Z]+)`/g)) {
  prefixOf.set(file, prefix);
}

/** `conformance/verifiability.md`: one row per rule, `| DESC-1 | W | … |`. */
const inventory = await readFile(INVENTORY, "utf8");
const reachOf = new Map<string, Rule["reach"]>();
for (const [, id, reach] of inventory.matchAll(/^\| ([A-Z]+-\d+) \| (\S+) \|/gm)) {
  reachOf.set(id, reach as Rule["reach"]);
}

const specFiles = (await readdir(SPEC))
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();
const rules: Rule[] = [];
const missing: string[] = [];

for (const file of specFiles) {
  const prefix = prefixOf.get(file);
  if (!prefix) continue;
  const text = await readFile(join(SPEC, file), "utf8");
  const cut = text.indexOf("\n## Withdrawn");
  const body = cut === -1 ? text : text.slice(0, cut);

  for (const m of body.matchAll(
    new RegExp(`\\*\\*${prefix}-(\\d+) \\((required|recommended)\\)\\. `, "g"),
  )) {
    const id = `${prefix}-${m[1]}`;
    const reach = reachOf.get(id);
    if (reach === undefined) {
      missing.push(id);
      continue;
    }
    rules.push({ id, file, class: m[2] as Rule["class"], reach });
  }
}

// `pnpm verifiability:lint` is what reports this properly, naming every offender. Refusing here
// too is not redundant: a generated universe missing a rule is a verifier that would report
// nothing at all about it, silently, which is the one outcome this whole directory exists against.
if (missing.length > 0) {
  console.error(
    `conformance/verifiability.md classifies no reach for ${missing.length} rule(s):\n`,
  );
  for (const id of missing) console.error(`  ${id}`);
  console.error("\nRun `pnpm verifiability:lint` for the full report.");
  process.exit(1);
}

rules.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

/**
 * ENDP-25, ENDP-26 — the closed code vocabulary, with the status each code is answered with.
 *
 * Read from `packages/hono/src/codes.ts` rather than parsed out of a Markdown table with a regular
 * expression. `schemas/error.json` carries the code with its class, which is the half a schema can
 * assert; the status is not in the body, and it now lives beside the rest of the surface instead of
 * in prose that a script had to scrape. `spec/endpoints.md` keeps the table as a reading aid and
 * says so.
 *
 * The import is a relative path into the other package's SOURCE, which is deliberate and narrow:
 * this file is toolchain, never reaches `dist/`, and reading the built package instead would make
 * `pnpm rules:check` depend on a build that CI runs two steps later. `codes.ts` imports nothing,
 * so this pulls no web framework into the rule universe.
 */
const codes = [...CODES]
  .map(({ code, status, class: klass }) => ({ code, status, class: klass }))
  .sort((a, b) => a.code.localeCompare(b.code));

/**
 * Which rule a failure at a given place in a document belongs to.
 *
 * A report that answered "the Descriptor is invalid" is what the rule ids exist to prevent — an
 * operator cannot act on it, and two very different faults read identically. So a verifier has to
 * name the rule, and the question is where that attribution comes from.
 *
 * It comes from here: every schema node in `schemas/` opens its `description` with the rule it
 * encodes, so the map is *read off the normative artifact* rather than written into the verifier.
 * That matters beyond tidiness. A hand-written map is the verifier holding an opinion about what
 * `spec/` requires, which `conformance/README.md` forbids it, and it is an opinion nothing would
 * ever compare against the document it claims to describe.
 *
 * A path segment under `additionalProperties` becomes `*`, because the key is the Worker's and the
 * schema has nothing to say about which one it was.
 */
const schemasDir = join(ROOT, "schemas");
const documents = new Map<string, Record<string, unknown>>();
for (const name of (await readdir(schemasDir)).filter((n) => n.endsWith(".json"))) {
  documents.set(name, JSON.parse(await readFile(join(schemasDir, name), "utf8")));
}

/** The leading `PREFIX-N` of a description, which is the citation convention `schemas/` holds. */
const ruleIn = (node: unknown): string | null => {
  if (node === null || typeof node !== "object") return null;
  const description = (node as { description?: unknown }).description;
  if (typeof description !== "string") return null;
  return description.match(/^([A-Z]{3,4}-\d+)\./)?.[1] ?? null;
};

const attribution: Record<string, Record<string, string>> = {};

const walk = (
  node: unknown,
  into: Record<string, string>,
  path: string,
  seen: Set<unknown>,
): void => {
  if (node === null || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);

  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref === "string") {
    const target = documents.get(ref);
    if (target) walk(target, into, path, seen);
    return;
  }

  const rule = ruleIn(node);
  if (rule !== null && into[path] === undefined) into[path] = rule;

  const properties = (node as { properties?: Record<string, unknown> }).properties;
  if (properties) {
    for (const [name, child] of Object.entries(properties)) {
      walk(child, into, path === "" ? name : `${path}/${name}`, new Set(seen));
    }
  }

  const additional = (node as { additionalProperties?: unknown }).additionalProperties;
  if (additional && typeof additional === "object") {
    walk(additional, into, path === "" ? "*" : `${path}/*`, new Set(seen));
  }

  // A union. Every branch describes the same place, so a branch never overrides the rule already
  // recorded for this path — the assignment above is what enforces that — but every branch is
  // still walked, because their members are reachable by path and would otherwise be a silent
  // hole. The error envelope is exactly that case: a union at the root whose two branches carry
  // `code`, `message` and `class`.
  //
  // Where the branches cite DIFFERENT rules — a Capability key is DESC-8 or DESC-14 depending on
  // a dot — the first one walked wins the node, which is why the attribution for that place stays
  // deliberately at the map itself. The schema does not say which branch a failing key was
  // reaching for, so neither does the verifier.
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branches = (node as Record<string, unknown>)[key];
    if (Array.isArray(branches)) {
      for (const branch of branches) walk(branch, into, path, new Set(seen));
    }
  }
};

for (const [name, document] of [...documents].sort(([a], [b]) => a.localeCompare(b))) {
  const into: Record<string, string> = {};
  walk(document, into, "", new Set());
  if (Object.keys(into).length > 0) {
    attribution[name.replace(/\.json$/, "")] = Object.fromEntries(
      Object.entries(into).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}

const universe = { rules, codes, attribution };

/**
 * The module carries no `$comment` member: its header says the same thing to the only reader a
 * comment inside the object would reach, and the annotation lets `tsc` hold the literal to the
 * types every check is written against — a rule whose `reach` the inventory spelled in a way
 * `Rule` does not admit fails the type-check rather than a verdict.
 */
const outputs = [
  {
    path: "rules.json",
    contents: `${JSON.stringify(
      {
        $comment:
          "Generated from spec/ and conformance/verifiability.md by " +
          "packages/conformance/src/generate-rules.ts. Do not edit: run `pnpm rules:generate`.",
        ...universe,
      },
      null,
      2,
    )}\n`,
  },
  {
    path: "src/rules.generated.ts",
    contents: [
      "// Generated from spec/ and conformance/verifiability.md by",
      "// packages/conformance/src/generate-rules.ts. Do not edit: run `pnpm rules:generate`.",
      "//",
      "// The universe rules.json holds, as a module, so that the library imports it rather than",
      "// reading a file: it is what lets verify() run where there is no filesystem.",
      "",
      'import type { Attribution } from "./attribution.ts";',
      'import type { Code } from "./checks/endpoints.ts";',
      'import type { Rule } from "./report.ts";',
      "",
      `export const UNIVERSE: { rules: Rule[]; codes: Code[]; attribution: Attribution } = ${JSON.stringify(universe, null, 2)};`,
      "",
    ].join("\n"),
  },
];

const counts = `${rules.length} rules, ${codes.length} codes`;

if (process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const { path, contents } of outputs) {
    let actual: string | null = null;
    try {
      actual = await readFile(join(PACKAGE, path), "utf8");
    } catch {
      actual = null;
    }
    if (actual !== contents) stale.push(`packages/conformance/${path}`);
  }
  if (stale.length > 0) {
    for (const path of stale) console.error(`${path} does not match spec/.`);
    console.error("\nRun `pnpm rules:generate` and commit the result.");
    process.exit(1);
  }
  console.log(
    `packages/conformance/rules.json and src/rules.generated.ts match spec/ (${counts}).`,
  );
} else {
  for (const { path, contents } of outputs) {
    await writeFile(join(PACKAGE, path), contents, "utf8");
    console.log(`wrote packages/conformance/${path} (${counts})`);
  }
}

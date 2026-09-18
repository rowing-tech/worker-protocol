import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Rule } from "./report.ts";

/**
 * Generates `packages/conformance/rules.json` from `spec/` and `conformance/verifiability.md`, or
 * checks that what is committed matches.
 *
 *   node packages/conformance/src/generate-rules.ts            writes
 *   node packages/conformance/src/generate-rules.ts --check    compares, exits 1 on a difference
 *
 * The verifier needs the rule universe at runtime and is published to npm, where `spec/` does not
 * travel with it. So the universe is generated and committed, on exactly the reasoning that has
 * `schemas/` generated and committed: an artifact derived from a source is only trustworthy if
 * something compares the two, and CI does.
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
const OUT = join(import.meta.dirname, "..", "rules.json");

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
 * ENDP-26: a code fixes one status and one class.
 *
 * `schemas/error.json` carries the code with its class, which is half of it; the status a code is
 * answered with is not in the body and no schema can assert it, so endpoints.md holds that half in
 * a table. It is read from there rather than copied into the verifier, because a hand-written copy
 * of a normative table is a second source that drifts — the failure `schemas/` is generated to
 * avoid, one document along.
 */
const endpoints = await readFile(join(SPEC, "endpoints.md"), "utf8");
const codes: { code: string; status: number; class: "reject" | "retry" }[] = [];
for (const [, code, status, klass] of endpoints.matchAll(
  /^\| `([a-z_]+)` \| `(\d{3})` \| `(reject|retry)` \|/gm,
)) {
  codes.push({ code, status: Number(status), class: klass as "reject" | "retry" });
}

if (codes.length === 0) {
  console.error("spec/endpoints.md holds no code table, or it no longer has the expected shape.");
  process.exit(1);
}

codes.sort((a, b) => a.code.localeCompare(b.code));

const contents = `${JSON.stringify(
  {
    $comment:
      "Generated from spec/ and conformance/verifiability.md by " +
      "packages/conformance/src/generate-rules.ts. Do not edit: run `pnpm rules:generate`.",
    rules,
    codes,
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  let actual: string | null = null;
  try {
    actual = await readFile(OUT, "utf8");
  } catch {
    actual = null;
  }
  if (actual !== contents) {
    console.error("packages/conformance/rules.json does not match spec/.\n");
    console.error("Run `pnpm rules:generate` and commit the result.");
    process.exit(1);
  }
  console.log(
    `packages/conformance/rules.json matches spec/ (${rules.length} rules, ${codes.length} codes).`,
  );
} else {
  await writeFile(OUT, contents, "utf8");
  console.log(
    `wrote packages/conformance/rules.json (${rules.length} rules, ${codes.length} codes)`,
  );
}

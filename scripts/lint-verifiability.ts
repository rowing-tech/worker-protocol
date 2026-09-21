import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Checks `conformance/verifiability.md` against `spec/`.
 *
 *   node scripts/lint-verifiability.ts
 *
 * The inventory classifies every rule by what a check would observe, and `spec/README.md` makes
 * that classification the test a rule has to pass to earn its place. A rule written without one is
 * a rule nobody asked the question of — which is the failure the inventory exists to prevent, so a
 * rule with no row here is a finding rather than an omission somebody will notice later.
 *
 * It lives beside `lint-spec.ts` and for the same reason: nothing in `packages/` may carry
 * behaviour of its own, and this is toolchain. It has no dependencies.
 *
 * The counts the inventory prints are checked against the rows beneath them, on the same reasoning
 * that has CI regenerate `schemas/` rather than trust the copy in the tree. A summary nobody
 * compares is a claim nobody verifies, and this one would be read as the state of the audit.
 */

const ROOT = join(import.meta.dirname, "..");
const SPEC = join(ROOT, "spec");
const INVENTORY = join(ROOT, "conformance", "verifiability.md");

type Finding = { where: string; id: string; rule: string; detail: string };

const findings: Finding[] = [];
const report = (where: string, id: string, rule: string, detail: string) =>
  findings.push({ where, id, rule, detail });

/** The classes the inventory uses, and what each asserts about a check. */
const CLASSES = new Map([
  ["W", "observable against a Worker with one ordinary credential"],
  ["H", "observable only against a Worker arranged to be observed"],
  ["P", "the subject is not a Worker"],
  ["N", "no witness anywhere"],
  ["—", "blocked: the surface belongs to a file that is still `open`"],
]);

const vocabulary = [...CLASSES].map(([k, meaning]) => `${k} — ${meaning}`).join("\n    ");

/** `spec/README.md`: every file has a prefix, so that two files never race for the same one. */
const readme = await readFile(join(SPEC, "README.md"), "utf8");
const prefixOf = new Map<string, string>();
for (const [, file, prefix] of readme.matchAll(/\[([a-z-]+\.md)\]\([a-z-]+\.md\) \| `([A-Z]+)`/g)) {
  prefixOf.set(file, prefix);
}

/** Every rule the specification defines today, whatever its file's maturity marker. */
const specFiles = (await readdir(SPEC))
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();
const ruleFile = new Map<string, string>();

for (const file of specFiles) {
  const prefix = prefixOf.get(file);
  if (!prefix) continue; // lint-spec.ts owns this finding
  const text = await readFile(join(SPEC, file), "utf8");
  const cut = text.indexOf("\n## Withdrawn");
  const body = cut === -1 ? text : text.slice(0, cut);
  for (const m of body.matchAll(
    new RegExp(`\\*\\*${prefix}-(\\d+) \\((?:required|recommended)\\)\\. `, "g"),
  )) {
    ruleFile.set(`${prefix}-${m[1]}`, file);
  }
}

/**
 * The inventory, read section by section. A `## <file>.md — N` heading opens a section and every
 * row beneath it is a rule of that file, so a row filed under the wrong heading is visible without
 * anyone holding the prefix table in their head.
 */
const inventory = await readFile(INVENTORY, "utf8");

type Section = { file: string; declared: number; rows: number };

const classified = new Map<string, string>();
const sections: Section[] = [];

let section: Section | null = null;
for (const line of inventory.split("\n")) {
  const heading = line.match(/^## ([a-z-]+\.md) — (\d+)$/);
  if (heading) {
    section = { file: heading[1], declared: Number(heading[2]), rows: 0 };
    sections.push(section);
    continue;
  }
  if (/^## /.test(line)) {
    section = null;
    continue;
  }
  if (section === null) continue;

  const row = line.match(/^\| ([A-Z]+-\d+) \| (\S+) \|/);
  if (!row) continue;
  const [, id, klass] = row;

  section.rows += 1;

  // One row per rule: a rule classified twice is a rule two readers answered differently.
  if (classified.has(id)) {
    report("conformance/verifiability.md", id, "duplicate", "classified more than once");
    continue;
  }
  classified.set(id, klass);

  if (!CLASSES.has(klass)) {
    report("conformance/verifiability.md", id, "class", `unknown class \`${klass}\``);
  }

  // A row under the wrong heading files a rule against a file that does not define it.
  const owner = ruleFile.get(id);
  if (owner !== undefined && owner !== section.file) {
    report("conformance/verifiability.md", id, "section", `defined in spec/${owner}`);
  }
}

// `spec/README.md`: a rule earns its place only if you can name what a check would observe.
for (const [id, file] of ruleFile) {
  if (!classified.has(id)) {
    report(`spec/${file}`, id, "unclassified", "no row in conformance/verifiability.md");
  }
}

// A row for a rule that does not exist is a citation to nothing — the same fault lint-spec.ts
// calls `dangling`, one document further out.
for (const id of classified.keys()) {
  if (!ruleFile.has(id)) {
    report("conformance/verifiability.md", id, "dangling", "no such rule in spec/");
  }
}

// Each section's heading states how many rules its file holds.
for (const { file, declared, rows } of sections) {
  if (declared !== rows) {
    report(
      "conformance/verifiability.md",
      "-",
      "section-count",
      `${file} says ${declared}, holds ${rows}`,
    );
  }
}

// The summary table at the top counts the classes beneath it.
const counted = new Map<string, number>();
for (const klass of classified.values()) counted.set(klass, (counted.get(klass) ?? 0) + 1);

for (const [, klass, declared] of inventory.matchAll(/^\| \*\*(\S+)\*\* \| .+ \| (\d+) \|$/gm)) {
  const actual = counted.get(klass) ?? 0;
  if (Number(declared) !== actual) {
    report(
      "conformance/verifiability.md",
      "-",
      "class-count",
      `${klass} says ${declared}, holds ${actual}`,
    );
  }
}

/**
 * The same counts, where they are written in prose.
 *
 * The tables above are gated and the sentences around them were not, so four documents carried
 * numbers that drifted quietly: `README.md` claimed forty-four rules withdrawn for six rules after
 * it stopped being true, and the sentence that decomposes what no tool reaches was published
 * saying 48 where its own two parts add to 47. Both are the fault this repository names everywhere
 * else — a claim nobody compares — and the fix is the one it uses everywhere else.
 *
 * Every number below is already computed above or by `spec/`. A sentence that stops being true now
 * fails here, naming the file and what it should say.
 */
const W = counted.get("W") ?? 0;
const H = counted.get("H") ?? 0;
const P = counted.get("P") ?? 0;
const N = counted.get("N") ?? 0;
const all = classified.size;

/** `\d+` in the pattern is where the count goes; every other character matches literally. */
const claims: [file: string, pattern: string, expected: number][] = [
  ["README.md", "What stands behind that: \\d+ rules", all],
  ["README.md", "every one of the \\d+ a tool can observe", W],
  ["README.md", "The remaining \\d+ are reported rather than passed", P + N],
  ["README.md", "passed, and the two kinds are not the same: \\d+ bind a", P],
  ["README.md", "whoever they oblige, and \\d+ have no witness", N],
  ["conformance/README.md", "over a specification of \\d+ rules", all],
  ["conformance/README.md", "Today that would be \\d+ of them", W + H],
  ["conformance/verifiability.md", "^\\d+ rules across eleven files", all],
  ["conformance/verifiability.md", "What no tool reaches is \\d+ rules", P + N],
];

for (const [file, pattern, expected] of claims) {
  const text = await readFile(join(ROOT, file), "utf8");
  const found = text.match(new RegExp(pattern.replace("\\d+", "(\\d+)"), "m"));
  if (!found) {
    report(file, "-", "prose-count", `no sentence matching \`${pattern}\``);
  } else if (Number(found[1]) !== expected) {
    report(file, "-", "prose-count", `\`${found[0]}\` should say ${expected}`);
  }
}

if (findings.length > 0) {
  console.error(`conformance/verifiability.md and spec/ disagree (${findings.length}):\n`);
  let current = "";
  for (const f of findings.sort((a, b) => a.where.localeCompare(b.where))) {
    if (f.where !== current) {
      console.error(`  ${f.where}`);
      current = f.where;
    }
    console.error(`    ${f.id.padEnd(9)} ${f.rule.padEnd(15)} ${f.detail}`);
  }
  console.error(`\n  The classes:\n    ${vocabulary}`);
  console.error("\nWhat the inventory is for is in conformance/README.md.");
  process.exit(1);
}

const summary = [...CLASSES.keys()].map((k) => `${counted.get(k) ?? 0} ${k}`).join(", ");
console.log(
  `conformance/verifiability.md classifies every rule (${classified.size} — ${summary}).`,
);

/**
 * What this script deliberately does not check.
 *
 * - Whether a rule's class is the *right* one. That is the judgement the inventory records, and it
 *   needs somebody to read the rule and say what a check would see. A script that guessed would be
 *   asserting the one thing the document exists to decide.
 * - Whether a `W` or `H` rule has a check in `packages/conformance` that actually establishes it.
 *   That gate belongs beside the checks, where a check can name the ids it covers, and it is worth
 *   having: a rule classified observable with nothing observing it is the gap the inventory was
 *   written to make visible rather than a state it should be able to hide in.
 * - Whether the prose beneath each table still describes the rows above it.
 */

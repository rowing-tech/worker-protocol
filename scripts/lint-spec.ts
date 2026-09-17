import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Checks the rule-id convention that `spec/README.md` states.
 *
 *   node scripts/lint-spec.ts
 *
 * It lives here rather than under `packages/` on purpose: nothing in `packages/` may carry
 * behaviour of its own, and this is toolchain. It has no dependencies.
 *
 * Every check below corresponds to a sentence in `spec/README.md`. What that document also
 * claims, and what no script can check, is listed at the bottom of this file — an unstated
 * exclusion would make this lint the same kind of false claim the convention exists to prevent.
 */

const ROOT = join(import.meta.dirname, "..");
const SPEC = join(ROOT, "spec");

type Finding = { file: string; id: string; rule: string; detail: string };

const findings: Finding[] = [];
const report = (file: string, id: string, rule: string, detail: string) =>
  findings.push({ file, id, rule, detail });

/** Every id whose rule is marked `(recommended)`, for the count at the end. */
const recommended = new Set<string>();

/** `spec/README.md`: every file has a prefix, so that two files never race for the same one. */
async function prefixTable(): Promise<Map<string, string>> {
  const readme = await readFile(join(SPEC, "README.md"), "utf8");
  const table = new Map<string, string>();
  for (const [, file, prefix] of readme.matchAll(
    /\[([a-z-]+\.md)\]\([a-z-]+\.md\) \| `([A-Z]+)`/g,
  )) {
    table.set(file, prefix);
  }
  return table;
}

const MARKERS = ["stable", "draft", "open"];

const files = (await readdir(SPEC)).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
const table = await prefixTable();
const prefixes = [...new Set(table.values())];

/** Every mention of any known id, anywhere, so that a citation cannot dangle. */
const idPattern = new RegExp(`\\b(${prefixes.join("|")})-(\\d+)\\b`, "g");

type Parsed = {
  file: string;
  prefix: string;
  marker: string | null;
  body: string;
  withdrawnSection: string;
  live: Map<number, number>;
  withdrawn: Set<number>;
};

const parsed: Parsed[] = [];

for (const file of files) {
  const text = await readFile(join(SPEC, file), "utf8");
  const prefix = table.get(file) ?? "";

  // spec/README.md: "Every file has a prefix from the day it exists, whatever its maturity marker."
  if (!prefix) {
    report(file, "-", "prefix-table", "no prefix listed in spec/README.md");
    continue;
  }

  // spec/README.md: "One file per subject, each opening with its maturity marker."
  const marker = text.split("\n").slice(0, 6).find((l) => /^`(stable|draft|open)`$/.test(l.trim()));
  const markerValue = marker ? marker.trim().replaceAll("`", "") : null;
  if (!markerValue) {
    report(file, "-", "marker", `no maturity marker (one of ${MARKERS.join(", ")}) near the top`);
  }

  const cut = text.indexOf("\n## Withdrawn");
  const body = cut === -1 ? text : text.slice(0, cut);
  const withdrawnSection = cut === -1 ? "" : text.slice(cut);

  // A rule: a bold statement opening with its id and its class.
  // "**DESC-4 (required). ...**" or "**REG-26 (recommended). ...**"
  const live = new Map<number, number>();
  for (const m of body.matchAll(
    new RegExp(`\\*\\*${prefix}-(\\d+) \\((required|recommended)\\)\\. `, "g"),
  )) {
    const n = Number(m[1]);
    live.set(n, (live.get(n) ?? 0) + 1);
    if (m[2] === "recommended") recommended.add(`${prefix}-${n}`);
  }

  // spec/README.md: "Every rule states its class in the rule itself." A bold statement that opens
  // with an id and goes straight to its sentence carries neither marker, and the convention has no
  // default: an author who meant `recommended` and wrote nothing would otherwise have published an
  // obligation, which is the one direction this must never fail in.
  const unclassed = new RegExp(
    `\\*\\*${prefix}-(\\d+)(?! \\((?:required|recommended)\\))`,
    "g",
  );
  for (const m of body.matchAll(unclassed)) {
    const rest = body.slice(m.index + m[0].length);
    if (!rest.startsWith(".") && !rest.startsWith("*")) continue;
    if (rest.startsWith("**")) continue; // a `## Withdrawn` style citation, handled elsewhere
    report(file, `${prefix}-${m[1]}`, "class", "states no class: (required) or (recommended)");
  }

  // A withdrawn entry: a bullet opening with the retired id. "- **DESC-7** — ..."
  const withdrawn = new Set<number>();
  for (const m of withdrawnSection.matchAll(new RegExp(`^- \\*\\*${prefix}-(\\d+)\\*\\*`, "gm"))) {
    withdrawn.add(Number(m[1]));
  }

  parsed.push({ file, prefix, marker: markerValue, body, withdrawnSection, live, withdrawn });
}

const owner = new Map<string, Parsed>();
for (const p of parsed) owner.set(p.prefix, p);

for (const p of parsed) {
  const { file, prefix, live, withdrawn } = p;

  // spec/README.md: "A file marked `open` lists what it will answer."
  if (p.marker === "open" && !p.body.includes("To answer here:")) {
    report(file, "-", "open-answers", "marked `open` but does not list what it will answer");
  }

  // spec/README.md: "An id is never reused and never renumbered."
  for (const [n, count] of live) {
    if (count > 1) report(file, `${prefix}-${n}`, "duplicate", `defined ${count} times`);
  }
  for (const n of withdrawn) {
    if (live.has(n)) {
      report(file, `${prefix}-${n}`, "reused", "listed as withdrawn and also defined as a rule");
    }
  }

  const allocated = [...new Set([...live.keys(), ...withdrawn])].sort((a, b) => a - b);
  if (allocated.length === 0) continue;

  // spec/README.md: "A rule that is deleted keeps its id, withdrawn. Its number is never issued
  // again." A number between 1 and the highest that is neither live nor withdrawn is one that was
  // issued and then vanished without being retired.
  for (let n = 1; n <= allocated[allocated.length - 1]; n++) {
    if (!live.has(n) && !withdrawn.has(n)) {
      report(file, `${prefix}-${n}`, "allocation", "neither defined nor withdrawn");
    }
  }

  // spec/README.md: "Each file ends with a `Withdrawn` list."
  if (!p.withdrawnSection) {
    report(file, "-", "withdrawn-section", "has rules but no `## Withdrawn` section");
  }
}

// spec/README.md: "that list is the only place a withdrawn id is written" — and a cited id that
// was never issued is a reference to nothing.
const sources: { name: string; text: string }[] = [];
for (const dir of ["spec", "docs", "packages/schemas/src", "."]) {
  const abs = join(ROOT, dir);
  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!/\.(md|ts)$/.test(entry)) continue;
    sources.push({ name: join(dir, entry), text: await readFile(join(abs, entry), "utf8") });
  }
}

for (const source of sources) {
  const isOwnWithdrawnSection = (prefix: string) => {
    const p = owner.get(prefix);
    return p !== undefined && source.name === join("spec", p.file);
  };

  for (const m of source.text.matchAll(idPattern)) {
    const [cited, prefix, digits] = m;
    const n = Number(digits);
    const p = owner.get(prefix);
    if (!p) continue;

    const offset = m.index ?? 0;
    const inWithdrawnSection =
      isOwnWithdrawnSection(prefix) && offset >= source.text.length - p.withdrawnSection.length;

    if (p.withdrawn.has(n) && !inWithdrawnSection) {
      report(source.name, cited, "withdrawn-cited", "written outside its file's `Withdrawn` list");
    } else if (!p.withdrawn.has(n) && !p.live.has(n)) {
      report(source.name, cited, "dangling", `no such rule in spec/${p.file}`);
    }
  }
}

for (const p of parsed) {
  const stray = new RegExp(
    `\\*\\*(?!${p.prefix}-)([A-Z]+)-(\\d+) \\((?:required|recommended)\\)\\. `,
    "g",
  );
  for (const m of p.body.matchAll(stray)) {
    if (!prefixes.includes(m[1])) continue;
    report(p.file, `${m[1]}-${m[2]}`, "prefix", `defined in spec/${p.file}, whose prefix is ${p.prefix}`);
  }
}

if (findings.length > 0) {
  console.error(`spec/ fails the rule-id convention (${findings.length}):\n`);
  let current = "";
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file))) {
    if (f.file !== current) {
      console.error(`  ${f.file}`);
      current = f.file;
    }
    console.error(`    ${f.id.padEnd(9)} ${f.rule.padEnd(18)} ${f.detail}`);
  }
  console.error("\nThe convention is in spec/README.md.");
  process.exit(1);
}

const total = parsed.reduce((n, p) => n + p.live.size, 0);
const retired = parsed.reduce((n, p) => n + p.withdrawn.size, 0);
const advisory = recommended.size;
console.log(
  `spec/ holds the rule-id convention (${total} rules — ${total - advisory} required, ` +
    `${advisory} recommended; ${retired} withdrawn).`,
);

/**
 * What spec/README.md claims that this script deliberately does not check, because each needs a
 * reader rather than a parser. Naming them here keeps the lint from being read as complete.
 *
 * - "An id is fixed by the edition that publishes it." Nothing here knows which edition published
 *   what, and no edition is published yet. The checks below therefore enforce the post-publication
 *   discipline against the working tree, which is the strict reading: a `Withdrawn` entry is still
 *   required for anything the text has actually retired, and an id is never reused. What the rule
 *   permits and this script cannot reward is editing an unpublished rule in place — which produces
 *   no findings, so nothing has to be taught to allow it.
 * - "A rule binds when a client and a Worker must agree on it for a call to work; it recommends
 *   when breaking it makes one deployment worse and nobody misreads anything." Which side a given
 *   rule falls on is the judgement the class exists to record. This script checks that every rule
 *   states a class, never that it states the right one.
 * - "No obligation is stated outside a bold, id-carrying statement." Whether a sentence states an
 *   obligation is a question of meaning. The same sentence forbids nothing mechanical: bold
 *   WITHOUT an id is explicitly allowed as emphasis, so "every bold statement carries an id" is
 *   not the convention and is not checked.
 * - "A rule that is rewritten keeps its id if no verdict could change, and takes a new one if any
 *   could." Deciding this needs two versions of a rule and a judgement about implementations.
 * - "An id belongs to one independently checkable obligation." A granularity judgement.
 * - "The subject of a rule is whoever the sentence names."
 * - "Numbers are issued in the order rules are written." Unobservable from the finished file.
 */

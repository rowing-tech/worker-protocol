import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Holds `skills/` to the specification it teaches.
 *
 * A skill is prose an agent reads instead of `spec/`, and prose is worse than code for the fault
 * this repository guards against everywhere: nothing type-checks it. `packages/README.md` forbids a
 * package saying anything `spec/` does not say, because that is a package making the standard and
 * the text rots when the two disagree. A skill can do the same thing faster — it states an
 * obligation in a sentence, cites an id for it, and the day that id is withdrawn or renumbered the
 * sentence goes on being read as if it were still a rule.
 *
 * So every rule id a skill cites must be one `packages/conformance/rules.json` holds, which is the
 * universe the verifier itself reports against and is regenerated from `spec/` by
 * `pnpm rules:check`. A withdrawn id is not in it; a typo is not in it; a rule that was renumbered
 * is in it under the new number only. The prefixes are read off that file too, so a file added to
 * `spec/` needs no edit here.
 *
 * It also holds the two things the Agent Skills specification makes mechanical: `name` matches
 * the directory, and `description` stays under its limit. An agent decides whether a skill applies
 * from the description alone, so one that is silently truncated is one that stops triggering.
 *
 * Usage:
 *   node scripts/lint-skill.ts
 */

const ROOT = join(import.meta.dirname, "..");
const SKILLS = join(ROOT, "skills");

type Rule = { id: string };
const { rules } = JSON.parse(
  await readFile(join(ROOT, "packages", "conformance", "rules.json"), "utf8"),
) as { rules: Rule[] };

const known = new Set(rules.map((rule) => rule.id));
const prefixes = [...new Set(rules.map((rule) => rule.id.split("-")[0]))].sort();
const cited = new RegExp(`\\b(?:${prefixes.join("|")})-\\d+\\b`, "g");

type Finding = { file: string; line: number; message: string };
const findings: Finding[] = [];

async function markdownUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownUnder(path)));
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found.sort();
}

/**
 * The frontmatter as key/value, enough to check what the skills spec makes mechanical.
 *
 * A block scalar (`>-`, `>`, `|`, `|-`) gathers the indented lines beneath it, joined by a space,
 * because that is how a description long enough to be worth checking is written — one line of 600
 * characters would fail `pnpm prose:lint`, and a parser that read only the marker would measure a
 * two-character description and pass it.
 */
function frontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([a-z-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (/^[>|]-?$/.test(value)) {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      fields[key] = parts.join(" ");
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

for (const entry of await readdir(SKILLS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(SKILLS, entry.name);
  const skill = join(dir, "SKILL.md");
  const rel = (path: string) => path.replace(`${ROOT}/`, "");

  let text: string;
  try {
    text = await readFile(skill, "utf8");
  } catch {
    findings.push({ file: rel(dir), line: 0, message: "a skill directory with no SKILL.md" });
    continue;
  }

  const fields = frontmatter(text);
  if (fields.name !== entry.name) {
    findings.push({
      file: rel(skill),
      line: 1,
      message: `name is "${fields.name ?? ""}" and the directory is "${entry.name}"; they must match`,
    });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || entry.name.length > 64) {
    findings.push({
      file: rel(dir),
      line: 0,
      message: "a skill name is 1-64 lowercase letters, digits and single hyphens",
    });
  }
  const description = fields.description ?? "";
  if (description.length === 0 || description.length > 1024) {
    findings.push({
      file: rel(skill),
      line: 1,
      message: `description is ${description.length} characters; the spec allows 1 to 1024`,
    });
  }

  for (const path of await markdownUnder(dir)) {
    const lines = (await readFile(path, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const id of line.match(cited) ?? []) {
        if (!known.has(id)) {
          findings.push({
            file: rel(path),
            line: index + 1,
            message: `cites ${id}, which rules.json does not hold — withdrawn, renumbered or mistyped`,
          });
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`skills/ disagrees with the specification it teaches (${findings.length}):\n`);
  for (const { file, line, message } of findings) {
    console.error(`  ${file}${line > 0 ? `:${line}` : ""}  ${message}`);
  }
  console.error(
    "\n  A skill is read instead of spec/, so an id it cites that spec/ no longer carries is an",
  );
  console.error("  obligation that outlived its rule. Cite the current id, or drop the sentence.");
  process.exit(1);
}

console.log(`skills/ cites only rule ids the specification holds (${known.size} in the universe).`);

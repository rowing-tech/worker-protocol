import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Checks that hand-wrapped Markdown holds the line width `biome.jsonc` states.
 *
 *   node scripts/lint-prose.ts
 *
 * Biome deliberately does not touch `.md`: `spec/` and `docs/` are the artifact this repository
 * publishes, and reflowing them would rewrite it. That exclusion left the width a convention with
 * nothing behind it, and a convention nobody enforces is the kind of rule this repository says it
 * does not want. This is the gate. It lives here rather than under `packages/` for the reason the
 * other two lints do: nothing in `packages/` may carry behaviour of its own, and this is toolchain.
 *
 * The width is read from `biome.jsonc` rather than written here, so that the code and the prose
 * are held to one number and a change to it is made in one place.
 */

const ROOT = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".git"]);

/** `biome.jsonc`: `"lineWidth": 100`. One source for code and prose alike. */
async function lineWidth(): Promise<number> {
  const config = await readFile(join(ROOT, "biome.jsonc"), "utf8");
  const match = config.match(/"lineWidth":\s*(\d+)/);
  if (!match) {
    console.error("biome.jsonc states no lineWidth, so there is nothing to hold prose to.");
    process.exit(1);
  }
  return Number(match[1]);
}

async function markdownFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) found.push(path);
  }
  return found.sort();
}

type Finding = { file: string; line: number; width: number };

const width = await lineWidth();
const findings: Finding[] = [];

for (const path of await markdownFiles(ROOT)) {
  const text = await readFile(path, "utf8");
  let fenced = false;

  text.split("\n").forEach((line, index) => {
    // A fenced block is code or a quoted document, formatted by whatever produced it.
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    // A table row is one line by construction and its width is its columns'.
    if (line.startsWith("|")) return;

    // A line with no whitespace has nowhere to break: a long URL or a long identifier.
    if (!/\s/.test(line.trim())) return;

    // Characters, not bytes: an em dash or an arrow is one column and three bytes, and a
    // byte count reports a line that fits as one that does not.
    const columns = [...line].length;
    if (columns > width) {
      findings.push({ file: relative(ROOT, path), line: index + 1, width: columns });
    }
  });
}

if (findings.length > 0) {
  console.error(
    `Markdown exceeds the ${width}-column width biome.jsonc states (${findings.length}):\n`,
  );
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.width} columns`);
  console.error("\nTables, fenced blocks and lines with nowhere to break are not counted.");
  process.exit(1);
}

console.log(`Markdown holds the ${width}-column width biome.jsonc states.`);

/**
 * What this script deliberately does not check.
 *
 * - Whether a line is wrapped as EARLY as it could be. A short line is a choice, and the reason
 *   `.md` is excluded from biome is that those choices are the author's.
 * - Anything inside a fenced block, a table row, or a line that cannot be broken. Each is long for
 *   a reason a reader can see.
 * - Whether the width is the right number. That is `biome.jsonc`'s to say, and it says it once.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Holds `examples/minimal-worker` under a line count.
 *
 * This is the gate `packages/README.md` argues for, and it is the only one here that measures
 * something about a *reader* rather than about an artifact. The claim those packages make is that
 * complying is cheap; a claim nobody gates is a claim nobody verifies, which is the same reasoning
 * that has CI regenerate `schemas/` rather than trust the copy in the tree.
 *
 * What it counts is the domain a Worker author writes: what this Worker is, what it depends on,
 * what it counts, what it does, which conditions hold. Comments and blank lines are not counted —
 * the file is meant to be read and copied, so explaining itself must stay free. `server.ts` is not
 * counted either: serving an app is a platform's business and a Worker on Cloudflare or Convex
 * writes none of it.
 *
 * **When this fails, the question is which rule `mount()` failed to carry.** Raising the budget is
 * the answer only when the lines added are genuinely a Worker's own — a richer domain, a real
 * store — and then the number moves with a commit message saying so.
 */

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "examples", "minimal-worker", "src", "worker.ts");
const BUDGET = 150;

const source = await readFile(FILE, "utf8");

let inBlockComment = false;
let counted = 0;

for (const line of source.split("\n")) {
  const text = line.trim();
  if (inBlockComment) {
    if (text.includes("*/")) inBlockComment = false;
    continue;
  }
  if (text.startsWith("/*")) {
    if (!text.includes("*/")) inBlockComment = true;
    continue;
  }
  if (text === "" || text.startsWith("//")) continue;
  counted += 1;
}

if (counted > BUDGET) {
  console.error(
    `examples/minimal-worker/src/worker.ts is ${counted} lines of domain, over the ${BUDGET} this repository holds it to.\n`,
  );
  console.error("  A conformant Worker being cheap to write is what packages/ exists to claim.");
  console.error("  Ask which rule mount() failed to carry before raising the budget.");
  process.exit(1);
}

console.log(
  `examples/minimal-worker is ${counted} lines of domain, within the ${BUDGET} this repository holds it to.`,
);

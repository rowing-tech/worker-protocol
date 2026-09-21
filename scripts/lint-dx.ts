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
 * **The ceiling is deliberately far above where the file sits, and that is the correction.** A
 * number tight enough to bind is a number that eventually argues against the example being good:
 * the way to satisfy it is to declare one Capability less, or to show a shape simpler than the one
 * a real Worker needs, and then the gate has spent the thing it was protecting. What is worth
 * catching is the other failure — the file quietly becoming a small application, which is how an
 * example stops being copyable — and that shows up an order of magnitude away, not at line 151.
 *
 * **When this fails, the question is which rule `mount()` failed to carry**, and only then whether
 * the number moves. Nothing here is a reason to write a worse example.
 */

const ROOT = join(import.meta.dirname, "..");
const FILE = join(ROOT, "examples", "minimal-worker", "src", "worker.ts");
const BUDGET = 300;

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
  console.error("  Ask which rule mount() failed to carry before raising the ceiling — and never");
  console.error("  answer this by showing less of the protocol than a reader came here for.");
  process.exit(1);
}

console.log(
  `examples/minimal-worker is ${counted} lines of domain, within the ${BUDGET} this repository holds it to.`,
);

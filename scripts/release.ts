import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Tags the current commit with the root version and pushes the tag, which is what starts a publish.
 *
 * The tag is the release. `.github/workflows/publish.yml` triggers on `v*` and nothing else, so
 * this one push is the whole of the deliberate act — which is the property `spec/README.md` asks
 * for when it says an edition is fixed by a release rather than by a commit: *a commit is not a
 * release, a branch nobody pulled is not a publication*, and nobody reaches an edition by accident.
 * Pushing to `main` publishes nothing.
 *
 * **What this pushes is public and permanent.** The packages go to the public npm registry under
 * `@worker-protocol`, and npm does not let a version be replaced — a bad release is unpublished
 * within its window or superseded, never overwritten. So this refuses to move a tag that already
 * exists rather than helpfully forcing it: a moved tag is a released version whose contents changed
 * underneath anybody who read it.
 *
 * It does not check that the tree is clean. What is released is the commit, and whatever is
 * uncommitted is simply not in it; deciding what to commit is the author's business, not this
 * script's.
 *
 * Usage:
 *   node scripts/release.ts [--dry-run]
 */

const ROOT = join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const { version } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));

if (!version) {
  console.error("The root package.json has no version. Run `pnpm bump` before releasing.");
  process.exit(1);
}

const tag = `v${version}`;

function run(command: string, ...args: string[]): void {
  if (dryRun) {
    console.log(`  ~  ${command} ${args.join(" ")}`);
    return;
  }
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
}

const existing = execFileSync("git", ["tag", "--list", tag], {
  cwd: ROOT,
  encoding: "utf8",
}).trim();

if (existing) {
  console.error(`${tag} already exists. A released version is never republished under the same`);
  console.error("number — npm would refuse it, and a moved tag is worse than a refusal. Bump.");
  process.exit(1);
}

// The one rule binding a package version to a protocol edition, checked before the tag rather than
// after it, because after it the number has already been claimed.
execFileSync("node", [join(ROOT, "scripts", "lint-release.ts")], { cwd: ROOT, stdio: "inherit" });

console.log(`\nReleasing ${tag}${dryRun ? " (dry run)" : ""}\n`);

run("git", "tag", tag);
run("git", "push", "origin", tag);

if (!dryRun) {
  console.log(`\n${tag} is pushed. The publish workflow takes it from here.`);
  console.log("  https://github.com/rowing-tech/worker-protocol/actions/workflows/publish.yml");
}

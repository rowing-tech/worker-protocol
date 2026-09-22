import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Holds the one rule that binds a package version to a protocol edition.
 *
 * `packages/README.md` states it: **a release that changes which edition a package encodes is never
 * one a consumer's caret would take on its own.** Everything else about the two numbers is
 * deliberately independent — the package version is SemVer about what the package exports, the
 * edition is which specification it encodes, and a package may move many times without the protocol
 * moving at all. This is the single place they touch, and until now it was a sentence with nothing
 * behind it.
 *
 * The failure it catches is quiet and expensive, and it is worse here than the same mistake is
 * elsewhere. A consumer takes whatever their range allows without reading anything, by design and
 * correctly; if that release also moved the edition they have silently taken a different
 * specification — different schemas, possibly different verdicts from the verifier. And a Worker is
 * not merely *reading* the edition it installed: `mount()` writes it into the Descriptor, so such a
 * Worker begins declaring the new one to every consumer, catalog and verifier that reads it, with
 * nobody having touched its code.
 *
 * **Which release is too small is not a constant**, and the reason is npm's rather than this
 * repository's. See the comment on `bigEnough` below: a caret means something different on either
 * side of 1.0.0, so the floor is a MINOR while these packages are on a zero MAJOR and a MAJOR from
 * 1.0.0 on. Writing the rule as *never a PATCH* was right exactly while the first of those held.
 *
 * **It compares against the previous tag rather than against the working tree**, because an edition
 * change is not a thing that happens in a commit. `spec/README.md` makes the same argument for rule
 * ids: a commit is not a release, a branch nobody pulled is not a publication, and a rule that
 * turned on git state between releases would be one a rebase could break. What is compared here is
 * a release against the release before it, which is the boundary both files already name.
 *
 * The first release has nothing to compare against and passes. So does a package that did not exist
 * at the previous tag: a new package encodes an edition for the first time, which cannot be a
 * change to what it encoded before.
 *
 * Usage:
 *   node scripts/lint-release.ts
 */

const ROOT = join(import.meta.dirname, "..");

type Manifest = {
  name?: string;
  version?: string;
  private?: boolean;
  workerProtocolEdition?: string;
};

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** Reads a manifest as of a tag, or null when the package did not exist there. */
function manifestAt(tag: string, path: string): Manifest | null {
  try {
    return JSON.parse(git("show", `${tag}:${path}`));
  } catch {
    return null;
  }
}

/** The publishable members of `packages/`, which are the ones that declare an edition. */
async function publishable(): Promise<{ path: string; manifest: Manifest }[]> {
  const base = join(ROOT, "packages");
  const found: { path: string; manifest: Manifest }[] = [];

  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = `packages/${entry.name}/package.json`;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await readFile(join(ROOT, path), "utf8"));
    } catch {
      continue; // a directory under packages/ with no manifest — packages/README.md, and the like
    }
    if (manifest.private !== true) found.push({ path, manifest });
  }

  return found;
}

const { version } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as Manifest;

if (!version) {
  console.error("The root package.json has no version. It is what names the tag a release pushes.");
  process.exit(1);
}

/**
 * CHANGELOG.md carries a section for the version being released, and names the edition it encodes.
 *
 * A changelog is the one artefact here that nothing derives and nobody compares, which is the shape
 * of claim this repository writes gates against everywhere else: it is right until somebody cuts a
 * release in a hurry, and then it is quietly wrong for as long as nobody goes looking. The tag is
 * when it has to be true, so the tag is where it is checked.
 *
 * The edition is required in the heading for the reason `packages/README.md` argues at length: the
 * two numbers are independent, and a reader who finds only a version has to go and work out which
 * specification that release encoded. Writing it costs a phrase and answers it forever.
 */
const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf8").catch(() => "");
const heading = changelog
  .split("\n")
  .find((line) => line.startsWith(`## [${version}]`) || line.startsWith(`## ${version}`));

if (heading === undefined) {
  console.error(`CHANGELOG.md has no section for ${version}.\n`);
  console.error("  Add one before the tag, in the form:");
  console.error(`    ## [${version}] - <date> — edition <edition>`);
  console.error(
    "\n  A release nobody wrote down is one a consumer has to read a diff to understand.",
  );
  process.exit(1);
}

if (!/edition\s+\d+\.\d+/i.test(heading)) {
  console.error(`CHANGELOG.md's section for ${version} names no edition:\n`);
  console.error(`    ${heading.trim()}`);
  console.error(
    "\n  A package version and an edition are independent and neither can be read off the other,",
  );
  console.error("  so an entry that states only the first leaves the question it raises open.");
  process.exit(1);
}

// Every release tag except the one naming the version being released, newest first. `-v:refname`
// sorts them as versions rather than as strings, so v0.10.0 lands above v0.9.0.
const previous = git("tag", "--list", "v*", "--sort=-v:refname")
  .split("\n")
  .map((tag) => tag.trim())
  .filter((tag) => tag !== "" && tag !== `v${version}`)[0];

if (!previous) {
  console.log(`No release before v${version}. Nothing to compare an edition against.`);
  process.exit(0);
}

const [major, minor] = version.split("-")[0].split(".").map(Number);
const [prevMajor, prevMinor] = previous.slice(1).split("-")[0].split(".").map(Number);

// The smallest release that may carry an edition change, and it is not the same component forever.
//
// What is being protected is the range a consumer wrote, and npm reads a caret differently on
// either side of 1.0.0. `^0.1.0` means `>=0.1.0 <0.2.0`, so while these packages are on a zero
// MAJOR a MINOR is already a wall: nobody crosses it without editing their own manifest, and
// forbidding a PATCH is the whole of what is needed. `^1.0.0` means `>=1.0.0 <2.0.0` and takes
// every MINOR there is, so from 1.0.0 the same release would arrive in a deployed Worker's next
// install — and `mount()` writes the edition into the Descriptor from the package, so that Worker
// would start declaring a different specification to everybody reading it without anyone having
// touched its code. From 1.0.0, an edition change is a MAJOR.
const zeroMajor = prevMajor === 0 && major === 0;
const required = zeroMajor ? "MINOR" : "MAJOR";
const bigEnough = zeroMajor ? minor !== prevMinor : major !== prevMajor;

const offenders: string[] = [];

for (const { path, manifest } of await publishable()) {
  const before = manifestAt(previous, path);
  if (!before) continue; // the package is new in this release

  const was = before.workerProtocolEdition;
  const now = manifest.workerProtocolEdition;
  if (was === now) continue;

  offenders.push(`${manifest.name ?? path}: edition ${was ?? "(none)"} -> ${now ?? "(none)"}`);
}

if (offenders.length > 0 && !bigEnough) {
  console.error(
    `v${previous.slice(1)} -> v${version} is too small a release for what it carries:\n`,
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error(
    `\n  packages/README.md: an edition change needs at least a ${required} at this point in the`,
  );
  console.error("  packages' own history. A consumer's caret takes anything below that without");
  console.error("  reading a word, and mount() writes the edition into the Descriptor from the");
  console.error("  package — so a deployed Worker would start declaring another specification.");
  process.exit(1);
}

if (offenders.length > 0) {
  console.log(
    `v${previous.slice(1)} -> v${version} carries an edition change, and is large enough for it:`,
  );
  for (const offender of offenders) console.log(`  ${offender}`);
  process.exit(0);
}

console.log(`v${previous.slice(1)} -> v${version} changes no package's edition.`);

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Sets the version of the root manifest and of every publishable workspace member, in one move.
 *
 * One number for four packages is a deliberate simplification, not an oversight. They are released
 * together, they are tested together, and three of the four exist only because the fourth would
 * otherwise have to be re-derived by every consumer; a reader who finds `@worker-protocol/client`
 * at 0.4.0 and `@worker-protocol/schemas` at 0.2.7 learns nothing from the difference except that
 * they have to go and check which pairs were ever released together. The tag this produces names
 * the whole repository, which is what `scripts/release.ts` pushes.
 *
 * **This never touches `workerProtocolEdition`, and that is the whole point of the field.**
 * `packages/README.md` argues at length that the two numbers are independent: the package version
 * is SemVer about what a package exports, the edition is which specification it encodes, and
 * reading one off the other is a mistake that surfaces later in a consumer's lockfile as a schema
 * that does not mean what the code around it assumed. A script that bumped both would be that
 * mistake, automated. The one rule that binds the two — a release that changes which edition a
 * package encodes is never one a consumer's caret would take on its own — is checked by
 * `scripts/lint-release.ts`, at the release itself, because that is the moment a claim about
 * editions is made to anybody.
 *
 * Internal dependencies are all `workspace:*`, which pnpm rewrites to the published version at pack
 * time, so there is normally nothing to do there. The rewrite below exists for the day somebody
 * pins one to a real range: an internal dep left at an older version is a package that installs a
 * second copy of `@worker-protocol/schemas` beside the one it was built against.
 *
 * Usage:
 *   node scripts/bump.ts <patch|minor|major|x.y.z[-tag]> [--dry-run]
 */

const ROOT = join(import.meta.dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const spec = args.find((arg) => !arg.startsWith("--"));

if (!spec) {
  console.error(
    "Missing version. Usage: node scripts/bump.ts <patch|minor|major|x.y.z> [--dry-run]",
  );
  process.exit(1);
}

/**
 * Reads the `packages:` list out of pnpm-workspace.yaml.
 *
 * Hand-parsed rather than pulled from a YAML library, for the reason the rest of this repository's
 * tooling has no dependencies: the list is four lines and a dependency added here is one more thing
 * a release can be blocked on. It handles what that file actually contains — `dir/*` globs, a
 * literal path, and the indented comments that explain why `conformance/reference-worker` is not
 * under `examples/`. A top-level key ends the list.
 */
async function workspaceGlobs(): Promise<string[]> {
  const yaml = await readFile(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const globs: string[] = [];
  let inPackages = false;

  for (const line of yaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;

    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (/^\S/.test(line)) break; // the next top-level key ends the list

    const entry = trimmed.match(/^-\s*["']?(.+?)["']?$/);
    if (entry) globs.push(entry[1]);
  }

  return globs;
}

/** Resolves the globs to the manifests that exist, root last so it prints last. */
async function manifestPaths(): Promise<string[]> {
  const paths: string[] = [];

  for (const glob of await workspaceGlobs()) {
    const wildcard = glob.match(/^(.+)\/\*$/);
    if (!wildcard) {
      paths.push(join(ROOT, glob, "package.json"));
      continue;
    }
    const base = join(ROOT, wildcard[1]);
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (entry.isDirectory()) paths.push(join(base, entry.name, "package.json"));
    }
  }

  const found: string[] = [];
  for (const path of paths.sort()) {
    try {
      await readFile(path, "utf8");
      found.push(path);
    } catch {
      // a directory under a glob with no manifest of its own — not a workspace member
    }
  }

  found.push(join(ROOT, "package.json"));
  return found;
}

/** Accepts an explicit `x.y.z[-tag]`, or computes the next version from a keyword. */
function nextVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(bump)) return bump;

  const [major, minor, patch] = current.split("-")[0].split(".").map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      console.error(`Unknown bump "${bump}". Use patch, minor, major, or an explicit x.y.z`);
      return process.exit(1);
  }
}

const paths = await manifestPaths();
const manifests = new Map<string, Record<string, unknown>>();

for (const path of paths) {
  manifests.set(path, JSON.parse(await readFile(path, "utf8")));
}

/** Every workspace name, so a pinned internal dependency can be told from a third-party one. */
const internal = new Set(
  [...manifests.values()].map((pkg) => pkg.name).filter((name): name is string => !!name),
);

let changed = 0;

for (const [path, pkg] of manifests) {
  const rel = path.replace(`${ROOT}/`, "");

  // The examples and the reference Worker are `private: true` and are never published. Their
  // versions say nothing to anybody, and moving them would make every release touch six manifests
  // to state four facts. The root is private too, and is the exception: it carries no code, but its
  // version is the umbrella one, and `scripts/release.ts` reads it to name the tag.
  const isRoot = path === join(ROOT, "package.json");
  if (!isRoot && pkg.private === true) continue;

  const from = typeof pkg.version === "string" ? pkg.version : undefined;
  if (!from) {
    console.error(`${rel} has no version field. Add one, or mark the package private.`);
    process.exit(1);
  }

  const to = nextVersion(from, spec);
  pkg.version = to;

  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const deps = pkg[field] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (internal.has(dep) && !range.startsWith("workspace:")) deps[dep] = to;
    }
  }

  if (from === to) {
    console.log(`  =  ${pkg.name ?? rel}  already ${to}`);
    continue;
  }

  console.log(`  ${dryRun ? "~" : "✓"}  ${pkg.name ?? rel}  ${from} -> ${to}`);
  if (!dryRun) await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  changed += 1;
}

console.log(
  dryRun
    ? `\nDry run: ${changed} manifest(s) would change. Nothing written.`
    : `\nBumped ${changed} manifest(s). Commit them, then \`pnpm release\`.`,
);

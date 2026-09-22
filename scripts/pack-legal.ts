import { copyFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Copies the repository's LICENSE and NOTICE into the package being packed.
 *
 * Every package here is Apache-2.0 and every one of them travels alone: a consumer installs
 * `@worker-protocol/schemas` and gets a tarball, never this repository. Apache-2.0 asks that the
 * licence and the NOTICE reach whoever receives the work, and npm only ever includes what is inside
 * the package directory — a file one level up is not in the tarball, however plainly it sits at the
 * root of the repository that produced it.
 *
 * **The NOTICE is the part that would be missed.** npm picks up a `LICENSE` on its own, so that
 * half is nearly free; the NOTICE is where the trademark reservation lives — that "worker-protocol"
 * and any conformance claim made in its name are *not* licensed under Apache-2.0. A package that
 * ships the grant without the reservation states half of the terms, and it is the generous half.
 *
 * It copies at pack time rather than keeping four committed duplicates of each file, because two
 * copies of a licence are two things that can disagree, and the day they do is the day somebody
 * changed the one at the root. A copy made from the source seconds before the tarball is sealed
 * cannot drift. Both are ignored by git for the same reason.
 *
 * Runs from `prepack`, so the working directory is the package.
 */

const ROOT = join(import.meta.dirname, "..");
const pkg = process.cwd();

for (const file of ["LICENSE", "NOTICE"]) {
  await copyFile(join(ROOT, file), join(pkg, file));
}

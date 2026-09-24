import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What `@worker-protocol/conformance` publishes as its library imports no Node built-in.
 *
 * The claim is that `verify()` runs wherever a Worker does, and the published bytes are what a
 * bundler sees, so this reads `dist/` rather than the source — after `pnpm -r build`, which CI
 * runs before the suites. It walks from `dist/index.js` through every relative import, and it
 * stops at the package's edge: what leaves it must be a declared dependency, and whether THOSE
 * load outside Node is what `workerd.test.ts` shows by running the lot.
 *
 * `dist/cli.js` is not on this path and is exempt: a command line is Node's by definition.
 */

const PACKAGE = join(import.meta.dirname, "..", "..");
const DIST = join(PACKAGE, "dist");

/**
 * Every specifier a tsc-emitted module names: static imports and re-exports, then `import()`.
 *
 * No quote may come before `from`, because a statement's bindings never carry one and a data
 * literal always does: the universe has a key named `from`, and without that it reads as an import.
 */
const SPECIFIERS = [
  /^(?:import|export)\s[^;"]*?\bfrom\s+"([^"]+)"/gm,
  /^import\s*"([^"]+)"/gm,
  /\bimport\s*\(\s*"([^"]+)"\s*\)/g,
];

const BUILTINS = new Set(builtinModules);

/** A bare specifier's package: `zod/mini` is `zod`, `@scope/name/sub` is `@scope/name`. */
const packageOf = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

describe("the library path", () => {
  it("imports nothing from Node, from dist/index.js down", async () => {
    const manifest = JSON.parse(await readFile(join(PACKAGE, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = new Set(Object.keys(manifest.dependencies ?? {}));

    const offences: string[] = [];
    const seen = new Set<string>();
    const pending = [join(DIST, "index.js")];

    while (pending.length > 0) {
      const file = pending.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const where = relative(PACKAGE, file);

      const source = await readFile(file, "utf8");
      for (const pattern of SPECIFIERS) {
        for (const [, specifier] of source.matchAll(pattern)) {
          if (specifier.startsWith(".")) {
            pending.push(join(dirname(file), specifier));
          } else if (specifier.startsWith("node:") || BUILTINS.has(specifier)) {
            offences.push(`${where} imports the Node built-in "${specifier}"`);
          } else if (!dependencies.has(packageOf(specifier))) {
            offences.push(`${where} imports "${specifier}", which package.json does not depend on`);
          }
        }
      }
    }

    expect(offences).toEqual([]);
    // The walk reached the whole library, the generated universe included, rather than stopping
    // at a first file whose imports it failed to read.
    expect(seen.has(join(DIST, "rules.generated.js"))).toBe(true);
    expect(seen.has(join(DIST, "cli.js"))).toBe(false);
  });
});

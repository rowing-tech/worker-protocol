import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import { registry, schemaId } from "./index.ts";

/**
 * Generates `schemas/` from the Zod objects, or checks that what is committed matches.
 *
 *   node packages/schemas/src/generate.ts            writes
 *   node packages/schemas/src/generate.ts --check    compares, exits 1 on any difference
 *
 * The check exists because a generated artifact nobody compares is a claim nobody verifies. It
 * compares bytes rather than trusting that the generator behaved, which matters more than it
 * sounds: the toolchain, not the specification, is where a foreign assumption gets in — see the
 * safe-integer bound stripped below.
 *
 * Nothing here decides anything. Every shape comes from `./index.ts`, which encodes rules that
 * `spec/` states.
 */

const OUT_DIR = join(import.meta.dirname, "..", "..", "..", "schemas");

/** JavaScript's `Number.MAX_SAFE_INTEGER`, which Zod attaches to every integer. */
const JS_SAFE_MAX = 9007199254740991;
const JS_SAFE_MIN = -9007199254740991;

/**
 * Removes the safe-integer bounds Zod emits for an integer.
 *
 * Left in, the normative artifact would impose a JavaScript limit on implementations this
 * protocol exists to admit — a cron job in Python over Postgres has no such ceiling, and no rule
 * in `spec/` states one. This is the generator removing its own fingerprint, not a decision.
 */
function stripRuntimeArtifacts(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripRuntimeArtifacts);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const isInteger = (node as Record<string, unknown>).type === "integer";
    if (isInteger && key === "maximum" && value === JS_SAFE_MAX) continue;
    if (isInteger && key === "minimum" && value === JS_SAFE_MIN) continue;
    out[key] = stripRuntimeArtifacts(value);
  }
  return out;
}

/**
 * Builds every schema in the registry.
 *
 * `uri` returns a bare file name, so Zod writes relative `$ref`s between schemas — the reason a
 * host name, once one is chosen, need appear only on an `$id` line. Zod drives `$id` from the
 * same hook, so each document's own `$id` is rewritten afterwards through `schemaId`.
 */
function build(): Map<string, string> {
  const { schemas } = z.toJSONSchema(registry, {
    uri: (id) => `${id}.json`,
    target: "draft-2020-12",
  });

  const files = new Map<string, string>();
  for (const [id, schema] of Object.entries(schemas)) {
    const cleaned = stripRuntimeArtifacts(schema) as Record<string, unknown>;
    const ordered = { ...cleaned, $id: schemaId(id) };
    files.set(`${id}.json`, `${JSON.stringify(ordered, null, 2)}\n`);
  }
  return files;
}

/**
 * Every `.json` currently in `schemas/`.
 *
 * The check needs this and not only the generated names, because a schema dropped from the
 * registry leaves its file behind. Comparing generated names one by one would pass — every name
 * it knows about matches — while a stale normative artifact sits in the tree that nothing
 * produces and nobody regenerates. The set has to match in both directions.
 */
async function committed(): Promise<string[]> {
  try {
    const entries = await readdir(OUT_DIR);
    return entries.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

const files = build();
const check = process.argv.includes("--check");
const onDisk = await committed();
const orphans = onDisk.filter((name) => !files.has(name));

if (check) {
  const differences: string[] = [];
  for (const [name, expected] of files) {
    let actual: string | null = null;
    try {
      actual = await readFile(join(OUT_DIR, name), "utf8");
    } catch {
      differences.push(`${name}: missing`);
      continue;
    }
    if (actual !== expected) differences.push(`${name}: differs from the Zod source`);
  }
  for (const name of orphans) {
    differences.push(`${name}: not produced by packages/schemas`);
  }

  if (differences.length > 0) {
    console.error("schemas/ does not match packages/schemas:\n");
    for (const line of differences) console.error(`  ${line}`);
    console.error("\nRun `pnpm schemas:generate` and commit the result.");
    process.exit(1);
  }
  console.log(`schemas/ matches packages/schemas (${files.size} files).`);
} else {
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, contents] of files) {
    await writeFile(join(OUT_DIR, name), contents, "utf8");
    console.log(`wrote schemas/${name}`);
  }
  for (const name of orphans) {
    await rm(join(OUT_DIR, name));
    console.log(`removed schemas/${name} (nothing in packages/schemas produces it)`);
  }
}

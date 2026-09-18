import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EDITION } from "./index.ts";
import { CODES, RESPONSE_HEADERS, SURFACES, type Surface } from "./surfaces.ts";

/**
 * Generates `openapi/` from `surfaces.ts`, or checks that what is committed matches.
 *
 *   node packages/schemas/src/generate-openapi.ts            writes
 *   node packages/schemas/src/generate-openapi.ts --check    compares, exits 1 on any difference
 *
 * The check exists for the reason `schemas:check` exists: a generated artifact nobody compares is a
 * claim nobody verifies. `openapi/` is normative for the surface, so a copy in the tree that no
 * longer matches its source is a normative document saying something nobody wrote.
 *
 * **One document, one declared address.** A Capability's address is a *server* as far as every
 * OpenAPI generator is concerned, and a path appended to a server is an address somebody assembled
 * — which ENDP-1 says no reader does. So `tasks`, which declares two addresses, has two documents,
 * and every document's path is `/` except the Descriptor's, whose route is the one this protocol
 * fixes.
 *
 * Nothing here decides anything. Every field comes from `surfaces.ts`, which cites a rule for each.
 */

const OUT_DIR = join(import.meta.dirname, "..", "..", "..", "openapi");

const statusOf = new Map(CODES.map((c) => [c.code, c.status]));

/** A parameter as OpenAPI states one. The `in` and the schema come straight from the declaration. */
const parameter = (p: (typeof SURFACES)[number]["operations"][number]["parameters"][number]) => ({
  name: p.name,
  in: p.in,
  required: p.required,
  description: `${p.rule}. ${p.description}`,
  ...(p.style === undefined ? {} : { style: p.style }),
  ...(p.explode === undefined ? {} : { explode: p.explode }),
  schema: p.schema,
});

/** `../schemas/x.json` — relative, so nothing here needs a host and nothing is retyped. */
const ref = (schema: string) => ({ $ref: `../schemas/${schema}.json` });

const responseHeaders = Object.fromEntries(
  RESPONSE_HEADERS.map((h) => [
    h.name,
    { description: `${h.rule}. ${h.description}`, required: h.required, schema: h.schema },
  ]),
);

function operation(op: Surface["operations"][number]) {
  // One response per distinct status. Several codes share a status — ENDP-26 forbids one code
  // under two statuses, not two codes under one — so the description names which may arrive.
  const byStatus = new Map<number, string[]>();
  for (const refusal of op.refusals) {
    if (statusOf.get(refusal.code) !== refusal.status) {
      console.error(
        `surfaces.ts: ${refusal.code} is declared ${refusal.status} here and ` +
          `${statusOf.get(refusal.code)} in CODES. ENDP-26 fixes one status per code.`,
      );
      process.exit(1);
    }
    const codes = byStatus.get(refusal.status) ?? [];
    codes.push(`\`${refusal.code}\` (${refusal.rule})`);
    byStatus.set(refusal.status, codes);
  }

  const responses: Record<string, unknown> = {};
  for (const answer of op.answers) {
    responses[String(answer.status)] = {
      description: `${answer.rule}. ${answer.description}`,
      headers: responseHeaders,
      ...(answer.schema === null
        ? {}
        : { content: { "application/json": { schema: ref(answer.schema) } } }),
    };
  }
  for (const [status, codes] of [...byStatus].sort(([a], [b]) => a - b)) {
    responses[String(status)] = {
      description: `ENDP-25. The shared error envelope, carrying one of: ${codes.join(", ")}.`,
      headers: responseHeaders,
      content: { "application/json": { schema: ref("error") } },
    };
  }

  return {
    summary: op.summary,
    description: `${op.rule}. ${op.description}`,
    ...(op.parameters.length === 0 ? {} : { parameters: op.parameters.map(parameter) }),
    ...(op.requestBody === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            description: `${op.requestBody.rule}. ${op.requestBody.description}`,
            content: {
              "application/json":
                op.requestBody.schema === null ? {} : { schema: ref(op.requestBody.schema) },
            },
          },
        }),
    responses,
  };
}

function document(surface: Surface) {
  return {
    openapi: "3.1.0",
    info: {
      title: surface.title,
      // The EDITION and not this package's version: an OpenAPI document describes the protocol's
      // surface, and packages/README.md spends a section on why the two numbers are independent.
      version: EDITION,
      description: surface.description,
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: [
      {
        url: `{${surface.server.variable}}`,
        description: `${surface.server.rule}. ${surface.server.description}`,
        variables: {
          [surface.server.variable]: {
            // OpenAPI requires a default and there is no such thing as a default address: a
            // client is constructed with one read from a Descriptor (DESC-12). `/` is chosen for
            // what happens when somebody forgets. A generator that substitutes it produces a
            // client aimed at its own origin, which fails locally and loudly; a plausible-looking
            // host would produce one that sends a Worker's credential to a domain nobody here
            // controls, quietly and over the network. The safer failure is the one that stays in.
            default: "/",
            description:
              "Read from the Worker's Descriptor and resolved per DESC-12. Never assembled by a " +
              "caller (ENDP-1). The default is `/` and not a host on purpose: a client that was " +
              "never given an address should fail at its own origin rather than reach somebody " +
              "else's.",
          },
        },
      },
    ],
    paths: {
      [surface.path]: Object.fromEntries(
        surface.operations.map((op) => [op.method, operation(op)]),
      ),
    },
  };
}

const files = new Map<string, string>();
for (const surface of SURFACES) {
  files.set(`${surface.document}.json`, `${JSON.stringify(document(surface), null, 2)}\n`);
}

/**
 * Every `.json` currently in `openapi/`.
 *
 * The check needs this and not only the generated names, for the reason `generate.ts` gives: a
 * document dropped from `surfaces.ts` leaves its file behind, and comparing generated names one by
 * one would pass while a stale normative artifact sat in the tree.
 */
async function committed(): Promise<string[]> {
  try {
    return (await readdir(OUT_DIR)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

const onDisk = await committed();
const orphans = onDisk.filter((name) => !files.has(name));

if (process.argv.includes("--check")) {
  const differences: string[] = [];
  for (const [name, expected] of files) {
    let actual: string | null = null;
    try {
      actual = await readFile(join(OUT_DIR, name), "utf8");
    } catch {
      differences.push(`${name}: missing`);
      continue;
    }
    if (actual !== expected) differences.push(`${name}: differs from surfaces.ts`);
  }
  for (const name of orphans) differences.push(`${name}: not produced by surfaces.ts`);

  if (differences.length > 0) {
    console.error("openapi/ does not match packages/schemas/src/surfaces.ts:\n");
    for (const line of differences) console.error(`  ${line}`);
    console.error("\nRun `pnpm openapi:generate` and commit the result.");
    process.exit(1);
  }
  console.log(`openapi/ matches surfaces.ts (${files.size} documents, edition ${EDITION}).`);
} else {
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, contents] of files) {
    await writeFile(join(OUT_DIR, name), contents, "utf8");
    console.log(`wrote openapi/${name}`);
  }
  for (const name of orphans) {
    await rm(join(OUT_DIR, name));
    console.log(`removed openapi/${name} (nothing in surfaces.ts produces it)`);
  }
}

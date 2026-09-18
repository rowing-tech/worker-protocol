import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { EDITION } from "@worker-protocol/schemas";
import { SURFACES, type Surface } from "./surfaces.ts";

/**
 * Generates `openapi/` from the routes in `surfaces.ts`, or checks that what is committed matches.
 *
 *   node packages/hono/src/generate-openapi.ts            writes
 *   node packages/hono/src/generate-openapi.ts --check    compares, exits 1 on any difference
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
 * **The library emits, this file normalises.** `@hono/zod-openapi` produces the document from the
 * same route objects `mount()` serves, which is the point of declaring the surface as routes. What
 * it emits is then rebuilt into one fixed shape — key order, no empty `components` or `webhooks`,
 * no description repeated inside a parameter's schema, and every `#/components/schemas/x` turned
 * into `../schemas/x.json` so that nothing here retypes a schema. Byte-for-byte comparison in CI is
 * only meaningful over a shape this repository controls, and a library's key order is not that.
 *
 * Nothing here decides anything. Every field comes from `surfaces.ts`, which cites a rule for each.
 */

const OUT_DIR = join(import.meta.dirname, "..", "..", "..", "openapi");

type Json = Record<string, unknown>;

/** `#/components/schemas/x` → `../schemas/x.json`, everywhere. Components are named by file. */
const externalise = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(externalise);
  if (node === null || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      out.$ref = value.replace(/^#\/components\/schemas\/(.+)$/, "../schemas/$1.json");
    } else {
      out[key] = externalise(value);
    }
  }
  return out;
};

/** One parameter, in the order `openapi/` has always written it. */
function parameter(p: Json): Json {
  const schema = { ...(p.schema as Json) };
  // The library copies the description onto the schema too, and a schema shared with `schemas/`
  // brings its title along; the parameter is described once, here, and the schema is only a shape.
  delete schema.description;
  delete schema.title;
  return {
    name: p.name,
    in: p.in,
    required: p.required,
    description: p.description,
    ...(p.style === undefined ? {} : { style: p.style }),
    ...(p.explode === undefined ? {} : { explode: p.explode }),
    schema,
  };
}

function response(r: Json): Json {
  return {
    description: r.description,
    headers: r.headers,
    ...(r.content === undefined ? {} : { content: r.content }),
  };
}

function operation(op: Json): Json {
  const body = op.requestBody as Json | undefined;
  return {
    summary: op.summary,
    description: op.description,
    ...(op.parameters === undefined
      ? {}
      : { parameters: (op.parameters as Json[]).map(parameter) }),
    ...(body === undefined
      ? {}
      : {
          requestBody: {
            required: body.required,
            description: body.description,
            content: Object.fromEntries(
              Object.entries(body.content as Record<string, Json>).map(([type, media]) => [
                type,
                // A body with no schema is the Worker's own (ACT-2), and `{}` says so more plainly
                // than an empty schema that every reader has to recognise as meaning the same.
                Object.keys(media.schema as object).length === 0 ? {} : media,
              ]),
            ),
          },
        }),
    responses: Object.fromEntries(
      Object.entries(op.responses as Record<string, Json>).map(([status, r]) => [
        status,
        response(r),
      ]),
    ),
  };
}

function document(surface: Surface): Json {
  const app = new OpenAPIHono();
  // A document needs the route and nothing behind it; the handler is never called.
  app.openapi(surface.route, (() => undefined) as never);

  const emitted = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: surface.title, version: EDITION },
  }) as unknown as { paths: Record<string, Record<string, Json>> };

  const paths: Json = {};
  for (const [path, byMethod] of Object.entries(emitted.paths)) {
    paths[path] = Object.fromEntries(
      Object.entries(byMethod).map(([method, op]) => [method, operation(op)]),
    );
  }

  return externalise({
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
    paths,
  }) as Json;
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
    console.error("openapi/ does not match packages/hono/src/surfaces.ts:\n");
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

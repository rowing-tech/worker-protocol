import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODES } from "../codes.ts";
import { SURFACES } from "../surfaces.ts";

/**
 * Structural checks over `openapi/`.
 *
 * `pnpm openapi:check` proves the directory matches its source; this proves the source produces
 * something an OpenAPI generator can actually use. A normative artifact nobody validates is the
 * claim this repository keeps writing gates against, and a `$ref` that resolves to nothing is the
 * cheapest way for one to be wrong.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const OPENAPI = join(ROOT, "openapi");

type Document = {
  openapi: string;
  info: { title: string; version: string };
  servers: { url: string; variables: Record<string, unknown> }[];
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
};

const names = (await readdir(OPENAPI)).filter((n) => n.endsWith(".json")).sort();
const documents = await Promise.all(
  names.map(
    async (name) => [name, JSON.parse(await readFile(join(OPENAPI, name), "utf8"))] as const,
  ),
);
const schemaFiles = new Set(
  (await readdir(join(ROOT, "schemas"))).filter((n) => n.endsWith(".json")),
);

const refs = (node: unknown, found: string[] = []): string[] => {
  if (Array.isArray(node)) for (const item of node) refs(item, found);
  else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") found.push(value);
      else refs(value, found);
    }
  }
  return found;
};

describe("openapi/", () => {
  it("holds one document per surface and nothing else", () => {
    expect(names).toEqual(SURFACES.map((s) => `${s.document}.json`).sort());
  });

  it.each(documents)("%s is an OpenAPI 3.1 document at one edition", (_name, doc: Document) => {
    expect(doc.openapi).toBe("3.1.0");
    // The EDITION and not the package version: an OpenAPI document describes the protocol.
    expect(doc.info.version).toMatch(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);
    expect(doc.info.title.length).toBeGreaterThan(0);
  });

  it.each(documents)(
    "%s serves one declared address and never assembles one",
    (_n, doc: Document) => {
      // ENDP-1: a declared address is a server, and a path appended to one is an address somebody
      // constructed. Every document has exactly one server, whose url is the variable it declares.
      expect(doc.servers).toHaveLength(1);
      const [server] = doc.servers;
      const variable = server.url.slice(1, -1);
      expect(server.url).toBe(`{${variable}}`);
      expect(Object.keys(server.variables)).toEqual([variable]);
      expect(Object.keys(doc.paths)).toHaveLength(1);

      // OpenAPI requires a default and there is no such thing as a default address. It is `/` for
      // what happens when somebody forgets: a generator that substituted a host would produce a
      // client that sends a Worker's credential to a domain nobody here controls, over the network
      // and without a sound. `/` fails at the caller's own origin instead, which is the failure
      // that stays in the building.
      const declared = server.variables[variable] as { default: string };
      expect(declared.default).toBe("/");
    },
  );

  it.each(documents)("%s refers only to schemas that exist", (_name, doc: Document) => {
    for (const ref of refs(doc)) {
      expect(ref.startsWith("../schemas/"), `${ref} points outside schemas/`).toBe(true);
      expect(schemaFiles.has(ref.replace("../schemas/", "")), `${ref} resolves to nothing`).toBe(
        true,
      );
    }
  });

  it.each(documents)(
    "%s answers every refusal with the status its code fixes",
    (_n, doc: Document) => {
      // ENDP-26: a code fixes one status. The generator refuses a surface that disagrees with CODES,
      // so what this holds is that the refusal statuses in the document are ones the vocabulary has.
      const known = new Set(CODES.map((c) => String(c.status)));
      for (const operations of Object.values(doc.paths)) {
        for (const operation of Object.values(operations)) {
          for (const status of Object.keys(operation.responses)) {
            if (Number(status) < 400) continue;
            expect(known.has(status), `${status} is answered by no code in the vocabulary`).toBe(
              true,
            );
          }
        }
      }
    },
  );

  it("describes no surface for `events`, which has no address", () => {
    // DESC-22 leaves the shared entry's address optional for exactly one Capability, and it is
    // this one. A document for it would be the artifact claiming a surface the specification
    // refuses to fix.
    expect(names).not.toContain("events.json");
    expect(SURFACES.some((s) => s.capability === "events")).toBe(false);
  });
});

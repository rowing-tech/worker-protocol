import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import * as schemas from "../index.ts";

/**
 * Runs `conformance/fixtures/` against the Zod objects.
 *
 * The fixtures are the evidence behind every claim of compliance and they are kept outside this
 * package so that a verifier in any language can use them; this is the one that runs them from
 * TypeScript. `pnpm schemas:check` already proves the Zod objects and the generated JSON Schemas
 * agree byte for byte, so a verdict reached here is a verdict about the normative artifact.
 *
 * What this suite does NOT do is judge a Worker. It judges documents, which is the half of
 * conformance that needs nothing answering over HTTP — `conformance/verifiability.md` records
 * which rules the other half reaches.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const FIXTURES = join(ROOT, "conformance", "fixtures");
const SCHEMAS = join(ROOT, "schemas");

type Fixture = {
  schema: string;
  valid: boolean;
  rule: string;
  why: string;
  document: unknown;
};

/** `capability-entry` is exported as `capabilityEntry`. The transform is the whole convention. */
const camelize = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const exported = schemas as unknown as Record<string, ZodType | undefined>;

const load = async <T>(dir: string, suffix: string): Promise<[string, T][]> => {
  const names = (await readdir(dir)).filter((n) => n.endsWith(suffix)).sort();
  return Promise.all(
    names.map(async (name) => [name, JSON.parse(await readFile(join(dir, name), "utf8")) as T]),
  );
};

const fixtures = await load<Fixture>(FIXTURES, ".json");
const generated = (await readdir(SCHEMAS)).filter((n) => n.endsWith(".json")).sort();

describe("every generated schema is reachable from TypeScript", () => {
  // A schema in `schemas/` with no export beside it is a normative document this package cannot
  // hand a consumer — and a fixture could never be written against it, because there would be
  // nothing here to judge it with. The gate belongs beside the fixtures for that reason.
  it.each(generated)("%s has a matching export", (file) => {
    const name = camelize(file.replace(/\.json$/, ""));
    expect(exported[name], `no export named \`${name}\``).toBeDefined();
  });
});

describe("conformance/fixtures", () => {
  it("is not empty", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)("%s", (name, fixture) => {
    // A fixture that names no rule is evidence for nothing, and the day it starts failing nobody
    // can say what that means. `conformance/fixtures/README.md` states the constraint; that the
    // cited rule EXISTS is a stronger gate and belongs with the verifier, which holds the rule
    // universe already.
    expect(fixture.rule, `${name} cites no rule id`).toMatch(/^[A-Z]{3,4}-\d+$/);
    expect(fixture.why?.length ?? 0, `${name} says nothing about what it shows`).toBeGreaterThan(0);

    const schema = exported[camelize(fixture.schema)];
    if (!schema) {
      expect.fail(`${name} names no schema in this package: \`${fixture.schema}\``);
    }

    const result = schema.safeParse(fixture.document);
    expect(
      result.success,
      fixture.valid
        ? `${name} should validate against \`${fixture.schema}\` (${fixture.rule}) and does not`
        : `${name} should be refused by \`${fixture.schema}\` (${fixture.rule}) and validates`,
    ).toBe(fixture.valid);
  });
});

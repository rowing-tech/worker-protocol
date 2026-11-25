import { mount, query } from "@worker-protocol/hono";
import { queriesEntry } from "@worker-protocol/schemas";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { Malformed } from "../call.ts";
import { consume } from "../index.ts";
import { readTolerantly } from "../tolerant.ts";

/**
 * DESC-39 — a consumer reads what its edition knows of a Worker and ignores what it does not.
 *
 * The Worker is a real `mount()`, and a `fetch` between the two rewrites what it answers into what
 * a Worker of a later edition might send: a Capability nobody here has heard of, a member added to
 * the Descriptor or to a document. Each of those must be read past. A value this edition DOES
 * define, sent wrong, must still be refused — that is the line the rule draws.
 */

const VERIFY = "tech.rowing.probe.verify";

const worker = mount({
  id: "tech.rowing.probe.worker",
  health: () => ({ status: "healthy", checks: {} }),
  tasks: {
    raises: { [VERIFY]: { payload: z.object({ vehicle: z.string() }) } },
    current: () => [{ id: "t1", type: VERIFY, payload: { vehicle: "a" }, since: new Date(0) }],
  },
  queries: {
    answers: {
      fleet: query({ result: z.object({ vehicles: z.number() }), read: () => ({ vehicles: 3 }) }),
    },
  },
});

type Json = Record<string, unknown>;
const isDescriptor = (url: string) => url.endsWith("/.well-known/worker-protocol");

/** `consume()` over the Worker, with its JSON answers passed through `edit` first. */
const later = (edit: (url: string, json: Json) => Json) => {
  const told: { url: string; rule: string; paths: string[] }[] = [];
  const consumed = consume("https://worker.invalid", {
    retries: 0,
    onIgnored: (found) => told.push(found),
    fetch: (async (url: string, init?: RequestInit) => {
      const answered = await worker.fetch(new Request(url, init));
      if (!answered.headers.get("content-type")?.includes("json")) return answered;
      const json = edit(url, (await answered.json()) as Json);
      return new Response(JSON.stringify(json), {
        status: answered.status,
        headers: answered.headers,
      });
    }) as typeof fetch,
  });
  return { consumed, told };
};

describe("a Worker of a later edition, read by this one (DESC-39)", () => {
  it("reads past a Capability this edition does not define, and says it did", async () => {
    const { consumed, told } = later((url, json) =>
      isDescriptor(url)
        ? {
            ...json,
            capabilities: {
              ...(json.capabilities as Json),
              frobs: { version: 1, address: "../frobs" },
            },
          }
        : json,
    );
    const worker = await consumed;
    expect(worker.ignored).toEqual(["capabilities.frobs"]);
    expect(worker.descriptor.capabilities).not.toHaveProperty("frobs");
    // Everything it does know is still offered, and answers.
    await expect(worker.health?.()).resolves.toMatchObject({ status: "healthy" });
    await expect(worker.queries?.read("fleet")).resolves.toEqual({ vehicles: 3 });
    expect(told).toEqual([
      {
        url: "https://worker.invalid/.well-known/worker-protocol",
        rule: "DESC-1",
        paths: ["capabilities.frobs"],
      },
    ]);
  });

  it("reads past a member added at the Descriptor's root", async () => {
    const { consumed } = later((url, json) =>
      isDescriptor(url) ? { ...json, owner: "fleet" } : json,
    );
    const worker = await consumed;
    expect(worker.ignored).toEqual(["owner"]);
    await expect(worker.health?.()).resolves.toMatchObject({ status: "healthy" });
  });

  it("reads past a member added inside a union of closed objects, and not an ambiguous one", () => {
    // A Query's declaration is one of two strict objects. Zod reports the added member against the
    // branch it came closest to, with the full path, so it is ignored like any other; were that to
    // change, every union read with `readTolerantly` would quietly stop being tolerant.
    const entry = { version: 1, address: "../queries", answers: { fleet: { parameters: {} } } };
    const added = { ...entry, answers: { fleet: { parameters: {}, result: {}, cost: "cheap" } } };
    const read = readTolerantly(queriesEntry, added);
    expect(read.success && read.ignored).toEqual(["answers.fleet.cost"]);
    // Both branches at once is no addition: it is a declaration this edition forbids.
    const both = { ...entry, answers: { fleet: { parameters: {}, result: {}, items: {} } } };
    expect(readTolerantly(queriesEntry, both).success).toBe(false);
  });

  it("reads past a member added to a document, a page envelope or an item in it", async () => {
    const { consumed, told } = later((url, json) => {
      if (url.endsWith("/health")) return { ...json, uptime: 99 };
      if (url.includes("/tasks")) {
        return {
          ...json,
          total: 1,
          items: (json.items as Json[]).map((task) => ({ ...task, priority: "high" })),
        };
      }
      return json;
    });
    const worker = await consumed;
    await expect(worker.health?.()).resolves.toEqual({ status: "healthy", checks: {} });
    const tasks = await worker.tasks?.list();
    expect(tasks?.map((task) => task.id)).toEqual(["t1"]);
    expect(tasks?.[0]).not.toHaveProperty("priority");
    expect(told.map(({ rule, paths }) => ({ rule, paths: [...paths].sort() }))).toEqual([
      { rule: "HLTH-2", paths: ["uptime"] },
      { rule: "TASK-5", paths: ["items.0.priority", "total"] },
    ]);
  });

  it("does not take a value this edition defines, sent wrong, for something it may ignore", async () => {
    const { consumed } = later((url, json) =>
      url.endsWith("/health") ? { ...json, status: "maintenance" } : json,
    );
    const worker = await consumed;
    const refused = await worker.health?.().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(Malformed);
    expect((refused as Malformed).rule).toBe("HLTH-2");
  });

  it("does not ignore a key of any record but `capabilities`", async () => {
    // A Task type is a name the Worker declared, so a key that does not validate there is the
    // Worker's fault and not a later edition's — the Descriptor is refused, as before.
    const { consumed } = later((url, json) => {
      if (!isDescriptor(url)) return json;
      const capabilities = json.capabilities as Json;
      return { ...json, skills: { "Not A Qualified Name": {} }, capabilities };
    });
    await expect(consumed).rejects.toBeInstanceOf(Malformed);
  });

  it("ignores nothing where nothing is unknown", async () => {
    const { consumed, told } = later((_url, json) => json);
    const worker = await consumed;
    await worker.health?.();
    await worker.tasks?.list();
    expect(worker.ignored).toEqual([]);
    expect(told).toEqual([]);
  });
});

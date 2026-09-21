import { describe, expect, it } from "vitest";
import { consume } from "../index.ts";

/**
 * Going from a Task in hand to the call that answers it.
 *
 * A Task carries its id, its type, its payload and when its condition began — and nothing about how
 * to answer it, because that is the owner's to say and it says it in its Descriptor: the Task type
 * names the one Action that answers it, and that Action declares the schema of its input. Both were
 * already in the document a consumer holds, two walks apart, and every consumer was making those
 * walks by hand.
 *
 * Where a Task can end more than one way, the endings are variants of that input (TASK-32), so
 * what comes back here is a discriminated union and a consumer picks the variant it can produce.
 */

const HEADERS = {
  "content-type": "application/json",
  "worker-protocol-edition": "0.1",
  "worker-protocol-capability-version": "1",
};

const SILENT = "tech.rowing.fleet.check-silent-vehicle";

/** Two ways the Task can end, as the schema travels: one Action, one union, two variants. */
const ANSWER_CHECK_INPUT = {
  anyOf: [
    {
      type: "object",
      properties: {
        outcome: { const: "found" },
        vehicle: { type: "string" },
        reachable: { type: "boolean" },
      },
      required: ["outcome", "vehicle", "reachable"],
    },
    {
      type: "object",
      properties: {
        outcome: { const: "missing" },
        vehicle: { type: "string" },
        lastSeen: { type: "string" },
      },
      required: ["outcome", "vehicle", "lastSeen"],
    },
  ],
};

const descriptor = {
  id: "tech.rowing.fleet.watcher",
  edition: "0.1",
  capabilities: {
    tasks: {
      version: 1,
      address: "../tasks",
      raises: { [SILENT]: { payload: { type: "object" }, answeredBy: "answer-check" } },
    },
    actions: {
      version: 1,
      address: "../actions",
      accepts: { "answer-check": { input: ANSWER_CHECK_INPUT, completesWithinCall: true } },
    },
  },
};

const worker = (document: unknown = descriptor) =>
  consume("https://worker.invalid", {
    fetch: (async (url: string) =>
      new URL(url).pathname.endsWith("/.well-known/worker-protocol")
        ? new Response(JSON.stringify(document), { headers: HEADERS })
        : new Response(JSON.stringify({ items: [] }), { headers: HEADERS })) as typeof fetch,
  });

describe("answers()", () => {
  it("names the one Action and hands back the shape it takes, endings and all", async () => {
    const owner = await worker();

    // The whole point: one call, from a Task's type to what a consumer has to post. The union is
    // handed back as it travels, so the consumer sees both endings and picks the one it can do.
    expect(owner.tasks?.answers(SILENT)).toEqual({
      action: "answer-check",
      input: ANSWER_CHECK_INPUT,
    });
  });

  it("is undefined for a type this Worker does not raise", async () => {
    const owner = await worker();
    expect(owner.tasks?.answers("tech.rowing.somebody.else-entirely")).toBeUndefined();
  });

  it("is undefined where the named Action is not one the `actions` entry accepts", async () => {
    // A Descriptor disagreeing with itself is a fault the verifier reports against the Worker
    // (DESC-18). A consumer is not the party to report it, and handing back a name that answers
    // `404` under ACT-6 would send it to make a call that cannot work.
    const dangling = structuredClone(descriptor);
    dangling.capabilities.tasks.raises[SILENT].answeredBy = "gone-missing";
    const owner = await worker(dangling);
    expect(owner.tasks?.answers(SILENT)).toBeUndefined();
  });

  it("is absent where the Worker declares no `tasks` at all", async () => {
    const bare = { id: "tech.rowing.fleet.watcher", edition: "0.1", capabilities: {} };
    const owner = await worker(bare);
    expect(owner.tasks).toBeUndefined();
  });
});

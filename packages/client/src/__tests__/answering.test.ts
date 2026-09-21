import { describe, expect, it } from "vitest";
import { consume } from "../index.ts";

/**
 * Going from a Task in hand to the call that answers it.
 *
 * A Task carries its id, its type, its payload and when its condition began — and nothing about how
 * to answer it, because that is the owner's to say and it says it in its Descriptor: the Task type
 * names the Actions that may answer it, and each of those declares the schema of its input. Both
 * were already in the document a consumer holds, two walks apart, and every consumer was making
 * those walks by hand.
 *
 * What the tests below pin is the walk and the three ways it comes back empty, because an empty
 * answer and a missing one are the same shape and a consumer has to tell them apart.
 */

const HEADERS = {
  "content-type": "application/json",
  "worker-protocol-edition": "0.1",
  "worker-protocol-capability-version": "1",
};

const SILENT = "tech.rowing.fleet.check-silent-vehicle";
const PRICED = "tech.rowing.fleet.price-a-tow";

/** The shape `record-check` takes, as it travels: JSON Schema, for a console or an agent to build. */
const RECORD_CHECK_INPUT = {
  type: "object",
  properties: { vehicle: { type: "string" }, reachable: { type: "boolean" } },
  required: ["vehicle", "reachable"],
};

const descriptor = {
  id: "tech.rowing.fleet.watcher",
  edition: "0.1",
  capabilities: {
    tasks: {
      version: 1,
      address: "../tasks",
      raises: {
        [SILENT]: { payload: { type: "object" }, answeredBy: ["record-check"] },
        // A type this Worker raises and names no Action for. TASK-2 admits it: the list says what
        // WOULD answer, and a condition resolved some other way names nothing.
        [PRICED]: { payload: { type: "object" }, answeredBy: [] },
      },
    },
    actions: {
      version: 1,
      address: "../actions",
      accepts: {
        "record-check": { input: RECORD_CHECK_INPUT, completesWithinCall: true },
      },
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
  it("names the Action and hands back the shape it takes", async () => {
    const owner = await worker();

    // The whole point: one call, from a Task's type to what a consumer has to post.
    expect(owner.tasks?.answers(SILENT)).toEqual([
      { action: "record-check", input: RECORD_CHECK_INPUT },
    ]);
  });

  it("is empty for a type this Worker does not raise", async () => {
    const owner = await worker();
    expect(owner.tasks?.answers("tech.rowing.somebody.else-entirely")).toEqual([]);
  });

  it("is empty where the type names no Action, which is a Worker's to do", async () => {
    // TASK-2's list tells a consumer what would answer, and nothing requires there to be one.
    const owner = await worker();
    expect(owner.tasks?.answers(PRICED)).toEqual([]);
  });

  it("drops an Action the `actions` entry does not accept, rather than naming a call that 404s", async () => {
    // A Descriptor disagreeing with itself is a fault the verifier reports against the Worker
    // (DESC-18). A consumer is not the party to report it, and handing back a name that answers
    // `404` under ACT-6 would send it to make a call that cannot work.
    const dangling = structuredClone(descriptor);
    dangling.capabilities.tasks.raises[SILENT].answeredBy = ["record-check", "gone-missing"];
    const owner = await worker(dangling);

    expect(owner.tasks?.answers(SILENT)).toEqual([
      { action: "record-check", input: RECORD_CHECK_INPUT },
    ]);
  });

  it("is absent where the Worker declares no `tasks` at all", async () => {
    const bare = { id: "tech.rowing.fleet.watcher", edition: "0.1", capabilities: {} };
    const owner = await worker(bare);
    expect(owner.tasks).toBeUndefined();
  });
});

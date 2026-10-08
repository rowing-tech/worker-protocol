import { describe, expect, it } from "vitest";
import { consume } from "../index.ts";

/**
 * Going from a Task in hand to the calls that answer it.
 *
 * A Task carries its id, its type, its payload and when its condition began — and nothing about how
 * to answer it, because that is the owner's to say and it says it in its Descriptor: the Task type
 * names the Actions that answer it (TASK-35), and each Action declares the schema of its input.
 * Both were already in the document a consumer holds, two walks apart, and every consumer was
 * making those walks by hand.
 */

const HEADERS = {
  "content-type": "application/json",
  "worker-protocol-edition": "0.5",
  "worker-protocol-capability-version": "1",
};

const SILENT = "tech.rowing.fleet.check-silent-vehicle";

const RECORD_CHECK_INPUT = {
  type: "object",
  properties: { vehicle: { type: "string" }, reachable: { type: "boolean" } },
  required: ["vehicle", "reachable"],
};

const REPORT_MISSING_INPUT = {
  type: "object",
  properties: { vehicle: { type: "string" }, lastSeen: { type: "string" } },
  required: ["vehicle", "lastSeen"],
};

const descriptor = {
  id: "tech.rowing.fleet.watcher",
  edition: "0.5",
  capabilities: {
    tasks: {
      version: 1,
      address: "../tasks",
      raises: {
        [SILENT]: { payload: { type: "object" }, answeredBy: ["record-check", "report-missing"] },
      },
    },
    actions: {
      version: 1,
      address: "../actions",
      accepts: {
        "record-check": { input: RECORD_CHECK_INPUT, completesWithinCall: true },
        "report-missing": { input: REPORT_MISSING_INPUT, completesWithinCall: true },
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
  it("names every Action that answers the type, each with the shape it takes", async () => {
    const owner = await worker();

    // The whole point: one call, from a Task's type to what a consumer could post. Each answer
    // comes back with its schema as it travels, in the order the owner declared them, so a console
    // renders one form per answer and an agent picks the one it can produce.
    expect(owner.tasks?.answers(SILENT)).toEqual([
      { action: "record-check", input: RECORD_CHECK_INPUT },
      { action: "report-missing", input: REPORT_MISSING_INPUT },
    ]);
  });

  it("is undefined for a type this Worker does not raise", async () => {
    const owner = await worker();
    expect(owner.tasks?.answers("tech.rowing.somebody.else-entirely")).toBeUndefined();
  });

  it("is empty for a type no Action answers", async () => {
    const elsewhere = structuredClone(descriptor);
    elsewhere.capabilities.tasks.raises[SILENT].answeredBy = [];
    const owner = await worker(elsewhere);
    expect(owner.tasks?.answers(SILENT)).toEqual([]);
  });

  it("leaves out a name the `actions` entry does not accept", async () => {
    // A Descriptor disagreeing with itself is a fault the verifier reports against the Worker
    // (DESC-18). A consumer is not the party to report it, and handing back a name that answers
    // `404` under ACT-6 would send it to make a call that cannot work.
    const dangling = structuredClone(descriptor);
    dangling.capabilities.tasks.raises[SILENT].answeredBy = ["gone-missing", "record-check"];
    const owner = await worker(dangling);
    expect(owner.tasks?.answers(SILENT)).toEqual([
      { action: "record-check", input: RECORD_CHECK_INPUT },
    ]);
  });

  it("answers for one Task: what applies now, with what the owner already filled in", async () => {
    // TASK-38 narrows the answers to what applies to this Task now; TASK-37 carries the values the
    // owner already knows, keyed by the Action they are for. A console fills the form with them.
    const owner = await worker();
    const task = {
      id: "silent:ABC-123",
      type: SILENT,
      payload: { vehicle: "ABC-123" },
      since: "2026-10-08T09:00:00Z",
      inputs: { "report-missing": { vehicle: "ABC-123" } },
      available: ["report-missing"],
    };
    expect(owner.tasks?.answers(task)).toEqual([
      { action: "report-missing", input: REPORT_MISSING_INPUT, prefill: { vehicle: "ABC-123" } },
    ]);
  });

  it("answers every answer of the type for a Task that does not say what applies", async () => {
    const owner = await worker();
    const task = { id: "t", type: SILENT, payload: {}, since: "2026-10-08T09:00:00Z" };
    expect(owner.tasks?.answers(task)?.map(({ action }) => action)).toEqual([
      "record-check",
      "report-missing",
    ]);
  });

  it("is absent where the Worker declares no `tasks` at all", async () => {
    const bare = { id: "tech.rowing.fleet.watcher", edition: "0.5", capabilities: {} };
    const owner = await worker(bare);
    expect(owner.tasks).toBeUndefined();
  });
});

describe("alerts.offers()", () => {
  it("names what the Alert offers, with its schema and the values it filled in", async () => {
    // ALRT-9: an Alert about a paused source offers the Action that resumes one, and says which.
    const withAlerts = structuredClone(descriptor) as typeof descriptor & {
      capabilities: { alerts?: unknown };
    };
    withAlerts.capabilities.alerts = { version: 1, address: "../alerts" };
    const owner = await worker(withAlerts);
    const alert = {
      id: "source-paused:portal",
      severity: "warning" as const,
      since: "2026-10-08T09:00:00Z",
      summary: "The portal source is paused.",
      actions: ["record-check", "gone-missing"],
      inputs: { "record-check": { vehicle: "ABC-123" } },
    };
    expect(owner.alerts?.offers(alert)).toEqual([
      { action: "record-check", input: RECORD_CHECK_INPUT, prefill: { vehicle: "ABC-123" } },
    ]);
  });
});

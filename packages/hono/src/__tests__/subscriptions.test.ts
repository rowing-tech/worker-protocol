import { describe, expect, it } from "vitest";
import * as z from "zod";
import { mount } from "../mount.ts";
import {
  type CloudEvent,
  eventHub,
  LIFECYCLE,
  lifecycleChanges,
  matches,
  memoryDeliveries,
  memorySubscriptions,
  SUBSCRIPTION_ENDED,
  type SubscriptionFacts,
  taskRaised,
} from "../subscriptions.ts";
import type { Worker } from "../worker.ts";

/**
 * `subscriptions`, checked without a socket: the address `mount()` serves, and the push.
 *
 * The sink is a `fetch` that answers the handshake and records what it was sent, so every rule
 * about what reaches a sink can be read off what it recorded.
 */

const ID = "tech.rowing.worker-protocol.subscribing";
const TYPE = "tech.rowing.fleet.vehicle-moved";

type Received = { method: string; url: string; headers: Headers; body: unknown };

/** A sink that allows this Worker's origin, unless told otherwise, and answers deliveries `status`. */
const sink = (behaviour: { allow?: boolean; status?: number[] } = {}) => {
  const received: Received[] = [];
  const statuses = [...(behaviour.status ?? [])];
  const fetch = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    received.push({
      method,
      url: String(url),
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: behaviour.allow === false ? {} : { "webhook-allowed-origin": ID },
      });
    }
    return new Response(null, { status: statuses.shift() ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { received, fetch };
};

const build = (overrides: Partial<SubscriptionFacts> = {}) => {
  const target = sink();
  const queue = memoryDeliveries();
  const subscriptions: SubscriptionFacts = {
    abandonAfterSeconds: 3600,
    store: memorySubscriptions(),
    queue,
    fetch: target.fetch,
    ...overrides,
  };
  const worker: Worker = {
    id: ID,
    authenticate: (token) =>
      token === undefined ? "unauthenticated" : { verdict: "accepted", caller: token },
    events: EVENTS,
    subscriptions,
  };
  const hub = eventHub({ id: ID, events: EVENTS, subscriptions });
  queue.consume(hub.deliver);
  const app = mount(worker);
  const call = (token: string, init: { query?: string; body?: unknown; method?: string } = {}) =>
    app.fetch(
      new Request(`http://worker.invalid/subscriptions${init.query ?? ""}`, {
        method: init.method ?? "POST",
        headers: { authorization: `Bearer ${token}` },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );
  return { app, call, hub, queue, target, subscriptions };
};

/** One declaration, handed to `mount()` and to the hub alike. */
const EVENTS = {
  publishes: {
    [TYPE]: { data: z.object({ vehicle: z.string() }) },
    [LIFECYCLE.taskRaised]: { data: z.object({}) },
  },
  republishWindowSeconds: 3600,
};

const request = (overrides: Record<string, unknown> = {}) => ({
  types: [TYPE],
  sink: "https://sink.example.com/events",
  sinkCredential: "sink-secret",
  ...overrides,
});

describe("subscriptions, the address", () => {
  it("is declared with its address and its abandonment window (SUB-1)", async () => {
    const { app } = build();
    const answer = await app.fetch(
      new Request("http://worker.invalid/.well-known/worker-protocol", {
        headers: { authorization: "Bearer acme" },
      }),
    );
    const document = (await answer.json()) as { capabilities: Record<string, unknown> };
    expect(document.capabilities.subscriptions).toEqual({
      version: 1,
      address: "../subscriptions",
      abandonAfterSeconds: 3600,
    });
    // EVT-13: no broker, and none of its three members.
    expect(document.capabilities.events).not.toHaveProperty("broker");
  });

  it("validates the sink before storing, and finds the same subscription again (SUB-7, SUB-10)", async () => {
    const { call, target } = build();
    const first = await call("acme", { body: request() });
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };

    const handshake = target.received.find((one) => one.method === "OPTIONS");
    expect(handshake?.headers.get("webhook-request-origin")).toBe(ID);

    // The same caller, sink, types and filters: the one that exists, and no second handshake.
    const again = await call("acme", { body: request() });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id });
    expect(target.received.filter((one) => one.method === "OPTIONS")).toHaveLength(1);
  });

  it("lists a caller's own, never another's, and never the sink credential (SUB-8)", async () => {
    const { call } = build();
    await call("acme", { body: request() });
    await call("globex", { body: request({ sink: "https://other.example.com/in" }) });
    const listed = (await (await call("acme", { method: "GET" })).json()) as {
      items: Record<string, unknown>[];
    };
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      types: [TYPE],
      sink: "https://sink.example.com/events",
    });
    expect(listed.items[0]).not.toHaveProperty("sinkCredential");
  });

  it("ends a caller's own subscription, and answers 404 for another's (SUB-9)", async () => {
    const { call } = build();
    const { id } = (await (await call("acme", { body: request() })).json()) as { id: string };
    expect((await call("globex", { method: "DELETE", query: `?subscription=${id}` })).status).toBe(
      404,
    );
    expect((await call("acme", { method: "DELETE", query: `?subscription=${id}` })).status).toBe(
      204,
    );
    expect((await call("acme", { method: "DELETE", query: `?subscription=${id}` })).status).toBe(
      404,
    );
  });

  it.each([
    [
      "a sink in plaintext",
      request({ sink: "http://sink.example.com/in" }),
      400,
      "schema_mismatch",
    ],
    [
      "a type the entry does not publish",
      request({ types: ["tech.rowing.fleet.nothing"] }),
      422,
      "unprocessable_content",
    ],
    ["a loopback sink", request({ sink: "https://127.0.0.1/in" }), 422, "unprocessable_content"],
    ["a private sink", request({ sink: "https://10.1.2.3/in" }), 422, "unprocessable_content"],
    ["an empty `all`", request({ filters: [{ all: [] }] }), 400, "schema_mismatch"],
  ])("refuses %s", async (_, body, status, code) => {
    const { call } = build();
    const answer = await call("acme", { body });
    expect(answer.status).toBe(status);
    expect(await answer.json()).toMatchObject({ code });
  });

  it("refuses a type the Contract does not allow, rather than dropping it (SUB-4)", async () => {
    const { call } = build({ allows: ({ caller }) => caller !== "globex" });
    const answer = await call("globex", { body: request() });
    expect(answer.status).toBe(403);
  });

  it("stores nothing for a sink that does not allow this Worker (SUB-10)", async () => {
    const refusing = sink({ allow: false });
    const { call } = build({ fetch: refusing.fetch });
    const answer = await call("acme", { body: request() });
    expect(answer.status).toBe(422);
    const listed = (await (await call("acme", { method: "GET" })).json()) as { items: unknown[] };
    expect(listed.items).toEqual([]);
  });

  it("exempts an origin named for development, and no other (SUB-5, SUB-6)", async () => {
    const { call } = build({ insecureSinkOrigins: ["http://127.0.0.1:3211"] });
    expect(
      (await call("acme", { body: request({ sink: "http://127.0.0.1:3211/events" }) })).status,
    ).toBe(201);
    expect(
      (await call("acme", { body: request({ sink: "http://127.0.0.1:9999/events" }) })).status,
    ).toBe(400);
  });

  it("refuses a parameter it does not know", async () => {
    const { call } = build();
    expect((await call("acme", { query: "?drop=1" })).status).toBe(400);
    expect((await call("acme", { method: "GET", query: "?cursor=x" })).status).toBe(400);
  });
});

describe("subscriptions, the push", () => {
  const deliveries = (received: Received[]) => received.filter((one) => one.method === "POST");

  it("delivers a structured CloudEvent with the sink's own credential (SUB-11)", async () => {
    const { call, hub, queue, target } = build();
    await call("acme", { body: request() });
    const event = await hub.publish({
      type: TYPE,
      subject: "ABC-123",
      data: { vehicle: "ABC-123" },
    });
    await queue.idle();

    const [delivered] = deliveries(target.received);
    expect(delivered?.headers.get("content-type")).toBe("application/cloudevents+json");
    expect(delivered?.headers.get("authorization")).toBe("Bearer sink-secret");
    expect(delivered?.body).toMatchObject({
      specversion: "1.0",
      id: event.id,
      source: ID,
      type: TYPE,
    });
  });

  it("keeps the id and instant an outbox row already has, so a republish is one event (EVT-8)", async () => {
    const { call, hub, queue, target } = build();
    await call("acme", { body: request() });
    const row = { type: TYPE, data: { vehicle: "ABC-123" }, id: "row-1", time: 0 };
    await hub.publish(row);
    await hub.publish(row);
    await queue.idle();

    const sent = deliveries(target.received).map((one) => one.body as CloudEvent);
    expect(sent.map((one) => [one.id, one.time])).toEqual([
      ["row-1", "1970-01-01T00:00:00Z"],
      ["row-1", "1970-01-01T00:00:00Z"],
    ]);
  });

  it("delivers only what every filter holds for, extensions included (SUB-13)", async () => {
    const { call, hub, queue, target } = build();
    await call("acme", {
      body: request({
        types: [LIFECYCLE.taskRaised],
        filters: [{ exact: { tasktype: "tech.rowing.fleet.verify-vehicle" } }],
      }),
    });
    const since = new Date(0);
    await hub.publish(
      taskRaised({ id: "t-1", type: "tech.rowing.fleet.inspect", payload: {}, since }),
    );
    await hub.publish(
      taskRaised({ id: "t-2", type: "tech.rowing.fleet.verify-vehicle", payload: {}, since }),
    );
    await queue.idle();

    const sent = deliveries(target.received).map((one) => (one.body as CloudEvent).subject);
    expect(sent).toEqual(["t-2"]);
  });

  it("retries what is worth retrying, and gives up on a refusal (SUB-12)", async () => {
    const { hub, subscriptions } = build();
    const store = subscriptions.store;
    const at = Date.now();
    await store.ensure("k", {
      id: "s-1",
      caller: "acme",
      types: [TYPE],
      sink: "https://sink.example.com/in",
      sinkCredential: "x",
      createdAt: at,
    });
    const event = (await hub.publish({ type: TYPE, data: {} })) as CloudEvent;
    const delivery = { subscription: "s-1", event, publishedAt: at, attempt: 1 };

    const busy = eventHub({
      id: ID,
      events: EVENTS,
      subscriptions: { ...subscriptions, fetch: sink({ status: [503] }).fetch },
    });
    expect(await busy.deliver(delivery)).toEqual({ retryAfterSeconds: 2 });

    const refusing = eventHub({
      id: ID,
      events: EVENTS,
      subscriptions: { ...subscriptions, fetch: sink({ status: [410] }).fetch },
    });
    // Given up rather than merely done, so the carrier can keep the event for somebody to read.
    expect(await refusing.deliver(delivery)).toEqual({
      done: true,
      gaveUp: { reason: "refused", status: 410 },
    });
    expect((await store.get("s-1"))?.failingSince).toBeTypeOf("number");
  });

  it("ends a revoked caller's subscription, says so, and keeps it listed (SUB-14, SUB-15)", async () => {
    let entitled = true;
    const { call, hub, queue, target } = build({ accepts: () => entitled });
    await call("acme", { body: request() });
    entitled = false;
    await hub.publish({ type: TYPE, data: { vehicle: "ABC-123" } });
    await queue.idle();

    const [ended] = deliveries(target.received);
    const sent = ended?.body as CloudEvent | undefined;
    expect(sent?.type).toBe(SUBSCRIPTION_ENDED);
    expect(sent?.data).toMatchObject({ reason: "revoked" });

    const listed = (await (await call("acme", { method: "GET" })).json()) as {
      items: Record<string, unknown>[];
    };
    expect(listed.items[0]).toMatchObject({ reason: "revoked" });
    expect(listed.items[0]).toHaveProperty("endedAt");
  });
});

describe("publishing a batch", () => {
  it("asks the store once per type, and hands every delivery over in one batch", async () => {
    const asked: string[] = [];
    const batches: number[] = [];
    const store = memorySubscriptions();
    const { call, subscriptions } = build({
      store: { ...store, forType: (type) => (asked.push(type), store.forType(type)) },
    });
    await call("acme", { body: request() });
    const hub = eventHub({
      id: ID,
      events: EVENTS,
      subscriptions: {
        ...subscriptions,
        queue: { send: () => undefined, sendBatch: (all) => void batches.push(all.length) },
      },
    });
    const events = await hub.publishAll([
      { type: TYPE, data: { vehicle: "A" } },
      { type: TYPE, data: { vehicle: "B" } },
      { type: LIFECYCLE.taskRaised, data: {} },
    ]);
    expect(events).toHaveLength(3);
    expect(asked.sort()).toEqual([TYPE, LIFECYCLE.taskRaised].sort());
    expect(batches).toEqual([2]);
  });
});

describe("publishing what the entry does not declare", () => {
  it("is refused before anything is sent (EVT-12)", async () => {
    const { hub } = build();
    await expect(hub.publish({ type: "tech.rowing.fleet.undeclared", data: {} })).rejects.toThrow(
      /EVT-12/,
    );
    // What a carrier asks first, to set one undeclared event aside instead of failing a batch.
    expect([hub.declares(TYPE), hub.declares("tech.rowing.fleet.undeclared")]).toEqual([
      true,
      false,
    ]);
  });
});

describe("the lifecycle, built and never detected", () => {
  it("compares two snapshots by id, and keeps nothing", () => {
    const { raised, ended } = lifecycleChanges({
      previous: [{ id: "a" }, { id: "b" }],
      current: [{ id: "b" }, { id: "c" }],
    });
    expect(raised.map((one) => one.id)).toEqual(["c"]);
    expect(ended.map((one) => one.id)).toEqual(["a"]);
  });

  it("treats an attribute the event does not carry as matching nothing", () => {
    const event = {
      specversion: "1.0",
      id: "e",
      source: ID,
      type: TYPE,
      time: "",
      datacontenttype: "application/json",
      data: {},
    } as CloudEvent;
    expect(matches([{ exact: { tasktype: "x" } }], event)).toBe(false);
    expect(matches([{ not: { exact: { tasktype: "x" } } }], event)).toBe(true);
    expect(matches(undefined, event)).toBe(true);
  });
});

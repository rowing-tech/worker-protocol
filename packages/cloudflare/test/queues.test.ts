import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { type Delivery, eventHub, type SubscriptionFacts } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  consumeQueues,
  deliveryQueue,
  durableSubscriptions,
  type GivenUp,
  type LogRow,
  type OutboxEvent,
} from "../src/index.ts";
import { fakeQueue, TYPE, whole } from "./outbound.ts";

/**
 * The two Queues, driven with `createMessageBatch` as a queue handler is tested on workerd: the
 * subscriptions in a real Durable Object, the Queues and the sink as fakes this test reads.
 */

const ID = "tech.rowing.fleet.tracker";
const SINK = "https://sink.example.com/events";
const EVENTS = {
  publishes: {
    [TYPE]: { data: z.object({ id: z.string() }), extensions: { depot: z.enum(["north"]) } },
  },
  republishWindowSeconds: 3600,
};

const build = (sinkStatus = 200) => {
  const deliveries = fakeQueue<Delivery>();
  const dead = fakeQueue<GivenUp>();
  const records: LogRow[] = [];
  const posted: string[] = [];
  const subscriptions: SubscriptionFacts = {
    abandonAfterSeconds: 86_400,
    store: durableSubscriptions(whole()),
    queue: deliveryQueue(deliveries.queue),
    fetch: (async (_url: string, init?: RequestInit) => {
      posted.push(String(init?.body));
      return new Response(null, { status: sinkStatus });
    }) as unknown as typeof fetch,
  };
  let brokerTakes = true;
  const handler = consumeQueues<unknown>({
    queues: { events: "events", deliveries: "deliveries" },
    hub: () => eventHub({ id: ID, events: EVENTS, subscriptions }),
    deadLetter: () => dead.queue,
    broker: async () => brokerTakes,
    record: async ({ rows }) => void records.push(...rows),
  });
  const subscribe = () =>
    subscriptions.store.ensure("k", {
      id: "s-1",
      caller: null,
      types: [TYPE],
      sink: SINK,
      sinkCredential: "secret",
      createdAt: Date.now(),
    });
  return {
    deliveries: deliveries.state,
    dead: dead.state,
    records,
    posted,
    handler,
    subscribe,
    refuseAtBroker: () => {
      brokerTakes = false;
    },
  };
};

const batchOf = <T>(queue: string, bodies: T[]) =>
  createMessageBatch<T>(
    queue,
    bodies.map((body, i) => ({ id: `m-${i}`, timestamp: new Date(), attempts: 1, body })),
  );

const event = (id: string, type = TYPE): OutboxEvent => ({ type, data: { id }, id, time: 1_000 });

describe("consumeQueues, the events Queue", () => {
  it("makes the first attempt itself, under the event's own id, and queues nothing delivered", async () => {
    const { handler, subscribe, deliveries, posted } = build();
    await subscribe();
    const batch = batchOf("events", [event("e-1"), event("e-2")]);
    await handler(batch, {});
    const result = await getQueueResult(batch, createExecutionContext());
    expect(result.explicitAcks.sort()).toEqual(["m-0", "m-1"]);
    expect(posted.map((body) => (JSON.parse(body) as { id: string }).id).sort()).toEqual([
      "e-1",
      "e-2",
    ]);
    expect(deliveries.sent).toEqual([]);
  });

  it("queues what the sink asked to retry, counted and with the delay the hub chose (SUB-12)", async () => {
    const { handler, subscribe, deliveries } = build(503);
    await subscribe();
    const batch = batchOf("events", [event("e-1")]);
    await handler(batch, {});
    expect((await getQueueResult(batch, createExecutionContext())).explicitAcks).toEqual(["m-0"]);
    expect(deliveries.sent).toMatchObject([{ subscription: "s-1", attempt: 2 }]);
    expect(deliveries.delays).toEqual([2]);
  });

  it("keeps a first attempt refused for good, and settles the event it belongs to", async () => {
    const { handler, subscribe, dead, records, deliveries } = build(410);
    await subscribe();
    const batch = batchOf("events", [event("e-1")]);
    await handler(batch, {});
    expect((await getQueueResult(batch, createExecutionContext())).explicitAcks).toEqual(["m-0"]);
    expect(dead.sent).toMatchObject([
      { kind: "delivery", gaveUp: { reason: "refused", status: 410 } },
    ]);
    expect(records).toMatchObject([{ level: "warn", fields: { reason: "refused" } }]);
    expect(deliveries.sent).toEqual([]);
  });

  it("sets aside an event carrying an extension its type does not declare (EVT-18)", async () => {
    const { handler, dead } = build();
    const odd = { ...event("e-1"), extensions: { region: "eu" } };
    const batch = batchOf("events", [odd]);
    await handler(batch, {});
    expect((await getQueueResult(batch, createExecutionContext())).explicitAcks).toEqual(["m-0"]);
    expect(dead.sent).toMatchObject([{ kind: "event", reason: "undeclared" }]);
    expect((dead.sent[0] as { detail: string }).detail).toMatch(/EVT-18.*region/);
  });

  it("retries an event the broker did not take, without its siblings", async () => {
    const refusing = build();
    refusing.refuseAtBroker();
    const atBroker = batchOf("events", [event("e-1")]);
    await refusing.handler(atBroker, {});
    expect((await getQueueResult(atBroker, createExecutionContext())).retryMessages).toMatchObject([
      { msgId: "m-0" },
    ]);
  });

  it("sets an undeclared event aside rather than retrying it, and says so (EVT-12)", async () => {
    const { handler, dead, records } = build();
    const mixed = batchOf("events", [event("e-1"), event("e-2", "tech.rowing.fleet.undeclared")]);
    await handler(mixed, {});
    const result = await getQueueResult(mixed, createExecutionContext());
    // Both settled: the declared one published, the undeclared one kept — no retry would mend it.
    expect(result.explicitAcks.sort()).toEqual(["m-0", "m-1"]);
    expect(dead.sent).toMatchObject([
      { kind: "event", event: { id: "e-2" }, reason: "undeclared" },
    ]);
    expect(records).toMatchObject([{ level: "error", fields: { event: "e-2" } }]);
  });
});

describe("consumeQueues, the deliveries Queue", () => {
  const delivery = (): Delivery => ({
    subscription: "s-1",
    event: {
      specversion: "1.0",
      id: "e-1",
      source: ID,
      type: TYPE,
      time: "1970-01-01T00:00:01Z",
      datacontenttype: "application/json",
      data: { id: "e-1" },
    },
    publishedAt: Date.now(),
    attempt: 1,
  });

  it("delivers to the sink and acknowledges (SUB-11)", async () => {
    const { handler, subscribe, posted, dead } = build();
    await subscribe();
    const batch = batchOf("deliveries", [delivery()]);
    await handler(batch, {});
    expect((await getQueueResult(batch, createExecutionContext())).explicitAcks).toEqual(["m-0"]);
    expect(posted).toHaveLength(1);
    expect(dead.sent).toEqual([]);
  });

  it("backs off from the attempt the body carries when the Queue has counted fewer", async () => {
    // Queued after a first attempt made from the events Queue: the body says 3, the Queue says 1.
    const { handler, subscribe } = build(503);
    await subscribe();
    // A batch by hand, because the delay a message is retried with is what this is about and
    // `getQueueResult` does not report it.
    const asked: (number | undefined)[] = [];
    const message = {
      id: "m-0",
      timestamp: new Date(),
      attempts: 1,
      body: { ...delivery(), attempt: 3 },
      ack: () => undefined,
      retry: (options?: { delaySeconds?: number }) => void asked.push(options?.delaySeconds),
    };
    const batch = {
      queue: "deliveries",
      messages: [message],
      ackAll: () => undefined,
      retryAll: () => undefined,
    } as unknown as MessageBatch<Delivery>;
    await handler(batch, {});
    expect(asked).toEqual([8]);
  });

  it("keeps a delivery refused for good in the dead-letter queue, and records why", async () => {
    const { handler, subscribe, dead, records } = build(410);
    await subscribe();
    const batch = batchOf("deliveries", [delivery()]);
    await handler(batch, {});
    expect((await getQueueResult(batch, createExecutionContext())).explicitAcks).toEqual(["m-0"]);
    expect(dead.sent).toMatchObject([
      {
        kind: "delivery",
        delivery: { subscription: "s-1", event: { id: "e-1" } },
        gaveUp: { reason: "refused", status: 410 },
      },
    ]);
    expect(records).toMatchObject([
      {
        level: "warn",
        fields: { subscription: "s-1", event: "e-1", reason: "refused", status: 410 },
      },
    ]);
  });
});

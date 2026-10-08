import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { GivenUp, OutboxEvent } from "@worker-protocol/cloudflare";
import { type CloudEvent, type Delivery, LIFECYCLE } from "@worker-protocol/hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { fleetOf, QUIET_AFTER_MS, QUIET_VEHICLE } from "../src/fleet.ts";
import worker from "../src/worker.ts";
import { captureEvents, fakeQueue } from "./outbound.ts";

/**
 * `subscriptions` on Cloudflare, end to end: the subscription in the durable object, the event
 * leaving its outbox for the events Queue, the Worker's consumer making the first attempt itself,
 * and the deliveries Queue carrying what the hub asked to retry.
 *
 * Three things about the platform are stood in for, and nothing else. The sink is a `fetch` this
 * test answers, because there is nobody at its address. The Queues are fakes that keep what they
 * are sent, because the real ones would hand each batch to this Worker's consumer on their own
 * schedule and in an isolate where that `fetch` does not exist; the batches are driven here with
 * `createMessageBatch`, which is how a queue handler is tested on workerd.
 */

const ID = "tech.rowing.fleet.tracker";
const SINK = "https://sink.example.com/events";
const MINUTE = 60_000;

type Received = { authorization: string | null; event: CloudEvent };

/** A sink that allows this Worker, records each delivery, and answers it from `statuses` in turn. */
const sinkAnswering = (statuses: number[] = []) => {
  const received: Received[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== SINK) throw new Error(`Nothing is listening at ${request.url}.`);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "webhook-allowed-origin": ID } });
    }
    received.push({
      authorization: request.headers.get("authorization"),
      event: (await request.json()) as CloudEvent,
    });
    return new Response(null, { status: statuses.shift() ?? 200 });
  });
  return received;
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** The real bindings, with the deliveries and dead-letter Queues swapped for ones that keep. */
const queued = () => {
  const deliveries = fakeQueue<Delivery>();
  const dead = fakeQueue<GivenUp>();
  const bindings: Env = { ...env, DELIVERIES: deliveries.queue, DEAD: dead.queue };
  return {
    deliveries: deliveries.state.sent,
    delays: deliveries.state.delays,
    dead: dead.state.sent,
    env: bindings,
  };
};

const call = (
  bindings: Env,
  init: { path?: string; method?: string; query?: string; body?: unknown } = {},
) =>
  worker.fetch(
    new Request(`https://fleet.invalid${init.path ?? "/subscriptions"}${init.query ?? ""}`, {
      method: init.method ?? "POST",
      headers: { authorization: "Bearer a-token", "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    bindings,
    createExecutionContext(),
  );

const listed = async (bindings: Env) =>
  ((await (await call(bindings, { method: "GET" })).json()) as { items: Record<string, unknown>[] })
    .items;

/** The typical subscriber: a backend that wants to hear when a Task of one type is raised. */
const raisedTasks = {
  types: [LIFECYCLE.taskRaised],
  filters: [{ exact: { tasktype: QUIET_VEHICLE } }],
  sink: SINK,
  sinkCredential: "sink-secret",
};

/**
 * One batch of `bodies` through the Worker's own consumer, as the named Queue would hand it over.
 *
 * `getQueueResult` reports which messages were retried and not the delay each asked for, so the
 * delay is read off the call to `retry` itself.
 */
const consume = async <T>(given: { queue: string; bodies: T[]; env: Env }) => {
  const batch = createMessageBatch<T>(
    given.queue,
    given.bodies.map((body, i) => ({ id: `m-${i}`, timestamp: new Date(), attempts: 1, body })),
  );
  const retries = batch.messages.map((message) => vi.spyOn(message, "retry"));
  await worker.queue(batch, given.env);
  const result = await getQueueResult(batch, createExecutionContext());
  return { ...result, delays: retries.flatMap((spy) => spy.mock.calls.map(([asked]) => asked)) };
};

/**
 * A vehicle that crosses into quiet, so its Task is born now; the events its object sent come back,
 * and run through the events Queue's consumer to the deliveries they owe.
 */
const quietVehicle = async (vehicle: string, bindings: Env) => {
  const events = await captureEvents(fleetOf(env));
  const now = Date.now();
  await fleetOf(env).ingest([{ vehicle, at: now - 20 * MINUTE }], now, QUIET_AFTER_MS);
  return consume<OutboxEvent>({ queue: "fleet-events", bodies: events.sent, env: bindings });
};

describe("subscribing, kept in the durable object", () => {
  it("stores one subscription, finds it again, and lists it without its credential (SUB-7, SUB-8)", async () => {
    sinkAnswering();
    const { env: bindings } = queued();

    const first = await call(bindings, { body: raisedTasks });
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };

    // A second isolate asking for the same thing finds the same row, which is SUB-7's promise and
    // the reason the store is the durable object rather than a Map.
    const again = await call(bindings, { body: raisedTasks });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id });

    const items = await listed(bindings);
    expect(items.map((one) => one.id)).toEqual([id]);
    expect(items[0]).not.toHaveProperty("sinkCredential");

    const ended = await call(bindings, { method: "DELETE", query: `?subscription=${id}` });
    expect(ended.status).toBe(204);
    expect((await call(bindings, { method: "DELETE", query: `?subscription=${id}` })).status).toBe(
      404,
    );
  });
});

describe("the push, first attempt from the events Queue", () => {
  it("delivers the Task the cycle raised to the subscription its filter matches (EVT-15, SUB-13)", async () => {
    const received = sinkAnswering();
    const { env: bindings, deliveries } = queued();
    await call(bindings, { body: raisedTasks });

    const fanned = await quietVehicle("ZZZ-999", bindings);
    // Two events left the outbox — the crossing and its Task — and both were taken; the filter
    // wants one of them, and its first attempt was made right there, so nothing was queued.
    expect(fanned.explicitAcks.sort()).toEqual(["m-0", "m-1"]);
    expect(deliveries).toEqual([]);
    expect(received).toHaveLength(1);
    expect(received[0]?.authorization).toBe("Bearer sink-secret");
    expect(received[0]?.event).toMatchObject({
      source: ID,
      type: LIFECYCLE.taskRaised,
      subject: "quiet:ZZZ-999",
      tasktype: QUIET_VEHICLE,
      data: { payload: { vehicle: "ZZZ-999" } },
    });
    // SUB-8: the delivery is on record where the subscriber can read it.
    expect((await listed(bindings))[0]).toHaveProperty("lastDeliveredAt");
  });

  it("queues a failed first attempt with the hub's delay, and the deliveries Queue retries it (SUB-12)", async () => {
    const received = sinkAnswering([503]);
    const { env: bindings, deliveries, delays } = queued();
    await call(bindings, { body: raisedTasks });
    await quietVehicle("YYY-888", bindings);

    // SUB-12: backoff from two seconds, decided by the hub and carried by the Queue.
    expect(deliveries).toMatchObject([{ attempt: 2, event: { subject: "quiet:YYY-888" } }]);
    expect(delays).toEqual([2]);
    expect((await listed(bindings))[0]).toHaveProperty("failingSince");

    const retried = await consume({ queue: "fleet-deliveries", bodies: deliveries, env: bindings });
    expect(retried.explicitAcks).toEqual(["m-0"]);
    expect(received).toHaveLength(2);
    expect((await listed(bindings))[0]).not.toHaveProperty("failingSince");
  });

  it("keeps a first attempt refused for good in the dead-letter queue, and says so in /logs", async () => {
    sinkAnswering([410]);
    const { env: bindings, deliveries, dead } = queued();
    await call(bindings, { body: raisedTasks });
    const fanned = await quietVehicle("XXX-777", bindings);

    expect(fanned.explicitAcks.sort()).toEqual(["m-0", "m-1"]);
    expect(deliveries).toEqual([]);
    expect(dead).toMatchObject([
      {
        kind: "delivery",
        delivery: { event: { subject: "quiet:XXX-777" } },
        gaveUp: { reason: "refused", status: 410 },
      },
    ]);

    // An operator without the Cloudflare account reads it through the protocol.
    const page = (await (
      await call(bindings, { path: "/logs", method: "GET", query: "?level=warn" })
    ).json()) as { items: { message: string; fields?: Record<string, unknown> }[] };
    expect(page.items).toMatchObject([
      { message: "a delivery was given up", fields: { reason: "refused", status: 410 } },
    ]);
  });
});

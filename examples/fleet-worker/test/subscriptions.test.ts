import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { type CloudEvent, type Delivery, LIFECYCLE } from "@worker-protocol/hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { fleetOf, QUIET_AFTER_MS, QUIET_VEHICLE } from "../src/fleet.ts";
import worker, { cycle } from "../src/worker.ts";

/**
 * `subscriptions` on Cloudflare: the subscriptions in the durable object, each delivery a message on
 * a Queue, and the Worker's own `queue` handler making the attempt.
 *
 * Two things about the platform are stood in for, and nothing else. The sink is a `fetch` this test
 * answers, because there is nobody at its address. And the Queue is swapped for one that keeps what
 * it is sent, because the real one would hand each batch to this Worker's consumer on its own
 * schedule and in an isolate where that `fetch` does not exist; the batch is driven here instead,
 * with `createMessageBatch`, which is how a queue handler is tested on workerd.
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

/** The real bindings, with the Queue swapped for one that keeps what it is sent. */
const queued = () => {
  const sent: Delivery[] = [];
  const DELIVERIES = {
    send: async (delivery: Delivery) => {
      sent.push(delivery);
    },
  } as unknown as Env["DELIVERIES"];
  return { sent, env: { ...env, DELIVERIES } as Env };
};

const call = (bindings: Env, init: { method?: string; query?: string; body?: unknown } = {}) =>
  worker.fetch(
    new Request(`https://fleet.invalid/subscriptions${init.query ?? ""}`, {
      method: init.method ?? "POST",
      headers: { authorization: "Bearer a-token", "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    bindings,
    createExecutionContext(),
  );

/** The typical subscriber: a backend that wants to hear when a Task of one type is raised. */
const raisedTasks = {
  types: [LIFECYCLE.taskRaised],
  filters: [{ exact: { tasktype: QUIET_VEHICLE } }],
  sink: SINK,
  sinkCredential: "sink-secret",
};

/**
 * Everything the Queue was sent, as one batch through the Worker's own consumer.
 *
 * `getQueueResult` reports which messages were retried and not the delay each asked for, so the
 * delay is read off the call to `retry` itself.
 */
const consume = async (bindings: Env, sent: Delivery[]) => {
  const batch = createMessageBatch<Delivery>(
    "fleet-deliveries",
    sent.splice(0).map((body, i) => ({ id: `m-${i}`, timestamp: new Date(), attempts: 1, body })),
  );
  const retries = batch.messages.map((message) => vi.spyOn(message, "retry"));
  await worker.queue(batch, bindings);
  const result = await getQueueResult(batch, createExecutionContext());
  return { ...result, delays: retries.flatMap((spy) => spy.mock.calls.map(([asked]) => asked)) };
};

/** A vehicle that crossed into quiet on this cycle, so its Task is born now. */
const quietVehicle = async (vehicle: string) => {
  const now = Date.now();
  await fleetOf(env).ingest([{ vehicle, at: now - 20 * MINUTE }], now, QUIET_AFTER_MS);
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

    const listed = (await (await call(bindings, { method: "GET" })).json()) as {
      items: Record<string, unknown>[];
    };
    expect(listed.items.map((one) => one.id)).toEqual([id]);
    expect(listed.items[0]).not.toHaveProperty("sinkCredential");

    const ended = await call(bindings, { method: "DELETE", query: `?subscription=${id}` });
    expect(ended.status).toBe(204);
    expect((await call(bindings, { method: "DELETE", query: `?subscription=${id}` })).status).toBe(
      404,
    );
  });
});

describe("the push, over a Queue", () => {
  it("delivers the Task the cycle raised, once per matching subscription (EVT-15, SUB-11, SUB-13)", async () => {
    const received = sinkAnswering();
    const { env: bindings, sent } = queued();
    await call(bindings, { body: raisedTasks });

    await quietVehicle("ZZZ-999");
    await cycle(bindings, async () => true);
    // Two events were raised — the crossing and its Task — and the filter wants one of them.
    expect(sent.map((one) => one.event.type)).toEqual([LIFECYCLE.taskRaised]);

    const result = await consume(bindings, sent);
    expect(result.explicitAcks).toEqual(["m-0"]);
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
    const listed = (await (await call(bindings, { method: "GET" })).json()) as {
      items: Record<string, unknown>[];
    };
    expect(listed.items[0]).toHaveProperty("lastDeliveredAt");
  });

  it("hands a failing delivery back to the Queue with the hub's delay (SUB-12)", async () => {
    sinkAnswering([503]);
    const { env: bindings, sent } = queued();
    await call(bindings, { body: raisedTasks });
    await quietVehicle("YYY-888");
    await cycle(bindings, async () => true);

    const result = await consume(bindings, sent);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toMatchObject([{ msgId: "m-0" }]);
    // SUB-12: backoff from two seconds, decided by the hub and carried by the Queue.
    expect(result.delays).toEqual([{ delaySeconds: 2 }]);

    const listed = (await (await call(bindings, { method: "GET" })).json()) as {
      items: Record<string, unknown>[];
    };
    expect(listed.items[0]).toHaveProperty("failingSince");
  });

  it("republishes a row the broker refused under the id it already had (EVT-8)", async () => {
    sinkAnswering();
    const { env: bindings, sent } = queued();
    await call(bindings, { body: raisedTasks });
    await quietVehicle("XXX-777");

    // The crossing reaches the broker and the Task does not. The subscribers went first, so the
    // broker being down cost them a repeat and never a loss — and the repeat is the same event,
    // which a sink remembering `source` and `id` discards.
    let attempts = 0;
    await cycle(bindings, async () => ++attempts !== 2);
    await cycle(bindings, async () => true);
    const ids = sent.map((one) => one.event.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
});

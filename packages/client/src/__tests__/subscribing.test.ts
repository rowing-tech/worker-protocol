import {
  eventHub,
  memoryDeliveries,
  memorySubscriptions,
  mount,
  type SubscriptionFacts,
} from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { consume, type ReceivedEvent, Refused, sink } from "../index.ts";

/**
 * Both ends of `subscriptions`, meeting: `consume()` subscribing, a Worker on `mount()` pushing, and
 * `sink()` receiving — the shape a Convex app takes, with its HTTP action as the sink.
 *
 * Nothing crosses a socket. The Worker's `fetch` for the handshake and the deliveries is the sink's
 * own handler, and the consumer's `fetch` is the Worker's app, so every rule is exercised in one
 * process exactly as it would be across two.
 */

const ID = "tech.rowing.worker-protocol.pushing";
const TYPE = "tech.rowing.fleet.vehicle-moved";
const SINK = "https://app.example.com/events";
const EVENTS = {
  publishes: { [TYPE]: { data: z.object({ vehicle: z.string() }) } },
  republishWindowSeconds: 3600,
};

const build = (options: { origins?: string[]; failFirst?: boolean } = {}) => {
  const received: ReceivedEvent[] = [];
  let failing = options.failFirst === true;
  const receive = sink({
    credential: "sink-secret",
    origins: options.origins ?? [ID],
    windowSeconds: 3600,
    onEvent: (event) => {
      if (failing) {
        failing = false;
        throw new Error("not yet");
      }
      received.push(event);
    },
  });
  const queue = memoryDeliveries();
  const subscriptions: SubscriptionFacts = {
    abandonAfterSeconds: 3600,
    store: memorySubscriptions(),
    queue,
    fetch: ((url: string, init?: RequestInit) =>
      receive(new Request(url, init))) as unknown as typeof globalThis.fetch,
  };
  const app = mount({
    id: ID,
    authenticate: (token) =>
      token === undefined ? "unauthenticated" : { verdict: "accepted", caller: token },
    events: EVENTS,
    subscriptions,
  });
  const hub = eventHub({ id: ID, events: EVENTS, subscriptions });
  queue.consume(hub.deliver);
  const worker = () =>
    consume("https://worker.example.com", {
      credential: "acme",
      fetch: ((url: string, init?: RequestInit) =>
        app.fetch(new Request(url, init))) as unknown as typeof globalThis.fetch,
    });
  return { received, receive, hub, queue, worker };
};

const request = { types: [TYPE], sink: SINK, sinkCredential: "sink-secret" };

describe("subscribing with consume()", () => {
  it("subscribes, finds the same subscription again, and lists it (SUB-2, SUB-7, SUB-8)", async () => {
    const { worker } = build();
    const subscriptions = (await worker()).subscriptions;
    const first = await subscriptions?.subscribe(request);
    expect(first?.created).toBe(true);
    const again = await subscriptions?.subscribe(request);
    expect(again).toEqual({ id: first?.id, created: false });
    const listed = await subscriptions?.list();
    expect(listed?.map((one) => one.id)).toEqual([first?.id]);
  });

  it("ends a subscription, and is refused ending it twice (SUB-9)", async () => {
    const { worker } = build();
    const subscriptions = (await worker()).subscriptions;
    const { id } = (await subscriptions?.subscribe(request)) ?? { id: "" };
    await subscriptions?.unsubscribe(id);
    expect(await subscriptions?.list()).toEqual([]);
    await expect(subscriptions?.unsubscribe(id)).rejects.toBeInstanceOf(Refused);
  });

  it("is refused at once by a sink that does not allow the Worker (SUB-10)", async () => {
    const { worker } = build({ origins: ["tech.rowing.somebody.else"] });
    const subscriptions = (await worker()).subscriptions;
    await expect(subscriptions?.subscribe(request)).rejects.toMatchObject({
      code: "unprocessable_content",
    });
  });
});

describe("receiving with sink()", () => {
  it("hands an event over once, however many times it is delivered (EVT-8, SUB-12)", async () => {
    const { worker, hub, queue, received, receive } = build();
    await (await worker()).subscriptions?.subscribe(request);
    const event = await hub.publish({
      type: TYPE,
      subject: "ABC-123",
      data: { vehicle: "ABC-123" },
    });
    await queue.idle();
    expect(received.map((one) => one.id)).toEqual([event.id]);

    // The same event again, as an at-least-once delivery would bring it: acknowledged, not handled.
    const repeat = await receive(
      new Request(SINK, {
        method: "POST",
        headers: {
          authorization: "Bearer sink-secret",
          "content-type": "application/cloudevents+json",
        },
        body: JSON.stringify(event),
      }),
    );
    expect(repeat.status).toBe(200);
    expect(received).toHaveLength(1);
  });

  it("answers 500 when the handler throws, so the Worker's retry is handled (SUB-12)", async () => {
    const { receive, received } = build({ failFirst: true });
    const deliver = () =>
      receive(
        new Request(SINK, {
          method: "POST",
          headers: {
            authorization: "Bearer sink-secret",
            "content-type": "application/cloudevents+json",
          },
          body: JSON.stringify({ specversion: "1.0", id: "e-1", source: ID, type: TYPE }),
        }),
      );
    // The first attempt throws: `500`, which SUB-12 has the Worker retry, and the id is given back.
    expect((await deliver()).status).toBe(500);
    // The retry is handled, not mistaken for a repeat of something already done.
    expect((await deliver()).status).toBe(200);
    expect(received.map((one) => one.id)).toEqual(["e-1"]);
  });

  it.each([
    ["no credential", {}, "application/cloudevents+json", 401],
    ["another credential", { authorization: "Bearer wrong" }, "application/cloudevents+json", 401],
    ["binary mode", { authorization: "Bearer sink-secret" }, "application/json", 415],
  ])("refuses a delivery with %s", async (_, headers, type, status) => {
    const { receive } = build();
    const answer = await receive(
      new Request(SINK, {
        method: "POST",
        headers: { ...headers, "content-type": type },
        body: JSON.stringify({ specversion: "1.0", id: "e", source: ID, type: TYPE }),
      }),
    );
    expect(answer.status).toBe(status);
  });

  it("refuses an event from a Worker it never allowed", async () => {
    const { receive } = build();
    const answer = await receive(
      new Request(SINK, {
        method: "POST",
        headers: {
          authorization: "Bearer sink-secret",
          "content-type": "application/cloudevents+json",
        },
        body: JSON.stringify({
          specversion: "1.0",
          id: "e",
          source: "tech.rowing.other",
          type: TYPE,
        }),
      }),
    );
    expect(answer.status).toBe(403);
  });
});

import { runInDurableObject } from "cloudflare:test";
import type { StoredSubscription } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import { durableSubscriptions } from "../src/index.ts";
import { whole } from "./outbound.ts";

/** SUB-7's store, over a Durable Object of the test's own. */
const store = () => durableSubscriptions(whole());

const candidate = (over: Partial<StoredSubscription> = {}): StoredSubscription => ({
  id: crypto.randomUUID(),
  caller: "acme",
  types: ["tech.rowing.worker-protocol.task-raised"],
  filters: [{ any: [{ exact: { tasktype: "a" } }, { not: { prefix: { subject: "x" } } }] }],
  sink: "https://sink.example.com/in",
  sinkCredential: "secret",
  createdAt: Date.now(),
  ...over,
});

describe("withSubscriptions", () => {
  it("stores one subscription per key, filters and all (SUB-7)", async () => {
    const subscriptions = store();
    const first = await subscriptions.ensure("key", candidate());
    const again = await subscriptions.ensure("key", candidate());
    expect(first.created).toBe(true);
    expect(again).toEqual({ subscription: first.subscription, created: false });
    // The filters nest, and crossed the RPC boundary as JSON without losing any of it.
    expect((await subscriptions.find("key"))?.filters).toEqual(candidate().filters);
  });

  it("answers the live ones naming a type, and one caller's, ended ones included (SUB-8, SUB-13)", async () => {
    const subscriptions = store();
    const live = (await subscriptions.ensure("a", candidate())).subscription;
    const ended = (await subscriptions.ensure("b", candidate({ caller: null }))).subscription;
    await subscriptions.update(ended.id, { endedAt: Date.now(), reason: "abandoned" });

    const naming = await subscriptions.forType("tech.rowing.worker-protocol.task-raised");
    expect(naming.map((one) => one.id)).toEqual([live.id]);
    expect((await subscriptions.list(null)).map((one) => one.id)).toEqual([ended.id]);
    // SUB-15: an ended one is not found by its key, so subscribing again creates a new one.
    expect(await subscriptions.find("b")).toBeUndefined();
  });

  it("clears a member a patch names as undefined, which JSON alone cannot say", async () => {
    const subscriptions = store();
    const { subscription } = await subscriptions.ensure("k", candidate());
    await subscriptions.update(subscription.id, { failingSince: 1 });
    await subscriptions.update(subscription.id, { failingSince: undefined, lastDeliveredAt: 2 });
    const held = await subscriptions.get(subscription.id);
    expect(held).not.toHaveProperty("failingSince");
    expect(held?.lastDeliveredAt).toBe(2);

    await subscriptions.remove(subscription.id);
    expect(await subscriptions.get(subscription.id)).toBeUndefined();
  });
});

describe("withSubscriptions, asked what a live subscription would receive", () => {
  it("answers synchronously, inside the object, with the hub's own envelope", async () => {
    const stub = whole();
    await durableSubscriptions(stub).ensure("key", candidate());
    // Inside the object and with no await between: what a write in `changing()` can call.
    const answer = await runInDurableObject(stub, (object) =>
      object.wantedHere("tech.rowing.fleet.tracker", [
        {
          type: "tech.rowing.worker-protocol.task-raised",
          subject: "t-1",
          data: {},
          extensions: { tasktype: "a" },
        },
        { type: "tech.rowing.worker-protocol.task-raised", subject: "x-1", data: {} },
        { type: "tech.rowing.fleet.nobody-subscribed", data: {} },
      ]),
    );
    expect(answer).toEqual([true, false, false]);
  });
});

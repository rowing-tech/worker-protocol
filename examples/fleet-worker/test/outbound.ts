import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { OutboxEvent } from "@worker-protocol/cloudflare";
import type { Env } from "../src/env.ts";
import type { Fleet } from "../src/fleet.ts";

/** A Queue that keeps what it is sent, and refuses everything while `failing`. */
export const fakeQueue = <T>() => {
  const state = {
    sent: [] as T[],
    /** The delay each `send` asked for, in the order sent; `undefined` where it asked none. */
    delays: [] as (number | undefined)[],
    failing: false,
  };
  const refuse = () => {
    if (state.failing) throw new Error("The Queue is down.");
  };
  const queue = {
    send: async (body: T, options?: { delaySeconds?: number }) => {
      refuse();
      state.sent.push(body);
      state.delays.push(options?.delaySeconds);
    },
    sendBatch: async (messages: Iterable<{ body: T }>) => {
      refuse();
      for (const message of messages) state.sent.push(message.body);
    },
  } as unknown as Queue<T>;
  return { state, queue };
};

/**
 * The object's events Queue, swapped for a fake that keeps what it is sent.
 *
 * `withOutbox` resolves its Queue from `env` on every flush, as its options say, so replacing `env`
 * on the live instance is the whole of the swap. The pool runs the object in the test's own
 * isolate, which is what lets a test read what the object sent. Everything else the object does is
 * the real thing.
 */
export async function captureEvents(stub: DurableObjectStub<Fleet>) {
  const { state, queue } = fakeQueue<OutboxEvent>();
  const EVENTS: Env["EVENTS"] = queue;
  await runInDurableObject(stub, (instance) => {
    Object.defineProperty(instance, "env", { value: { ...env, EVENTS }, configurable: true });
  });
  return state;
}

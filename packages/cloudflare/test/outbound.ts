import { env } from "cloudflare:workers";
import type { OutboxEvent } from "../src/index.ts";

/**
 * What the test Worker and its tests share, in a module of its own because the entrypoint may
 * export only handlers and Durable Object classes. Both run in the one isolate the pool gives this
 * suite, which is what lets a test read what an object sent.
 */

/** The one event type the test objects raise. */
export const TYPE = "tech.rowing.fleet.thing-changed";

/** An object of each shape, of the calling test's own. */
export const whole = () => env.WHOLE.get(env.WHOLE.newUniqueId());
export const shard = () => env.SHARD.get(env.SHARD.newUniqueId());
export const clock = () => env.CLOCK.get(env.CLOCK.newUniqueId());

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

/** Where every object in this suite flushes to. */
export const outbound = fakeQueue<OutboxEvent>();

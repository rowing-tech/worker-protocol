import type { CloudEvent, Delivery, DeliveryQueue, eventHub, GaveUp } from "@worker-protocol/hono";
import { asJson, BATCH } from "./durable.ts";
import type { LogRow } from "./logs.ts";
import type { OutboxEvent } from "./outbox.ts";

/**
 * The two Queues between an outbox and a sink, and the one handler that consumes both.
 *
 * **Events, then deliveries.** Every object's `flush()` sends its events to the events Queue. Its
 * consumer publishes each batch through the hub — the subscriptions are read once per type for the
 * whole batch, from the one object that holds them — and leaves one delivery per matching
 * subscription on the deliveries Queue, whose consumer makes the attempt. Fanning out from each
 * object instead would make a run that touches thousands of them thousands of calls to that one
 * object, and an outage of it would leave every outbox retrying; here the events wait in a Queue.
 *
 * **What is given up stays visible.** A delivery `deliver()` gives up on, and an event of a type the
 * Worker does not declare, go to the dead-letter queue with the reason, to be inspected and never
 * redriven, and — where the Worker keeps logs — a record names each for an operator who reads the
 * Worker through the protocol rather than through the Cloudflare account. A message the platform
 * drops after `max_retries` reaches the same queue, as it was sent and untagged, when
 * `wrangler.jsonc` names it as each consumer's `dead_letter_queue`: the only thing that sees those.
 */

type Hub = ReturnType<typeof eventHub>;

/** A Queue's own retry when nothing more specific was decided: ten seconds, doubling to an hour. */
const backoff = (attempts: number): number => Math.min(10 * 2 ** Math.max(attempts - 1, 0), 3600);

/**
 * `subscriptions.queue` for `mount()` and `eventHub()`: the deliveries Queue, in batches where the
 * hub has several. The chunks are independent — the Queue promises no order — so they go together.
 */
export const deliveryQueue = (queue: Queue<Delivery>): DeliveryQueue => ({
  send: async (delivery) => {
    await queue.send(delivery, { contentType: "json" });
  },
  sendBatch: async (deliveries) => {
    const chunks: Delivery[][] = [];
    for (let at = 0; at < deliveries.length; at += BATCH) {
      chunks.push(deliveries.slice(at, at + BATCH));
    }
    await Promise.all(chunks.map((chunk) => queue.sendBatch(asJson(chunk))));
  },
});

/**
 * What the consumer sets aside in the dead-letter queue, tagged by what it is: a delivery given up,
 * with why, or an event of a type the Worker does not declare (EVT-12) — a mistake in the Worker's
 * own code, which no retry would mend.
 */
export type GivenUp =
  | { kind: "delivery"; delivery: Delivery; gaveUp: GaveUp }
  | { kind: "event"; event: OutboxEvent; reason: "undeclared" };

export type QueuesConfig<E> = {
  /** The Queue names, as `wrangler.jsonc` gives them: how the handler tells the two batches apart. */
  queues: { events: string; deliveries: string };
  /** The hub, built from the same declaration `mount()` serves. */
  hub: (env: E) => Hub;
  /** Where what is given up is kept for somebody to inspect. */
  deadLetter: (env: E) => Queue<GivenUp>;
  /**
   * EVT-13: one attempt at the broker, where the Worker declares one; `false` is a broker that did
   * not take the event. Called after the subscribers, so a broker that is down costs them a repeat
   * under the same id, which they discard, and never a loss.
   */
  broker?: (asked: { event: CloudEvent; env: E }) => Promise<boolean>;
  /** LOG-2: where the records of what was given up are written, where the Worker keeps logs. */
  record?: (asked: { rows: LogRow[]; env: E }) => Promise<void>;
};

/** The `queue` handler of a Worker's default export, for both Queues. */
export function consumeQueues<E>(config: QueuesConfig<E>) {
  /** Sets one message's body aside, notes why, and settles it; retried if the queue refuses. */
  const setAside = async (given: {
    message: Message<unknown>;
    kept: GivenUp;
    deadLetter: Queue<GivenUp>;
    row: LogRow;
    rows: LogRow[];
  }) => {
    try {
      await given.deadLetter.send(given.kept, { contentType: "json" });
      given.rows.push(given.row);
      given.message.ack();
    } catch {
      given.message.retry({ delaySeconds: backoff(given.message.attempts) });
    }
  };

  /** The records of one batch, in one write. The dead-letter queue already holds every one. */
  const record = async (rows: LogRow[], env: E) => {
    if (rows.length === 0 || config.record === undefined) return;
    try {
      await config.record({ rows, env });
    } catch {
      // The record is the courtesy copy; the dead-letter queue is the one that is kept.
    }
  };

  async function events(batch: MessageBatch<OutboxEvent>, env: E): Promise<void> {
    const hub = config.hub(env);
    const deadLetter = config.deadLetter(env);
    const rows: LogRow[] = [];

    // EVT-12, asked first: an event the Worker does not declare can never be published, so it is
    // set aside at once rather than failing the batch beside it a hundred times over.
    const declared = batch.messages.filter((message) => hub.declares(message.body.type));
    const undeclared = batch.messages.filter((message) => !hub.declares(message.body.type));
    await Promise.all(
      undeclared.map((message) =>
        setAside({
          message,
          kept: { kind: "event", event: message.body, reason: "undeclared" },
          deadLetter,
          rows,
          row: {
            at: Date.now(),
            level: "error",
            message: "an event of a type this Worker does not declare was set aside",
            fields: { event: message.body.id, type: message.body.type },
          },
        }),
      ),
    );

    let published: CloudEvent[] | undefined;
    try {
      published =
        declared.length === 0 ? [] : await hub.publishAll(declared.map((message) => message.body));
    } catch {
      // The store or the deliveries Queue could not be reached. The batch is retried whole, once,
      // rather than event by event against the object that is already struggling; a delivery the
      // first attempt did queue is queued again under the same id, which a sink discards.
      for (const message of declared) message.retry({ delaySeconds: backoff(message.attempts) });
    }
    if (published !== undefined) {
      const sent = published;
      // Each event is settled on its own and the Queue promises no order, so the broker is asked
      // for all of them at once rather than one after another.
      await Promise.all(
        declared.map(async (message, at) => {
          const event = sent[at];
          const taken =
            event !== undefined &&
            (await (config.broker?.({ event, env }).catch(() => false) ?? true));
          if (taken) message.ack();
          else message.retry({ delaySeconds: backoff(message.attempts) });
        }),
      );
    }
    await record(rows, env);
  }

  async function deliveries(batch: MessageBatch<Delivery>, env: E): Promise<void> {
    const hub = config.hub(env);
    const deadLetter = config.deadLetter(env);
    const rows: LogRow[] = [];
    await Promise.all(
      batch.messages.map(async (message) => {
        const delivery = message.body;
        try {
          // `attempts` is the Queue's own count, and the one `deliver` backs off by.
          const outcome = await hub.deliver({ ...delivery, attempt: message.attempts });
          if ("retryAfterSeconds" in outcome) {
            message.retry({ delaySeconds: outcome.retryAfterSeconds });
            return;
          }
          if (outcome.gaveUp === undefined) {
            message.ack();
            return;
          }
          const { reason, status } = outcome.gaveUp;
          await setAside({
            message,
            kept: { kind: "delivery", delivery, gaveUp: outcome.gaveUp },
            deadLetter,
            rows,
            row: {
              at: Date.now(),
              level: "warn",
              message: "a delivery was given up",
              fields: {
                subscription: delivery.subscription,
                event: delivery.event.id,
                type: delivery.event.type,
                reason,
                ...(status === null ? {} : { status }),
              },
            },
          });
        } catch {
          // The store could not be reached: nothing was settled.
          message.retry({ delaySeconds: backoff(message.attempts) });
        }
      }),
    );
    await record(rows, env);
  }

  return async (batch: MessageBatch<unknown>, env: E): Promise<void> => {
    // The two bodies differ, and the Queue's name is what says which this batch carries.
    if (batch.queue === config.queues.events) {
      await events(batch as MessageBatch<OutboxEvent>, env);
    } else if (batch.queue === config.queues.deliveries) {
      await deliveries(batch as MessageBatch<Delivery>, env);
    } else {
      throw new Error(`consumeQueues: ${batch.queue} is neither of the Queues it was given.`);
    }
  };
}

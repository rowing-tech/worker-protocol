import {
  action,
  type CloudEvent,
  type Delivery,
  defineWorker,
  eventHub,
  LEVELS,
  LIFECYCLE,
  mount,
  type OpenTask,
  type OutcomeStore,
  type Publishable,
  type StoredSubscription,
  type SubscriptionFacts,
  type SubscriptionStore,
  type Worker,
} from "@worker-protocol/hono";
import * as z from "zod";
import type { Env } from "./env.ts";
import {
  type Fleet,
  fleetOf,
  type LogRow,
  QUIET_AFTER_MS,
  QUIET_VEHICLE,
  quietTask,
  type Reading,
} from "./fleet.ts";

/**
 * A Worker on Cloudflare whose Facts live in a Durable Object.
 *
 * It is the shape `examples/minimal-worker` has, with its `Map`s replaced by a store that outlives
 * the request — which is the whole point of it existing beside that one. Everything the protocol
 * fixes is still `mount()`'s; what changed is only where this Worker keeps what it knows.
 *
 * The domain is a fleet, simplified from a telemetry worker that polls a GPS provider: a cron
 * records what the source last said about each vehicle, a vehicle that has not reported for a while
 * is *quiet*, a quiet vehicle is a Task for whoever can go and look, and each crossing into quiet
 * is an event somebody else may want — on a broker, and pushed to whoever subscribed. The provider
 * is stubbed, because what is being demonstrated is the protocol's side and not SOAP.
 */

/** DESC-6: the Worker's own id, which is not the URL it is served from, and every event's source. */
const ID = "tech.rowing.fleet.tracker";

/** HLTH-3 and ALRT-2 both turn on this one number, so it is written once. */
const BACKED_UP = 20;

/**
 * ENDP-16's store, over the durable object.
 *
 * Three calls that each land on one of its methods, which is what makes the reservation safe: a
 * durable object holds incoming events while a storage operation is outstanding, so nothing
 * interleaves between finding the key free and taking it. This is the first implementation in this
 * repository that is not a `Map`, and it is four lines, which is the claim the interface was making.
 */
const durableOutcomes = (fleet: DurableObjectStub<Fleet>): OutcomeStore => {
  return {
    begin: (key, until) => fleet.beginOutcome(key, until),
    complete: (key, held) => fleet.completeOutcome(key, held),
    release: (key) => fleet.releaseOutcome(key),
  };
};

/**
 * SUB-7's store, over the same durable object, on `durableOutcomes`'s terms: each call lands on one
 * method, and `ensure` is one method because SUB-7 needs the read and the write to be one step.
 *
 * Longer than that one only because a subscription crosses the RPC boundary as JSON — its filters
 * nest, and `fleet.ts` says why that costs a string. The parsing is all that is here.
 */
const durableSubscriptions = (fleet: DurableObjectStub<Fleet>): SubscriptionStore => {
  const read = (record: string | null) =>
    record === null ? undefined : (JSON.parse(record) as StoredSubscription);
  const readAll = (records: string[]) =>
    records.map((one) => JSON.parse(one) as StoredSubscription);
  return {
    find: async (key) => read(await fleet.findSubscription(key)),
    ensure: async (key, candidate) => {
      const { record, created } = await fleet.ensureSubscription(key, JSON.stringify(candidate));
      return { subscription: JSON.parse(record) as StoredSubscription, created };
    },
    get: async (id) => read(await fleet.getSubscription(id)),
    list: async (caller) => readAll(await fleet.subscriptionsOf(caller)),
    forType: async (type) => readAll(await fleet.subscriptionsFor(type)),
    // `undefined` names a member to clear, and JSON drops it — so the cleared ones go by name.
    update: (id, patch) =>
      fleet.updateSubscription(id, {
        set: JSON.stringify(patch),
        clear: Object.entries(patch)
          .filter(([, value]) => value === undefined)
          .map(([name]) => name),
      }),
    remove: (id) => fleet.removeSubscription(id),
  };
};

/** A comma-separated variable as a list, with the empty entries a trailing comma leaves dropped. */
const listed = (value: string | undefined) =>
  (value ?? "").split(",").filter((one) => one.length > 0);

/** SUB-1. How long a sink may fail without interruption before its subscription ends: a day. */
const ABANDON_AFTER_SECONDS = 86_400;

/**
 * What `subscriptions` needs from Cloudflare: the durable object as the store and a Queue as the
 * carrier. A Queue already retries with a delay, which is the whole of what `DeliveryQueue` asks;
 * the wrapper is here only because `send` answers a receipt nobody reads.
 */
const subscriptionsOf = (env: Env): SubscriptionFacts => ({
  abandonAfterSeconds: ABANDON_AFTER_SECONDS,
  store: durableSubscriptions(fleetOf(env)),
  queue: {
    send: async (delivery) => {
      await env.DELIVERIES.send(delivery);
    },
  },
  // Empty in a deployment, which is the point: `env.ts` says where this is set and where it is not.
  insecureSinkOrigins: listed(env.DEV_SINK_ORIGINS),
});

/**
 * EVT-13: the broker, the layout of the envelope, and WHERE on that broker these land. The keys of
 * `destination` are this Worker's own and nothing in the protocol parses them.
 *
 * A module constant rather than a member written inside the builder, because two things read it:
 * `mount()`, which writes the Descriptor from it, and `eventHub()`, which publishes by it. One
 * declaration is the only way the two cannot disagree about what this Worker publishes.
 */
const EVENTS = {
  broker: "kafka",
  protocolBinding: "cloudevents/kafka-1.0",
  destination: { bootstrapServers: "kafka.rowing.invalid:9092", topic: "fleet.telemetry" },
  publishes: {
    "tech.rowing.fleet.vehicle-went-quiet": {
      data: z.object({ vehicle: z.string(), since: z.string() }),
    },
    // EVT-15: the specification's names and shapes, narrowed to the one Task type this Worker
    // raises — so a subscriber reading the Descriptor knows what `payload` holds.
    [LIFECYCLE.taskRaised]: {
      data: z.object({
        id: z.string(),
        type: z.literal(QUIET_VEHICLE),
        payload: z.object({ vehicle: z.string() }),
        since: z.string(),
      }),
    },
    [LIFECYCLE.taskEnded]: {
      data: z.object({ id: z.string(), type: z.literal(QUIET_VEHICLE) }),
    },
  },
  // EVT-8: what a consumer sizes its deduplication store against, and what bounds a retry.
  republishWindowSeconds: 3600,
} satisfies NonNullable<Worker["events"]>;

/**
 * The push, built from the declaration `mount()` serves: the id is every event's `source`, and the
 * `events` entry is what may be published and how long a delivery may be retried.
 */
const hubOf = (env: Env) =>
  eventHub({ id: ID, events: EVENTS, subscriptions: subscriptionsOf(env) });

export const fleetWorker = defineWorker<Env>((env) => {
  const fleet = fleetOf(env);

  return {
    id: ID,

    // REG-3, REG-34. It may await, and a Worker reading a token from an identity provider would.
    authenticate: (token) => (token === env.CREDENTIAL ? "accepted" : "unauthenticated"),

    // HLTH-2: one status and named checks. HLTH-3 forbids `healthy` while a check is not, so the
    // outbox backing up takes the whole Worker to `degraded` and says which check said so.
    health: async () => {
      const { depth } = await fleet.outbox();
      const status = depth > BACKED_UP ? ("degraded" as const) : ("healthy" as const);
      return {
        status,
        checks: { outbox: { status, detail: `${depth} events waiting for the broker` } },
      };
    },

    // MET-21 to MET-6. Both are additive, so `mount()` may be asked for a day and this sums the
    // hours it keeps — which is what declaring `additive` is for and why a reader never assumes it.
    metrics: {
      timeZone: "America/Mexico_City",
      publishes: {
        "readings-ingested": {
          unit: "readings",
          additive: true,
          granularities: ["hour", "day"],
          dimensions: {},
        },
        "vehicles-quiet": {
          unit: "vehicles",
          additive: true,
          granularities: ["hour", "day"],
          dimensions: {},
        },
      },
      read: async ({ metric, buckets }) => {
        const values = await fleet.counters(
          metric,
          buckets.map((bucket) => ({ start: bucket.start.getTime(), end: bucket.end.getTime() })),
        );
        // MET-15: a bucket this Worker accumulated nothing in is ABSENT, and never a zero — a
        // reader told nought would believe something was counted and that it came to none.
        return buckets
          .map((bucket, i) => ({ start: bucket.start, value: values[i] }))
          .filter((sample) => sample.value > 0);
      },
    },

    actions: {
      // ENDP-16: over the durable object, so a retry that reaches another isolate finds what the
      // first recorded. A `Map` here would have been one per isolate and the Action would run twice.
      outcomes: durableOutcomes(fleet),
      accepts: {
        "record-inspection": action({
          input: z.object({ vehicle: z.string().min(1), reachable: z.boolean() }),
          result: z.object({ recordedAt: z.string() }),
          idempotency: { required: true, from: "header", windowSeconds: 3600 },
          run: async ({ vehicle }) => {
            await fleet.inspect(vehicle, Date.now());
            return { recordedAt: new Date().toISOString() };
          },
        }),
        "run-cycle": action({
          input: z.object({}),
          result: z.object({ readings: z.number(), published: z.number() }),
          run: () => cycle(env),
        }),
      },
    },

    // ALRT-2, ALRT-3: a condition an operator should see, while it holds.
    alerts: async () => {
      const { depth, oldestAt } = await fleet.outbox();
      return depth > BACKED_UP && oldestAt !== undefined
        ? [
            {
              id: "outbox-backed-up",
              severity: "warning" as const,
              // ALRT-3: when the condition began, which is when the oldest event was raised.
              since: new Date(oldestAt),
              summary: `${depth} events have not reached the broker.`,
              actions: [],
            },
          ]
        : [];
    },

    tasks: {
      raises: {
        [QUIET_VEHICLE]: {
          // A Zod object, as an Action's input is; `mount()` writes the JSON Schema.
          payload: z.object({ vehicle: z.string() }),
          answeredBy: "record-inspection",
        },
      },
      // TASK-15: the condition, read from the store rather than derived from a Map in a process.
      current: async (): Promise<OpenTask[]> =>
        (await fleet.quiet(Date.now(), QUIET_AFTER_MS)).map(quietTask),
    },

    events: EVENTS,

    // SUB-1 to SUB-17: who subscribed, kept in the durable object, and a Queue to carry each push.
    // `mount()` serves the address; `cycle` publishes and `queue` below delivers.
    subscriptions: subscriptionsOf(env),

    // LOG-2: what this Worker recorded while it was working, read from the durable object. A buffer
    // in the isolate would pass every local test and be wrong in production, because a read can
    // land somewhere that never saw the write. `mount()` decodes the query; this is the store.
    logs: {
      // ENDP-19: the cap this Worker holds a page to, handed on as `limit`.
      pageSize: 50,
      read: async ({ levels, from, to, cursor, limit }) => {
        const page = await fleet.logs({
          // LOG-7's floor: the levels arrive in order, so the first is the lowest asked for.
          minRank: LEVELS.indexOf(levels[0] ?? "debug"),
          before: cursor === undefined ? null : Number(cursor),
          from: from?.getTime() ?? null,
          to: to?.getTime() ?? null,
          limit,
        });
        return {
          records: page.rows.map((row) => ({
            at: new Date(row.at),
            level: row.level,
            message: row.message,
            ...(row.fields === undefined ? {} : { fields: row.fields }),
          })),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        };
      },
    },
  };
});

/**
 * One cycle: read what the source says, record it, and drain what is waiting to be published.
 *
 * The provider is a stub and the broker is a stub, which is the honest limit of an example in this
 * repository: EVT-1 is about an envelope on a broker nothing here names, so there is nothing to
 * publish to. The subscribers are real — each delivery is a message on a Cloudflare Queue. What is
 * real either way is the shape: an outbox that survives a failed publish, because a Fact that was
 * true does not stop being true because a broker was down.
 */
export async function cycle(
  env: Env,
  publish: Publish = reachBroker,
): Promise<{ readings: number; published: number }> {
  const fleet = fleetOf(env);
  const hub = hubOf(env);
  const now = Date.now();

  const readings: Reading[] = listed(env.SOURCE_VEHICLES).map((vehicle) => ({ vehicle, at: now }));
  const ingested = await fleet.ingest(readings, now, QUIET_AFTER_MS);

  const waiting = await fleet.pending();
  const gone: string[] = [];
  /** LOG-2. What this cycle is worth saying, written to the store in one call at the end. */
  const lines: LogRow[] = [];
  for (const row of waiting) {
    const raised = JSON.parse(row.event) as Publishable;
    // EVT-1: one CloudEvents 1.0 event, built once by the hub under the row's own id and instant.
    // What the broker is handed is what the subscribers are, and a row published again after a
    // failure below is the same event to everyone who already has it (EVT-8) — which is why the
    // subscribers go first: a broker that is down costs them a repeat they discard, never a loss.
    let event: CloudEvent;
    try {
      event = await hub.publish({ ...raised, id: row.id, time: row.at });
    } catch (error) {
      lines.push({
        at: Date.now(),
        level: "warn",
        message: "an event could not be handed to its subscribers",
        fields: {
          id: row.id,
          type: raised.type,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      break; // In order, and no further: the next cycle starts where this stopped.
    }
    if (!(await publish(event))) {
      lines.push({
        at: Date.now(),
        level: "warn",
        message: "the broker did not take an event",
        fields: { id: row.id, type: raised.type },
      });
      break;
    }
    gone.push(row.id);
  }
  if (gone.length > 0) await fleet.published(gone);

  // LOG-2: the records, written on purpose and in one call. This is the whole of what a Worker
  // does for this Capability — it decides what is worth a line and where that line is kept. There
  // is no `console` patched behind its back, which is what keeps a record attributable to the work
  // that produced it rather than to whichever isolate happened to be running.
  lines.push({
    at: Date.now(),
    level: "info",
    message: "cycle complete",
    fields: { readings: ingested, published: gone.length, waiting: waiting.length },
  });
  await fleet.record(lines);
  return { readings: ingested, published: gone.length };
}

/** One attempt at the broker. `false` is a broker that did not take it, not an event that was bad. */
export type Publish = (event: CloudEvent) => Promise<boolean>;

/**
 * Where a real one would reach the broker `events.destination` names.
 *
 * It is a parameter of `cycle` with this as its default rather than a module variable a test
 * reassigns, because a test that has to mutate the module under test is a test that can only run
 * once and never beside another.
 */
const reachBroker: Publish = async () => true;

const app = mount(fleetWorker);

/**
 * Cloudflare resolves a durable object binding against the classes its ENTRYPOINT module exports,
 * so this one has to be named here even though nothing in this file calls it. It is the platform's
 * requirement and not a convenience: `wrangler.jsonc` binds `FLEET` to the class name `Fleet`, and
 * a class the entrypoint does not export is a name the runtime cannot find.
 */
export { Fleet } from "./fleet.ts";

export default {
  fetch: app.fetch,
  /** The cron in `wrangler.jsonc`. A Worker finds work on a schedule, which is what makes it one. */
  scheduled: async (_controller: unknown, env: Env) => {
    await cycle(env);
  },
  /**
   * SUB-12: the deliveries, one message each. The hub decides and the Queue carries the decision —
   * a delay before the next attempt, or done. `attempts` is the Queue's own count, and the one
   * `deliver` backs off by, so nothing here keeps a second.
   */
  queue: async (batch: MessageBatch<Delivery>, env: Env) => {
    const hub = hubOf(env);
    await Promise.all(
      batch.messages.map(async (message) => {
        try {
          const outcome = await hub.deliver({ ...message.body, attempt: message.attempts });
          if ("retryAfterSeconds" in outcome) {
            message.retry({ delaySeconds: outcome.retryAfterSeconds });
          } else {
            message.ack();
          }
        } catch {
          // The durable object could not be reached, so nothing was decided: still owed.
          message.retry();
        }
      }),
    );
  },
};

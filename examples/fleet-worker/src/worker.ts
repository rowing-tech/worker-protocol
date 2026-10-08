import {
  consumeQueues,
  deliveryQueue,
  durableLogs,
  durableOutcomes,
  durableSubscriptions,
} from "@worker-protocol/cloudflare";
import {
  action,
  defineWorker,
  eventHub,
  LIFECYCLE,
  mount,
  type OpenTask,
  type SubscriptionFacts,
  type Worker,
} from "@worker-protocol/hono";
import * as z from "zod";
import type { Env } from "./env.ts";
import { fleetOf, QUIET_VEHICLE, quietAfterMs, quietTask, type Reading } from "./fleet.ts";

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

/** A comma-separated variable as a list, with the empty entries a trailing comma leaves dropped. */
const listed = (value: string | undefined) =>
  (value ?? "").split(",").filter((one) => one.length > 0);

/** SUB-1. How long a sink may fail without interruption before its subscription ends: a day. */
const ABANDON_AFTER_SECONDS = 86_400;

/**
 * What `subscriptions` needs from Cloudflare: the durable object as the store and a Queue as the
 * carrier, both from `@worker-protocol/cloudflare`.
 */
const subscriptionsOf = (env: Env): SubscriptionFacts => ({
  abandonAfterSeconds: ABANDON_AFTER_SECONDS,
  store: durableSubscriptions(fleetOf(env)),
  queue: deliveryQueue(env.DELIVERIES),
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
        checks: { outbox: { status, detail: `${depth} events waiting to be published` } },
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
      return depth > BACKED_UP && oldestAt !== null
        ? [
            {
              id: "outbox-backed-up",
              severity: "warning" as const,
              // ALRT-3: when the condition began, which is when the oldest event was raised.
              since: new Date(oldestAt),
              summary: `${depth} events have not left the outbox.`,
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
          answeredBy: ["record-inspection"],
        },
      },
      // TASK-15: the condition, read from the store rather than derived from a Map in a process.
      current: async (): Promise<OpenTask[]> =>
        (await fleet.quiet(Date.now(), quietAfterMs(env))).map(quietTask),
    },

    events: EVENTS,

    // SUB-1 to SUB-17: who subscribed, kept in the durable object, and a Queue to carry each push.
    // `mount()` serves the address; the object's outbox publishes and `queue` below delivers.
    subscriptions: subscriptionsOf(env),

    // LOG-2: what this Worker recorded while it was working, read from the durable object. A buffer
    // in the isolate would pass every local test and be wrong in production, because a read can
    // land somewhere that never saw the write. `mount()` decodes the query; this is the store.
    // ENDP-19: the cap this Worker holds a page to, handed on as `limit`.
    logs: durableLogs(fleet, { pageSize: 50 }),
  };
});

/**
 * One cycle: read what the source says, and record it.
 *
 * The provider is a stub, which is the honest limit of an example in this repository. Publishing is
 * not this function's any more: `ingest` enqueues what the readings raised in the same transaction
 * as the readings, and sends it before it returns. What the events Queue does not take, the object's
 * alarm sends later; what is published, `queue` below fans out.
 */
export async function cycle(env: Env): Promise<{ readings: number; published: number }> {
  const fleet = fleetOf(env);
  const now = Date.now();
  const readings: Reading[] = listed(env.SOURCE_VEHICLES).map((vehicle) => ({ vehicle, at: now }));
  const published = await fleet.ingest(readings, now, quietAfterMs(env));

  // LOG-2: the record, written on purpose and in one call. This is the whole of what a Worker does
  // for this Capability — it decides what is worth a line and where that line is kept. There is no
  // `console` patched behind its back, which is what keeps a record attributable to the work that
  // produced it rather than to whichever isolate happened to be running.
  await fleet.record([
    {
      at: Date.now(),
      level: "info",
      message: "cycle complete",
      fields: { readings: readings.length, published },
    },
  ]);
  return { readings: readings.length, published };
}

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
   * Both Queues in `wrangler.jsonc`. On `fleet-events`, each batch is published to the subscribers
   * it matches and then to the broker; on `fleet-deliveries`, each delivery is attempted and the
   * hub's decision handed back to the Queue. What is given up goes to `fleet-dead`, and a `warn`
   * record of it to `/logs`.
   */
  queue: consumeQueues<Env>({
    queues: { events: "fleet-events", deliveries: "fleet-deliveries" },
    hub: hubOf,
    deadLetter: (env) => env.DEAD,
    // EVT-13: a stub. The broker `events.destination` names is not reached from an example, so
    // every event is taken; a real one answers `false` when it did not take it.
    broker: async () => true,
    record: ({ rows, env }) => fleetOf(env).record(rows),
  }),
};

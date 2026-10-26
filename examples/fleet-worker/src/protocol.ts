import {
  deliveryQueue,
  durableGrants,
  durableLogs,
  durableOutcomes,
  durableSubscriptions,
  type GrantsRpc,
  type SubscriptionsRpc,
} from "@worker-protocol/cloudflare";
import {
  action,
  eventHub,
  LIFECYCLE,
  type OpenTask,
  type SubscriptionFacts,
  type Worker,
} from "@worker-protocol/hono";
import * as z from "zod";
import { configFromEnv } from "./config.ts";
import type { Env } from "./env.ts";
import type { Fleet } from "./fleet.ts";
import { QUIET_VEHICLE, quietAfterMs, quietTask, vehicleOf } from "./quiet.ts";

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
 * carrier, both from `@worker-protocol/cloudflare`. The object is a stub from a Worker in front of
 * it, or itself from inside.
 */
const subscriptionsOver = (fleet: SubscriptionsRpc, env: Env): SubscriptionFacts => ({
  abandonAfterSeconds: ABANDON_AFTER_SECONDS,
  store: durableSubscriptions(fleet),
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
export const EVENTS = {
  broker: "kafka",
  protocolBinding: "cloudevents/kafka-1.0",
  destination: { bootstrapServers: "kafka.rowing.invalid:9092", topic: "fleet.telemetry" },
  publishes: {
    "tech.rowing.fleet.vehicle-went-quiet": {
      data: z.object({ vehicle: z.string(), since: z.string() }),
    },
    // EVT-15: the specification's names and shapes, narrowed to the one Task type this Worker
    // raises — so a subscriber reading the Descriptor knows what `payload` holds. EVT-17: the
    // `tasktype` a subscriber filters them by, which can only ever be that one type.
    [LIFECYCLE.taskRaised]: {
      data: z.object({
        id: z.string(),
        type: z.literal(QUIET_VEHICLE),
        payload: z.object({ vehicle: z.string() }),
        since: z.string(),
      }),
      extensions: { tasktype: z.literal(QUIET_VEHICLE) },
    },
    [LIFECYCLE.taskEnded]: {
      data: z.object({ id: z.string(), type: z.literal(QUIET_VEHICLE) }),
      extensions: { tasktype: z.literal(QUIET_VEHICLE) },
    },
    // EVT-20: an inspection on a call that named the Task it answers. Narrowed the same way, and
    // to the one Action that answers it.
    [LIFECYCLE.taskAnswered]: {
      data: z.object({
        id: z.string(),
        type: z.literal(QUIET_VEHICLE),
        action: z.literal("record-inspection"),
      }),
      extensions: { tasktype: z.literal(QUIET_VEHICLE) },
    },
  },
  // EVT-8: what a consumer sizes its deduplication store against, and what bounds a retry.
  republishWindowSeconds: 3600,
} satisfies NonNullable<Worker["events"]>;

/**
 * The push, built from the declaration `mount()` serves: the id is every event's `source`, and the
 * `events` entry is what may be published and how long a delivery may be retried. The grants are
 * handed over too (GRANT-9): a subscription a Contract's credential made stops receiving from the
 * response that revokes or rotates its grant, and the hub asks the store before every delivery.
 */
export const hubOver = (fleet: SubscriptionsRpc & GrantsRpc, env: Env) =>
  eventHub({
    id: ID,
    events: EVENTS,
    subscriptions: subscriptionsOver(fleet, env),
    grants: { store: durableGrants(fleet) },
  });

/**
 * The Worker, declared over the object that keeps its Facts — and served from inside it.
 *
 * **Every call below is local, and that is why it is served there.** From a Worker in front of the
 * object each of them was a round trip: an Action reserved its key, read the Facts its refusal is
 * written on, performed, and recorded its outcome, four calls in a row. Measured on a deployed
 * Worker reached from another continent, each cost about 650 ms while the object worked for none of
 * it. Answered from the object's own `fetch`, they are SQLite calls, and a request pays the one
 * round trip that brought it here. `mount()` needs nothing for it: it answers wherever it is asked.
 */
export const fleetWorker = (fleet: Fleet, env: Env): Worker => {
  return {
    id: ID,

    // REG-3, REG-37. It may await, and a Worker reading a token from an identity provider would.
    // GRANT-2: accepting names WHO is calling, because a grant belongs to its applicant and an
    // applicant has to have a name. One static secret, so it names the one caller that secret is.
    authenticate: (token) =>
      token === env.CREDENTIAL ? { verdict: "accepted", caller: "operator" } : "unauthenticated",

    // HLTH-2: one status and named checks. HLTH-3 forbids `healthy` while a check is not, so the
    // outbox backing up takes the whole Worker to `degraded` and says which check said so — and a
    // configuration the cycle refuses takes it to `unhealthy`, because a cron that fails shows in
    // the platform's dashboard and nowhere a Tower reading this Worker looks.
    health: async () => {
      const { depth } = await fleet.outbox();
      const outbox = depth > BACKED_UP ? ("degraded" as const) : ("healthy" as const);
      const refused = (() => {
        try {
          configFromEnv(env);
          return undefined;
        } catch (thrown) {
          return thrown instanceof Error ? thrown.message : String(thrown);
        }
      })();
      return {
        status: refused !== undefined ? ("unhealthy" as const) : outbox,
        checks: {
          outbox: { status: outbox, detail: `${depth} events waiting to be published` },
          configuration:
            refused === undefined
              ? { status: "healthy" as const }
              : { status: "unhealthy" as const, detail: refused },
        },
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
          // `task` is the Task the call named in `Worker-Protocol-Task`, where it named one, and
          // what `task-answered` is published about (EVT-20).
          run: async ({ vehicle }, { name, task }) => {
            await fleet.inspect(
              vehicle,
              Date.now(),
              task === undefined ? undefined : { task, action: name },
            );
            return { recordedAt: new Date().toISOString() };
          },
        }),
        // What a source that pushes its readings would call, and what the cycle does with what
        // it polled. It takes the readings already read: the network is never awaited inside the
        // object this runs in (`source.ts`).
        "record-readings": action({
          input: z.object({
            readings: z
              .array(z.object({ vehicle: z.string().min(1), at: z.iso.datetime({ offset: true }) }))
              .min(1),
          }),
          result: z.object({ published: z.number() }),
          run: async ({ readings }) => ({
            published: await fleet.ingest(
              readings.map((one) => ({ vehicle: one.vehicle, at: Date.parse(one.at) })),
              Date.now(),
              quietAfterMs(env),
            ),
          }),
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
      // TASK-39: the Task a call names, by its id — two keys in the object rather than every
      // reading it holds, which is what an answer costs once the fleet is large. The id is the
      // one `quietTask` writes, and `vehicleOf` reads it back.
      find: async (id) => {
        const vehicle = vehicleOf(id);
        if (vehicle === undefined) return undefined;
        const one = await fleet.quietOne(vehicle, Date.now(), quietAfterMs(env));
        return one === null ? undefined : quietTask(one);
      },
    },

    events: EVENTS,

    // SUB-1 to SUB-17: who subscribed, kept in the durable object, and a Queue to carry each push.
    // `mount()` serves the address; the object's outbox publishes and `queue` below delivers.
    subscriptions: subscriptionsOver(fleet, env),

    // GRANT-1 to GRANT-9: what a Contract's credential covers here, kept in the durable object so
    // that applying compares and sets in one place (GRANT-5) and a credential issued in one isolate
    // is found by its digest in any other. `mount()` serves the address, mints each credential and
    // derives what one covers; who may apply is the one caller `authenticate` names.
    grants: { store: durableGrants(fleet), applicants: ({ caller }) => caller === "operator" },

    // LOG-2: what this Worker recorded while it was working, read from the durable object. A buffer
    // in the isolate would pass every local test and be wrong in production, because a read can
    // land somewhere that never saw the write. `mount()` decodes the query; this is the store.
    // ENDP-19: the cap this Worker holds a page to, handed on as `limit`.
    logs: durableLogs(fleet, { pageSize: 50 }),
  };
};

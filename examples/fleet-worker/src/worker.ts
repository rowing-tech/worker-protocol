import {
  defineWorker,
  mount,
  type OpenTask,
  type OutcomeStore,
  rfc3339,
} from "@worker-protocol/hono";
import * as z from "zod";
import type { Env } from "./env.ts";
import { type Fleet, fleetOf, QUIET_AFTER_MS, type Reading } from "./fleet.ts";

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
 * is an event somebody else may want. The provider is stubbed, because what is being demonstrated
 * is the protocol's side and not SOAP.
 */

const QUIET_VEHICLE = "tech.rowing.fleet.inspect-quiet-vehicle";

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

export const fleetWorker = defineWorker<Env>((env) => {
  const fleet = fleetOf(env);

  return {
    // DESC-6: the Worker's own id, which is not the URL it is served from.
    id: "tech.rowing.fleet.tracker",

    // REG-3, REG-21. It may await, and a Worker reading a token from an identity provider would.
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
        "record-inspection": {
          input: z.object({ vehicle: z.string().min(1), reachable: z.boolean() }),
          result: z.object({ recordedAt: z.string() }),
          idempotency: { required: true, from: "header", windowSeconds: 3600 },
          run: async ({ vehicle }: { vehicle: string }) => {
            await fleet.inspect(vehicle, Date.now());
            return { recordedAt: new Date().toISOString() };
          },
        },
        "run-cycle": {
          input: z.object({}),
          result: z.object({ readings: z.number(), published: z.number() }),
          run: () => cycle(env),
        },
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
          payload: {
            type: "object",
            properties: { vehicle: { type: "string" } },
            required: ["vehicle"],
          },
          answeredBy: ["record-inspection"],
        },
      },
      // TASK-15: the condition, read from the store rather than derived from a Map in a process.
      current: async (): Promise<OpenTask[]> =>
        (await fleet.quiet(Date.now(), QUIET_AFTER_MS)).map((one) => ({
          id: `quiet:${one.vehicle}`,
          type: QUIET_VEHICLE,
          payload: { vehicle: one.vehicle },
          since: new Date(one.since),
        })),
    },

    // EVT-11: the broker, the layout of the envelope, and WHERE on that broker these land. The
    // keys of `destination` are this Worker's own and nothing in the protocol parses them.
    events: {
      broker: "kafka",
      protocolBinding: "cloudevents/kafka-1.0",
      destination: { bootstrapServers: "kafka.rowing.invalid:9092", topic: "fleet.telemetry" },
      publishes: {
        "tech.rowing.fleet.vehicle-went-quiet": {
          data: {
            type: "object",
            properties: { vehicle: { type: "string" }, since: { type: "string" } },
            required: ["vehicle", "since"],
          },
        },
      },
      // EVT-8: what a consumer sizes its deduplication store against.
      republishWindowSeconds: 3600,
    },
  };
});

/**
 * One cycle: read what the source says, record it, and drain what is waiting for the broker.
 *
 * The provider is a stub and the publisher is a stub, which is the honest limit of an example in
 * this repository: EVT-1 is about an envelope on a broker nothing here names, so there is nothing
 * to publish to. What is real is the shape — an outbox that survives a failed publish, because a
 * Fact that was true does not stop being true because a broker was down.
 */
export async function cycle(
  env: Env,
  publish: Publish = reachBroker,
): Promise<{ readings: number; published: number }> {
  const fleet = fleetOf(env);
  const now = Date.now();

  const vehicles = (env.SOURCE_VEHICLES ?? "").split(",").filter((one) => one.length > 0);
  const readings: Reading[] = vehicles.map((vehicle) => ({ vehicle, at: now }));
  const ingested = await fleet.ingest(readings, now, QUIET_AFTER_MS);

  const waiting = await fleet.pending();
  const gone: string[] = [];
  for (const event of waiting) {
    // EVT-1: a CloudEvents 1.0 event, whose `source` is the Worker's id and whose `id` with it
    // identifies this event uniquely — which is what lets a consumer deduplicate a republish.
    const published = await publish({
      specversion: "1.0",
      id: event.id,
      source: "tech.rowing.fleet.tracker",
      type: event.type,
      time: rfc3339(event.at),
      data: event.data,
    });
    if (!published) break; // In order, and no further: the next cycle starts where this stopped.
    gone.push(event.id);
  }
  if (gone.length > 0) await fleet.published(gone);
  return { readings: ingested, published: gone.length };
}

/** One attempt at the broker. `false` is a broker that did not take it, not an event that was bad. */
export type Publish = (event: Record<string, unknown>) => Promise<boolean>;

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
};

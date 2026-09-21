/**
 * A conformant Worker that declares everything this protocol defines.
 *
 * **Copy this file.** Every line in it is domain — what this Worker is, what it knows how to do,
 * what it depends on, what it counts, what it does, which conditions hold, what it is working on,
 * what it publishes — and not one line is a rule. The addresses, the headers, the error envelope,
 * the page envelope with its cursor and its order, the bucket boundaries cut in a declared time
 * zone, the idempotency window: all of that is `mount()`'s, once, in `@worker-protocol/hono`.
 *
 * It declares all seven Capabilities, because seeing one written is worth more than reading that it
 * exists. A real Worker declares the ones it implements and leaves out the rest — DESC-2 admits any
 * combination including none, and a Worker that serves only a Descriptor is already enrolled,
 * catalogued and reachable.
 *
 * **It is written as a function of its environment, which is the form every platform admits.** A
 * Cloudflare Worker, a Vercel edge function and a Deno Deploy handler are handed their bindings and
 * secrets per request and have none at module scope; a Node or Bun process has them ambient and
 * loses nothing by being asked. Writing it the other way round works in one place and nowhere else.
 *
 * `pnpm dx:check` holds this file under a line count, and the number is what `packages/` is
 * claiming: that complying is cheap. When it grows, the question is which rule `mount()` failed to
 * carry — the budget moves only for lines that are genuinely a Worker's own.
 *
 * The domain is small and real: a Worker that watches a fleet, raises a Task when a vehicle goes
 * quiet, and closes it when somebody records a check.
 */

import {
  type Activity,
  defineWorker,
  memoryOutcomes,
  mount,
  type OpenTask,
} from "@worker-protocol/hono";
import * as z from "zod";

/** NAME-7: a name two parties who never spoke must match on is namespaced. */
const SILENT_VEHICLE = "tech.rowing.fleet.check-silent-vehicle";

/** What this Worker is deployed with. On Cloudflare these are bindings; on Node, `process.env`. */
export type Env = { CREDENTIAL?: string };

/** This Worker's own Facts. A real one reads them from the store its environment gives it. */
const silent = new Map<string, Date>([
  ["ABC-123", new Date(Date.now() - 3_600_000)],
  ["DEF-456", new Date(Date.now() - 7_200_000)],
]);
const checked = new Set<string>();
/** Task types somebody told us about, to read before the next scheduled sweep (ACT-17). */
const pending = new Set<string>();
let configuration = { label: "fleet watcher", quietAfterMinutes: 15 };

/**
 * ENDP-16: where a repeat under the same key finds the outcome already recorded.
 *
 * Built HERE and not inside the Worker below, which is answered on every request: a store built
 * there would be a new one each time and would forget what the last one recorded. On Cloudflare
 * this is a durable object, because a Map per isolate has the same problem one step out.
 */
const outcomes = memoryOutcomes();

export const fleetWorker = defineWorker<Env>((env) => ({
  // DESC-6: the Worker's own id, which is not the URL it is served from.
  id: "tech.rowing.fleet.watcher",

  // TASK-29: the Task types this Worker ANSWERS, which is its Skill — beside the id and not inside
  // `tasks`, because a Skill is served at no address. It is what the Tower catalogs this Worker by,
  // and it is how somebody else's quiet vehicle becomes this Worker's work.
  skills: [SILENT_VEHICLE],

  // REG-3, REG-21: what makes a credential good is this Worker's business, and nobody else's.
  authenticate: (token) => (token === env.CREDENTIAL ? "accepted" : "unauthenticated"),

  // HLTH-2: one status and a map of named checks. HLTH-3 forbids `healthy` while a check is not.
  health: () => ({
    status: silent.size > 100 ? "degraded" : "healthy",
    checks: { store: { status: "healthy", detail: `${silent.size} vehicles tracked` } },
  }),

  // MET-21 to MET-6: what this Worker publishes, and the calendar every boundary is cut in.
  metrics: {
    timeZone: "Europe/Madrid",
    publishes: {
      "vehicles-silent": {
        unit: "vehicles",
        additive: false,
        granularities: ["day"],
        dimensions: {},
      },
    },
    // The Worker answers how much, over buckets it did not have to compute (MET-12, MET-20).
    read: ({ buckets }) =>
      buckets.map((bucket) => ({
        start: bucket.start,
        value: [...silent.values()].filter((at) => at >= bucket.start && at < bucket.end).length,
      })),
  },

  // ACT-2: the input is a Zod object, and it is used twice — the Descriptor carries the JSON
  // Schema a console renders a form from, and a request is validated against the same object.
  actions: {
    outcomes,
    // ACT-15: `settings` READS the document, `configure` below WRITES it. Both exist because
    // ACT-14 replaces the whole document — without the read, a console would show an empty form
    // and everything the operator did not remember would go back to a default.
    settings: () => configuration,
    accepts: {
      "record-check": {
        input: z.object({ vehicle: z.string().min(1), reachable: z.boolean() }),
        result: z.object({ recordedAt: z.string() }),
        // ACT-12: performed once however many times it is posted, within the declared window.
        idempotency: { required: true, from: "header", windowSeconds: 3600 },
        run: ({ vehicle }: { vehicle: string }) => {
          checked.add(vehicle);
          return { recordedAt: new Date().toISOString() };
        },
      },
      // ACT-17: `nudge` is the other reserved name — a POST from a Worker that raised a Task of a
      // type this one answers, saying only that there is work of that type. It carries no Task and
      // no payload: the owner decides whether the condition still holds, so this reads rather than
      // trusts. Declaring it is optional; without it this Worker is told nothing and is read on its
      // own schedule, which is slower and never wrong.
      nudge: {
        input: z.object({ type: z.string() }),
        run: ({ type }: { type: string }) => {
          pending.add(type);
          return null;
        },
      },

      // ACT-13: `configure` is one of the two Action names this protocol reserves, and it takes the
      // whole document — an operator replaces the settings rather than patching them, so what they
      // saw in the form is what they send back.
      configure: {
        input: z.object({ label: z.string().min(1), quietAfterMinutes: z.number().int().min(1) }),
        run: (replacement: typeof configuration) => {
          configuration = replacement;
          return null;
        },
      },
    },
  },

  // ALRT-2, ALRT-3: conditions an operator should see, while they hold.
  alerts: () =>
    silent.size > 1
      ? [
          {
            id: "many-silent",
            severity: "warning" as const,
            since: new Date(Date.now() - 3_600_000),
            summary: `${silent.size} vehicles have gone quiet.`,
            actions: ["configure"],
          },
        ]
      : [],

  // ACTV-2: what this Worker is doing and has undertaken to do — the other direction from `tasks`.
  // A Task is work it needs from somebody else; an activity is work it has taken on itself.
  activity: (): Activity[] => [
    {
      id: "poll-source",
      state: "scheduled",
      // ACTV-3: when it undertook this, not when it will next run — that is scheduling, and this
      // protocol fixes none. The summary carries it for a person.
      since: new Date(Date.now() - 86_400_000),
      summary: `Poll the GPS source every ${configuration.quietAfterMinutes} minutes.`,
    },
    ...[...silent.keys()]
      .filter((vehicle) => !checked.has(vehicle))
      .map((vehicle) => ({
        id: `chase:${vehicle}`,
        state: "pending" as const,
        since: silent.get(vehicle) ?? new Date(),
        summary: `Waiting for ${vehicle} to report in.`,
      })),
  ],

  tasks: {
    // TASK-2: every Task type this Worker raises, with the Actions of its own that may answer one.
    raises: {
      [SILENT_VEHICLE]: {
        payload: { type: "object", properties: { vehicle: { type: "string" } } },
        answeredBy: ["record-check"],
      },
    },
    // TASK-15: the condition, and the whole of what this Worker owes. A Task exists while its
    // vehicle is quiet and unchecked, and it closes when that stops being true — which nobody
    // declares, and which is why `record-check` above needs to know nothing about Tasks.
    // TASK-28's `since` is the instant the condition began, not the instant this was asked.
    current: (): OpenTask[] =>
      [...silent.entries()]
        .filter(([vehicle]) => !checked.has(vehicle))
        .map(([vehicle, since]) => ({
          id: `silent:${vehicle}`,
          type: SILENT_VEHICLE,
          payload: { vehicle },
          since,
        })),
  },

  // EVT-11, EVT-12: the broker, how the attributes sit on it, where on it these land, and what
  // this Worker publishes. Nothing here parses any of the three — this protocol names no broker,
  // and an event travels over one rather than over the Worker API.
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
    // EVT-8: what a consumer sizes its deduplication store against. Declared, because `remember
    // forever` is not implementable and a consumer that forgot too early would process one twice.
    republishWindowSeconds: 3600,
  },
}));

/**
 * `mount()` serves the Descriptor and every Capability declared above, at addresses it fixes.
 *
 * `app.fetch` is what every platform wants: `export default { fetch: app.fetch }` on Cloudflare,
 * Vercel edge and Deno Deploy; `serve({ fetch: app.fetch })` on Node, Bun and Deno.
 */
export const app = mount(fleetWorker);

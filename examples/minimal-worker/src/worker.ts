/**
 * A conformant Worker that declares everything this protocol defines.
 *
 * **Copy this file.** Every line in it is domain — what this Worker is, what it knows how to do,
 * what it depends on, what it counts, what it does, which conditions hold, what it is working on,
 * what it publishes — and not one line is a rule. The addresses, the headers, the error envelope,
 * the page envelope with its cursor and its order, the bucket boundaries cut in a declared time
 * zone, the idempotency window: all of that is `mount()`'s, once, in `@worker-protocol/hono`.
 *
 * It declares all eight Capabilities, because seeing one written is worth more than reading that it
 * exists. A real Worker declares the ones it implements and leaves out the rest: any combination is
 * allowed, including none at all, and a Worker that serves only a Descriptor is already enrolled,
 * catalogued and reachable.
 *
 * **It is written as a function of its environment, which is the form every platform admits.** A
 * Cloudflare Worker, a Vercel edge function and a Deno Deploy handler are handed their bindings and
 * secrets per request and have none at module scope; a Node or Bun process has them ambient and
 * loses nothing by being asked. Writing it the other way round works in one place and nowhere else.
 *
 * `pnpm dx:check` counts the domain lines below — comments are free, so explaining itself costs it
 * nothing — and the ceiling sits far above where the file is. What the number is for is noticing
 * the day this stops being an example and becomes a small application; it is not a reason to show
 * less of the protocol, or to write it less clearly, than a reader came here for.
 *
 * The domain is small and real: a Worker that watches a fleet, raises a Task when a vehicle goes
 * quiet, and closes it when somebody records a check.
 */

import {
  type Activity,
  action,
  defineWorker,
  memoryOutcomes,
  mount,
  type OpenTask,
} from "@worker-protocol/hono";
import * as z from "zod";

// A name that two parties who never spoke have to match on is namespaced under a domain somebody
// owns, so that two teams naming the same idea do not collide and two teams naming different ideas
// do not look alike. These two are the whole of this Worker's relationship with work, and they
// point in opposite directions.

/** What this Worker NEEDS somebody to do: go and look at a vehicle that has gone quiet. */
const SILENT_VEHICLE = "tech.rowing.fleet.check-silent-vehicle";

/** What this Worker CAN do for somebody else: it holds the readings, so it knows where one is. */
const LOCATE_VEHICLE = "tech.rowing.dispatch.locate-vehicle";

/** What this Worker is deployed with. On Cloudflare these are bindings; on Node, `process.env`. */
export type Env = { CREDENTIAL?: string };

/** This Worker's own facts. A real one reads them from the store its environment gives it. */
const silent = new Map<string, Date>([
  ["ABC-123", new Date(Date.now() - 3_600_000)],
  ["DEF-456", new Date(Date.now() - 7_200_000)],
]);
const checked = new Set<string>();
/** Task types somebody told us about, to be read before the next scheduled sweep. */
const pending = new Set<string>();
let configuration = { label: "fleet watcher", quietAfterMinutes: 15 };

/**
 * Where a repeat under one idempotency key finds the outcome the first call recorded.
 *
 * Built HERE and not inside the Worker below, which is answered on every request: a store built
 * there would be a new one each time and would forget what the last one recorded, so every retry
 * would perform the work again while the caller believed it was protected. On Cloudflare this is a
 * durable object, because a Map per isolate has the same problem one step further out.
 */
const outcomes = memoryOutcomes();

export const fleetWorker = defineWorker<Env>((env) => ({
  // The Worker's own id: a name it is deployed with, never the URL it is served from and never
  // anything read off the address at boot. Moving it to another host must not make it another
  // Worker.
  id: "tech.rowing.fleet.watcher",

  // The Task types this Worker ANSWERS, which is what it can do for somebody else. It sits beside
  // the id rather than inside `tasks` because it is served at no address: `tasks` is what this
  // Worker serves, and this is what it IS. A Worker that only answers other people's Tasks declares
  // this and no `tasks` at all.
  //
  // Note it is NOT the type raised further down. This Worker needs a person to go and look at a
  // quiet vehicle and cannot do that itself; what it CAN do is say where a vehicle is, because it
  // holds the readings.
  //
  // Both halves of the exchange are declared here, from this Worker's own side, naming nobody:
  // `payload` is what it needs to be handed in order to answer one — the plate — and `produces` is
  // what it hands back, a position. Whoever is deciding whether to give this Worker their work
  // compares the first against what they send and the second against what their answering operation
  // takes, and knows before any work changes hands whether the two fit.
  skills: {
    [LOCATE_VEHICLE]: {
      payload: z.object({ vehicle: z.string() }),
      produces: z.object({ vehicle: z.string(), lat: z.number(), lng: z.number() }),
    },
  },

  // What makes a credential good is this Worker's business and nobody else's. It arrives as
  // `Authorization: Bearer <token>` on every address, this one answers yes or no, and a real Worker
  // validates it against whatever identity provider it already runs — which may be a network call,
  // so this may return a promise.
  authenticate: (token) => (token === env.CREDENTIAL ? "accepted" : "unauthenticated"),

  // One status for the Worker and a map of named checks beneath it. `healthy` while one of those
  // checks is not healthy is forbidden — the summary may never be better than its parts, which is
  // the whole reason a summary is trusted at all.
  health: () => ({
    status: silent.size > 100 ? "degraded" : "healthy",
    checks: { store: { status: "healthy", detail: `${silent.size} vehicles tracked` } },
  }),

  // What this Worker publishes, and the calendar every bucket boundary is cut in — a day in Madrid
  // is not a day in UTC, and a number that does not say which it meant cannot be added up by
  // anybody. The Descriptor is the catalog: this declaration is where a reader learns what exists,
  // and the address answers values only.
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
    // The Worker answers HOW MUCH, over buckets it did not have to compute. Cutting a range into
    // days in a named time zone, and getting the ends and the leap hours right, is the work that
    // `mount()` does here so that nobody writes a calendar twice.
    read: ({ buckets }) =>
      buckets.map((bucket) => ({
        start: bucket.start,
        value: [...silent.values()].filter((at) => at >= bucket.start && at < bucket.end).length,
      })),
  },

  // Each Action's input is a Zod object, and it is used twice from this one line: the Descriptor
  // carries the JSON Schema that a console renders a form from, and an incoming request is
  // validated against the same object. Nothing is typed twice, so the form an operator fills in and
  // the shape this Worker accepts cannot drift apart.
  actions: {
    outcomes,
    // `settings` READS the configuration document and `configure` below WRITES it. Both exist
    // because writing replaces the whole document rather than patching it: without the read, a
    // console would show an operator an empty form, and everything they did not happen to remember
    // would go back to a default. A secret never goes in here by value — this document is readable
    // by anyone who can read this address, so what goes in is a reference to a vault.
    settings: () => configuration,
    accepts: {
      // The ONE operation that answers `check-silent-vehicle`. The Task can end two ways, so both
      // endings are variants of this one input, told apart by `outcome`. That is what lets somebody
      // who can only ever report `found` answer it anyway: what they produce is a narrower case of
      // what this accepts, so the fit can be decided by reading two declarations rather than by
      // agreeing a mapping with every party in advance.
      "answer-check": action({
        input: z.discriminatedUnion("outcome", [
          z.object({
            outcome: z.literal("found"),
            vehicle: z.string().min(1),
            reachable: z.boolean(),
          }),
          z.object({
            outcome: z.literal("missing"),
            vehicle: z.string().min(1),
            lastSeen: z.string(),
          }),
        ]),
        result: z.object({ recordedAt: z.string() }),
        // Performed once however many times it is posted, within the declared window. The caller
        // sends a key it made up; a repeat under that key replays the first answer instead of
        // doing the work again. `mount()` keeps that promise, against the store named above.
        idempotency: { required: true, from: "header", windowSeconds: 3600 },
        // `vehicle` is a string here because the schema above says so, and the editor knows it.
        run: ({ vehicle }) => {
          checked.add(vehicle);
          return { recordedAt: new Date().toISOString() };
        },
      }),
      // `configure` is the one operation name this protocol reserves, so that an operator looking
      // at a Worker they have never seen knows which one changes its settings. It takes the WHOLE
      // document: what the operator saw in the form is what they send back.
      configure: action({
        input: z.object({ label: z.string().min(1), quietAfterMinutes: z.number().int().min(1) }),
        run: (replacement) => {
          configuration = replacement;
          return null;
        },
      }),
    },
  },

  // Conditions an operator should see, for as long as they hold. Nobody dismisses one and nothing
  // acknowledges one: an Alert ends when its condition stops being true, which is why this is a
  // function of the facts rather than a list somebody maintains. `actions` names what an operator
  // can do about it from here.
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

  // Somebody with work of a type this Worker answers said so, and that is the whole of what
  // arrives: a type, no Task and no payload. Whoever raised the work is the only one who knows
  // whether it is still there, so a Task that travelled here could already be false — this notes
  // the type and goes and reads, rather than trusting what it was handed. A type this Worker
  // declares no Skill for is refused before reaching this line, because a Worker that accepted one
  // would be telling an owner it had been told, and the owner would stop asking anybody else.
  //
  // Declaring this is optional and the whole of what it buys is latency: without it this Worker
  // reads on its own schedule, which is slower and never wrong.
  nudges: (type) => {
    pending.add(type);
  },

  // What this Worker is doing and has undertaken to do — the other direction from `tasks` below. A
  // Task is work it needs from somebody else; an activity is work it has taken on itself, and
  // nobody outside it holds a claim on any of this.
  activity: (): Activity[] => [
    {
      id: "poll-source",
      state: "scheduled",
      // When it undertook this, not when it will next run: this protocol fixes no scheduling, and
      // a Worker that answers `now` here has told an operator nothing. The summary carries the
      // cadence for a person to read.
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
    // Every Task type this Worker raises, each with the one operation of its own that answers it.
    // Whoever does the work never has to be told where to send the answer: they read it here.
    raises: {
      [SILENT_VEHICLE]: {
        // What this Worker SENDS with a Task of this type — a Zod object, like an Action's input.
        // `mount()` writes the JSON Schema the Descriptor carries, so the shape whoever takes the
        // work reads and the shape this Worker means are the same line.
        payload: z.object({ vehicle: z.string() }),
        // ONE operation, and the two ways this Task can end are variants of its input above.
        answeredBy: "answer-check",
      },
    },
    // The condition, and the whole of what this Worker owes. A Task exists while its vehicle is
    // quiet and unchecked, and it stops existing when that stops being true. Nobody closes one and
    // nobody is asked to — which is why `answer-check` above needs to know nothing about Tasks at
    // all, and why nothing here can be left open by a consumer that crashed.
    //
    // `since` is the instant the condition BEGAN, not the instant somebody asked. It is what lets a
    // reader tell work that has been waiting an hour from work that has been waiting a week.
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

  // The broker, how an event's attributes sit on it, where on it these land, and what this Worker
  // publishes. Nothing in this protocol parses the first three: an event travels over a broker
  // rather than over this API, and naming which broker is not this specification's business. This
  // is the one Capability with no address at all — there is no call to make, only a declaration of
  // what a subscriber will find and where.
  events: {
    broker: "kafka",
    protocolBinding: "cloudevents/kafka-1.0",
    destination: { bootstrapServers: "kafka.rowing.invalid:9092", topic: "fleet.telemetry" },
    publishes: {
      "tech.rowing.fleet.vehicle-went-quiet": {
        data: z.object({ vehicle: z.string(), since: z.string() }),
      },
    },
    // How far back this Worker may republish the same event, which is what a subscriber sizes its
    // deduplication store against. Declared rather than assumed, because `remember forever` is not
    // implementable and a subscriber that forgot too early would process one event twice.
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

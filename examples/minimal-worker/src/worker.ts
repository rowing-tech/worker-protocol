/**
 * A conformant Worker, and the smallest honest one.
 *
 * Copy this file. Everything in it is domain — what this Worker is, what it depends on, what it
 * counts, what it does, which conditions hold — and nothing in it is a rule. The addresses, the
 * headers, the error envelope, the page envelope and its cursor, the Claim lifecycle with its
 * lease and its fencing token, the bucket boundaries cut in a declared time zone, the idempotency
 * window: all of that is `mount()`'s, once, in `@worker-protocol/hono`.
 *
 * **It is written as a function of its environment, which is the form every platform admits.** A
 * Cloudflare Worker, a Vercel edge function and a Deno Deploy handler are handed their bindings and
 * secrets per request and have none at module scope; a Node or Bun process has them ambient and
 * loses nothing by being asked. Writing it the other way round works in one place and nowhere else.
 *
 * `pnpm dx:check` holds this file under a line count. When it grows, the question to ask is which
 * rule `mount()` failed to carry — not whether the budget should go up.
 *
 * The domain is small and real: a Worker that watches a fleet, raises a Task when a vehicle goes
 * quiet, and closes it when somebody records a check.
 */

import { memoryOutcomes, mount, type OpenTask, type WorkerBuilder } from "@worker-protocol/hono";
import * as z from "zod";

const TYPE = "tech.rowing.fleet.check-silent-vehicle";

/** What this Worker is deployed with. On Cloudflare these are bindings; on Node, `process.env`. */
export type Env = { CREDENTIAL?: string };

/** This Worker's own Facts. A real one reads them from the store its environment gives it. */
const silent = new Map<string, Date>([
  ["ABC-123", new Date(Date.now() - 3_600_000)],
  ["DEF-456", new Date(Date.now() - 7_200_000)],
]);
const checked = new Set<string>();

/**
 * ENDP-16: where a repeat under the same key finds the outcome already recorded.
 *
 * Built HERE and not inside the Worker below, which is answered on every request: a store built
 * there would be a new one each time and would forget what the last one recorded. On Cloudflare
 * this is a durable object, because a Map per isolate has the same problem one step out.
 */
const outcomes = memoryOutcomes();

export const fleetWorker: WorkerBuilder<Env> = (env) => ({
  // DESC-6: the Worker's own id, which is not the URL it is served from.
  id: "tech.rowing.fleet.watcher",

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
    },
  },

  // ALRT-2, ALRT-3: conditions an operator should see, while they hold.
  alerts: () =>
    silent.size > 1
      ? [
          {
            id: "many-silent",
            severity: "warning" as const,
            since: new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
            summary: `${silent.size} vehicles have gone quiet.`,
            actions: [],
          },
        ]
      : [],

  tasks: {
    // TASK-2, TASK-29: what this Worker asks of others, and what it answers itself.
    raises: {
      [TYPE]: {
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
          type: TYPE,
          payload: { vehicle },
          since,
        })),
  },
});

/**
 * `mount()` serves the Descriptor and every Capability declared above, at addresses it fixes.
 *
 * `app.fetch` is what every platform wants: `export default { fetch: app.fetch }` on Cloudflare,
 * Vercel edge and Deno Deploy; `serve({ fetch: app.fetch })` on Node, Bun and Deno.
 */
export const app = mount(fleetWorker);

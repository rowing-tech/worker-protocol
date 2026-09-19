/**
 * A conformant Worker, and the smallest honest one.
 *
 * Copy this file. Everything in it is domain — what this Worker is, what it depends on, what it
 * counts, what it does, which conditions hold — and nothing in it is a rule. The addresses, the
 * headers, the error envelope, the page envelope and its cursor, the Claim lifecycle with its
 * lease and its fencing token, the bucket boundaries cut in a declared time zone, the idempotency
 * window: all of that is `mount()`'s, once, in `@worker-protocol/hono`.
 *
 * `pnpm dx:check` holds this file under a line count. When it grows, the question to ask is which
 * rule `mount()` failed to carry — not whether the budget should go up.
 *
 * The domain here is deliberately small and real: a Worker that watches a fleet of vehicles, raises
 * a Task when one goes quiet, and closes it when somebody records a check.
 */

import { mount, type OpenTask, type Worker } from "@worker-protocol/hono";
import * as z from "zod";

const TYPE = "tech.rowing.fleet.check-silent-vehicle";

/** This Worker's own Facts. A real one would read them from its store. */
const silent = new Map<string, number>([
  ["ABC-123", Date.now() - 3_600_000],
  ["DEF-456", Date.now() - 7_200_000],
]);
const checked = new Set<string>();

export const fleetWorker: Worker = {
  // DESC-6: the Worker's own id, which is not the URL it is served from.
  id: "tech.rowing.fleet.watcher",

  // REG-3, REG-21: what makes a credential good is this Worker's business, and nothing else's.
  authenticate: (token) => (token === process.env.CREDENTIAL ? "accepted" : "unauthenticated"),

  // HLTH-2: one status and a map of named checks. HLTH-3 forbids `healthy` while a check is not.
  health: () => ({
    status: silent.size > 100 ? "degraded" : "healthy",
    checks: { store: { status: "healthy", detail: `${silent.size} vehicles tracked` } },
  }),

  // MET-2 to MET-6: what this Worker publishes, and the calendar every boundary is cut in.
  metrics: {
    timeZone: "Europe/Madrid",
    metrics: {
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
        value: [...silent.values()].filter(
          (at) => at >= bucket.start.getTime() && at < bucket.end.getTime(),
        ).length,
      })),
  },

  // ACT-2: the input is a Zod object, and it is used twice — the Descriptor carries the JSON
  // Schema a console renders a form from, and a request is validated against the same object.
  actions: {
    actions: {
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
    // TASK-2, TASK-3: what this Worker asks of others, and what it answers itself.
    raises: {
      [TYPE]: {
        payload: { type: "object", properties: { vehicle: { type: "string" } } },
        answeredBy: ["record-check"],
      },
    },
    answers: [],
    // TASK-23: a consumer answering a nudge may claim by type and get the work in one call.
    claimByType: true,
    // TASK-15: the condition, and the whole of what this Worker owes. A Task exists while its
    // vehicle is quiet and unchecked, and it closes when that stops being true — which nobody
    // declares, and which is why `record-check` above needs to know nothing about Tasks.
    open: (): OpenTask[] =>
      [...silent.keys()]
        .filter((vehicle) => !checked.has(vehicle))
        .map((vehicle) => ({ id: `silent:${vehicle}`, type: TYPE, payload: { vehicle } })),
  },
};

/** `mount()` serves the Descriptor and every Capability declared above, at addresses it fixes. */
export const app = mount(fleetWorker);

/**
 * The `metrics` Capability, arranged to be checked.
 *
 * What is left here is this Worker's facts and the aggregation over them. The parameter checking,
 * the half-open interval, the boundaries cut in the declared zone, the ISO week, the ordering and
 * the page envelope are `mount()`'s — which is why the zone below can be a real one with a
 * daylight-saving transition in it rather than the `UTC` this file used to be limited to.
 */

import type { MetricQuery, MetricSample } from "@worker-protocol/hono";
import type { metricDeclaration } from "@worker-protocol/schemas";
import type * as z from "zod";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** MET-6: a zone that observes daylight saving, so a day is sometimes 23 hours and sometimes 25. */
export const TIME_ZONE = "Europe/Madrid";

/** MET-21, MET-3, MET-4 — what the Descriptor declares, and the whole catalog of what exists. */
export const DECLARATIONS: Record<string, z.infer<typeof metricDeclaration>> = {
  "tasks-resolved": {
    unit: "tasks",
    // MET-3: tasks resolved over two days is the sum of the two, so a console may derive a coarser
    // period from a finer one.
    additive: true,
    granularities: ["hour", "day", "week"],
    dimensions: {
      // A closed set: MET-17 refuses a value outside it, and MET-19 grants it the right to be
      // broken down by, because a caller knows how many series it is asking for before it asks.
      taskType: { values: ["verify-vehicle", "price-quote"] },
      // A free dimension: filtered under MET-16 and never grouped under MET-19, because nothing
      // would bound the number of series.
      tenant: {},
    },
  },
  "vehicles-reporting": {
    unit: "vehicles",
    // MET-3: the same vehicle reports on both days, so summing two days is wrong and plausible.
    additive: false,
    granularities: ["day"],
    dimensions: {},
  },
};

type Event = { at: number; metric: string; taskType: string; tenant: string; value: number };

/**
 * A fortnight of facts, deterministic given the day it is generated on.
 *
 * One day is left empty on purpose. MET-15 separates *nothing happened*, which is a bucket absent
 * from the answer, from *I no longer hold it*, which is a null value — and a verifier cannot see
 * the distinction unless a Worker produces the first.
 */
export function seed(now: number): Event[] {
  const origin = Math.floor(now / DAY) * DAY - 14 * DAY;
  const types = ["verify-vehicle", "price-quote"];
  const tenants = ["acme", "globex"];
  const events: Event[] = [];

  for (let day = 0; day < 14; day++) {
    if (day === 5) continue; // the quiet day
    for (let hour = 0; hour < 24; hour += 6) {
      const at = origin + day * DAY + hour * HOUR;
      for (const [i, taskType] of types.entries()) {
        events.push({
          at,
          metric: "tasks-resolved",
          taskType,
          tenant: tenants[(day + i) % 2],
          value: 1 + ((day + hour + i) % 4),
        });
      }
      events.push({ at, metric: "vehicles-reporting", taskType: "", tenant: "", value: 1 });
    }
  }
  return events;
}

/**
 * One read, over buckets this Worker did not have to cut.
 *
 * MET-18 is the rule this implements: a dimension a read neither fixes nor breaks down by is
 * accumulated over, so an unfiltered answer is the total and never a slice the Worker chose.
 */
export function read({ metric, buckets, fixed, by }: MetricQuery, now: number): MetricSample[] {
  const totals = new Map<
    string,
    { start: Date; dimensions: Record<string, string>; value: number }
  >();

  for (const event of seed(now)) {
    if (event.metric !== metric) continue;
    if (Object.entries(fixed).some(([d, v]) => (event as Record<string, unknown>)[d] !== v)) {
      continue;
    }
    const bucket = buckets.find(
      (candidate) => event.at >= candidate.start.getTime() && event.at < candidate.end.getTime(),
    );
    if (bucket === undefined) continue;

    const dimensions: Record<string, string> = {};
    for (const dimension of by) {
      dimensions[dimension] = String((event as Record<string, unknown>)[dimension]);
    }
    const key = `${bucket.start.getTime()}|${by.map((d) => dimensions[d]).join("|")}`;
    const held = totals.get(key);
    if (held) held.value += event.value;
    else totals.set(key, { start: bucket.start, dimensions, value: event.value });
  }

  // MET-15: a bucket this Worker accumulated nothing in is absent from the answer, which is what
  // `totals` holding no entry for it already produces.
  return [...totals.values()].map(({ start, dimensions, value }) => ({
    start,
    value,
    ...(by.length > 0 ? { dimensions } : {}),
  }));
}

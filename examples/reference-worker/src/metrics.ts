/**
 * The `metrics` Capability, arranged to be checked.
 *
 * The declared time zone is `UTC`, and that is a limitation stated rather than hidden. MET-20 cuts
 * every bucket boundary in the declared zone and metrics.md spends a paragraph on a day across a
 * daylight-saving transition being 23 or 25 hours — a case this Worker does not yet produce,
 * because seeding it correctly needs calendar arithmetic in a zone with a transition and seeding
 * it *wrongly* would teach the verifier that a bug is conformant. It joins the arrangements
 * `conformance/verifiability.md` already owes.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const TIME_ZONE = "UTC";

/** MET-2, MET-3, MET-4 — what the Descriptor declares, and the whole catalog of what exists. */
export const DECLARATIONS = {
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
} as const;

type Event = { at: number; metric: string; taskType: string; tenant: string; value: number };

/**
 * A fortnight of facts, deterministic given the day it is generated on.
 *
 * One day is left empty on purpose. MET-15 separates *nothing happened*, which is a bucket absent
 * from the answer, from *I no longer hold it*, which is a null value — and a verifier cannot see
 * the distinction unless a Worker produces the first.
 */
export function seed(now: number): Event[] {
  const startOfToday = Math.floor(now / DAY) * DAY;
  const origin = startOfToday - 14 * DAY;
  const types = ["verify-vehicle", "price-quote"];
  const tenants = ["acme", "globex"];
  const events: Event[] = [];

  for (let day = 0; day < 14; day++) {
    if (day === 5) continue; // the quiet day
    for (let hour = 0; hour < 24; hour += 6) {
      for (const [i, taskType] of types.entries()) {
        events.push({
          at: origin + day * DAY + hour * HOUR,
          metric: "tasks-resolved",
          taskType,
          tenant: tenants[(day + i) % 2],
          value: 1 + ((day + hour + i) % 4),
        });
      }
      events.push({
        at: origin + day * DAY + hour * HOUR,
        metric: "vehicles-reporting",
        taskType: "",
        tenant: "",
        value: 1,
      });
    }
  }
  return events;
}

/** MET-20: every boundary cut in the declared zone, which being UTC makes plain arithmetic. */
function bucketStart(at: number, granularity: string): number {
  if (granularity === "hour") return Math.floor(at / HOUR) * HOUR;
  if (granularity === "day") return Math.floor(at / DAY) * DAY;
  if (granularity === "week") {
    // MET-7: an ISO 8601 week, beginning Monday. 1970-01-01 was a Thursday, so the epoch sits
    // three days into its week and the shift is what puts a Monday at zero.
    const shifted = at + 3 * DAY;
    return Math.floor(shifted / (7 * DAY)) * (7 * DAY) - 3 * DAY;
  }
  throw new Error(`no such granularity: ${granularity}`);
}

function bucketEnd(start: number, granularity: string): number {
  if (granularity === "hour") return start + HOUR;
  if (granularity === "day") return start + DAY;
  return start + 7 * DAY;
}

const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export type Refusal = { status: number; code: string; message: string };
export type Answer = { items: unknown[] };

/**
 * One read. MET-8 through MET-19, and ENDP-24 for a parameter this surface does not know.
 *
 * The parameters this protocol defines on a read are `metric`, `granularity`, `from`, `to`, `by`
 * and the cursor — which is what MET-5 forbids a dimension from being named after.
 */
const OWN_PARAMETERS = new Set(["metric", "granularity", "from", "to", "by", "cursor"]);

export function read(query: URLSearchParams, now: number): Refusal | Answer {
  const reject = (status: number, code: string, message: string): Refusal => ({
    status,
    code,
    message,
  });

  // MET-8: a read names one metric. MET-9: one the entry does not declare is 404.
  const name = query.get("metric");
  if (name === null) {
    return reject(400, "invalid_parameter", "A read names one metric.");
  }
  const declaration = (
    DECLARATIONS as Record<string, (typeof DECLARATIONS)[keyof typeof DECLARATIONS]>
  )[name];
  if (declaration === undefined) {
    return reject(404, "not_found", `No metric named ${name} is declared.`);
  }

  // ENDP-24: an unrecognized filter parameter is 400 and is never ignored. A filter dropped in
  // silence answers with more than the caller asked for, in a shape it will happily parse.
  const dimensions = declaration.dimensions as Record<string, { values?: readonly string[] }>;
  for (const key of query.keys()) {
    if (OWN_PARAMETERS.has(key)) continue;
    if (key in dimensions) continue;
    return reject(400, "unknown_filter", `This metric declares no dimension named ${key}.`);
  }

  // MET-8, MET-10: the granularity is named where the metric declares more than one, and may be
  // omitted where it declares exactly one.
  const granularities = declaration.granularities as readonly string[];
  const asked = query.get("granularity");
  if (asked === null && granularities.length > 1) {
    return reject(400, "invalid_parameter", "This metric declares more than one granularity.");
  }
  const granularity = asked ?? granularities[0];
  if (!granularities.includes(granularity)) {
    return reject(400, "invalid_parameter", `This metric does not accumulate by ${granularity}.`);
  }

  // MET-11: `from` and `to` are RFC 3339 instants carrying an offset, and the interval is
  // half-open. Absent, `from` is the start of the current bucket and `to` is now.
  const instant = (raw: string | null): number | null => {
    if (raw === null) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
      return Number.NaN;
    }
    return Date.parse(raw);
  };
  const from = instant(query.get("from"));
  const to = instant(query.get("to"));
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return reject(400, "invalid_parameter", "`from` and `to` are RFC 3339 instants.");
  }
  const start = from ?? bucketStart(now, granularity);
  const end = to ?? now;

  // MET-19: a read breaks down only by a dimension that declared its set of values. Over a free
  // one nobody knows how many series the answer holds, so it is filtered and never grouped.
  const by = query.getAll("by");
  for (const dimension of by) {
    const declared = dimensions[dimension];
    if (declared === undefined) {
      return reject(400, "unknown_filter", `This metric declares no dimension named ${dimension}.`);
    }
    if (declared.values === undefined) {
      return reject(
        400,
        "invalid_parameter",
        `${dimension} declares no set of values to group by.`,
      );
    }
  }

  // MET-16, MET-17: a dimension is fixed with a parameter named exactly as the dimension, and a
  // value outside a declared set is refused. Where no set is declared the Worker cannot tell a
  // typo from a value it has not seen yet, so any string is accepted and may match nothing.
  const fixed: Record<string, string> = {};
  for (const [dimension, declared] of Object.entries(dimensions)) {
    const value = query.get(dimension);
    if (value === null) continue;
    if (declared.values !== undefined && !declared.values.includes(value)) {
      return reject(400, "invalid_parameter", `${dimension} does not take the value ${value}.`);
    }
    fixed[dimension] = value;
  }

  // MET-18: a dimension a read neither fixes nor breaks down by is accumulated over.
  const totals = new Map<string, { start: number; key: Record<string, string>; value: number }>();
  for (const event of seed(now)) {
    if (event.metric !== name) continue;
    if (Object.entries(fixed).some(([d, v]) => (event as Record<string, unknown>)[d] !== v)) {
      continue;
    }

    const bucket = bucketStart(event.at, granularity);
    // MET-12: a Worker answers the buckets whose start falls in the interval, whole or not at all.
    if (bucket < start || bucket >= end) continue;

    const key: Record<string, string> = {};
    for (const dimension of by)
      key[dimension] = String((event as Record<string, unknown>)[dimension]);

    const id = `${bucket}|${by.map((d) => key[d]).join("|")}`;
    const held = totals.get(id);
    if (held) held.value += event.value;
    else totals.set(id, { start: bucket, key, value: event.value });
  }

  // MET-14: ascending by start, and where a read breaks down, by the values broken down by within
  // one start — an order with ties in it is not one a cursor could resume from.
  const items = [...totals.values()]
    .sort(
      (a, b) =>
        a.start - b.start ||
        by
          .map((d) => a.key[d])
          .join()
          .localeCompare(by.map((d) => b.key[d]).join()),
    )
    .map((bucket) => ({
      start: rfc3339(bucket.start),
      end: rfc3339(bucketEnd(bucket.start, granularity)),
      value: bucket.value,
      ...(by.length > 0 ? { dimensions: bucket.key } : {}),
    }));

  // MET-15: a bucket the Worker accumulated nothing in is absent, which is what `totals` holding
  // no entry for it already produces. ENDP-20: the page envelope, with the cursor absent at the
  // end of the collection — and this Worker answers every interval in one page.
  return { items };
}

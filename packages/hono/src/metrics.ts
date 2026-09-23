/**
 * The `metrics` surface: every rule in `spec/metrics.md` that is not a number.
 *
 * What a Worker knows is how much of something happened. What it has had to write until now is the
 * parameter validation, the half-open interval, the boundaries cut in a declared zone, the ISO
 * week, the ordering with its tiebreak and the page envelope — all of it fixed by MET-8 through
 * MET-20 and identical in every Worker. So this asks a Worker for values over buckets it has
 * already cut, and answers the rest itself.
 */

import type { metricDeclaration, metricPage } from "@worker-protocol/schemas";
import type * as z from "zod";
import { bucketsIn, type Granularity, halfOpen, rfc3339 } from "./buckets.ts";
import type { ErrorCode } from "./codes.ts";
import { decodeCursor, encodeCursor } from "./collection.ts";
import type { Refusal } from "./worker.ts";

export type MetricDeclarations = Record<string, z.infer<typeof metricDeclaration>>;

/** One period of one metric, already cut in the zone the entry declares (MET-12, MET-20). */
export type Bucket = { start: Date; end: Date };

/** What a Worker is asked for: values, over buckets it did not have to compute. */
export type MetricQuery = {
  /** MET-8. One of the metrics the entry declares. */
  metric: string;
  /** MET-3. One of the granularities that metric declares. */
  granularity: Granularity;
  /** MET-11, MET-12. The whole buckets the interval covers, ascending. */
  buckets: Bucket[];
  /** MET-16, MET-17. The dimensions this read fixes, each a value the declaration admits. */
  fixed: Record<string, string>;
  /** MET-19. The dimensions to break down by, each one that declared its set of values. */
  by: string[];
};

/**
 * One value. MET-15 draws the distinction that matters: a bucket a Worker accumulated nothing in
 * is ABSENT from the answer, and one it no longer holds carries `null`. Returning neither is the
 * first case, and it is the common one.
 */
export type MetricSample = {
  /** The `start` of one of the buckets that were asked for. */
  start: Date;
  value: number | null;
  /** MET-19. One value per dimension named in `by`, and absent where nothing was broken down. */
  dimensions?: Record<string, string>;
};

export type MetricFacts = {
  timeZone: string;
  /** MET-21. Every metric this Worker publishes, keyed by name. */
  publishes: MetricDeclarations;
  /** The Worker's own facts. Everything around this call is the specification's. */
  read: (query: MetricQuery) => MetricSample[] | Refusal | Promise<MetricSample[] | Refusal>;
  /** ENDP-19 (recommended). The most buckets one page carries. */
  pageSize?: number;
};

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/** MET-5, MET-8, MET-11, MET-19, ENDP-20 — what this read defines, and what a dimension may not be. */
const OWN_PARAMETERS = new Set(["metric", "granularity", "from", "to", "by", "cursor"]);

type MetricPage = z.infer<typeof metricPage>;

export function metrics(facts: MetricFacts) {
  const cap = facts.pageSize ?? 500;

  return async function read(query: URLSearchParams): Promise<Refusal | MetricPage> {
    // MET-8: a read names one metric. MET-9: one the entry does not declare is a resource that
    // does not exist, which is MET-10's division — the name is wrong, not the parameter.
    const name = query.get("metric");
    if (name === null) return refuse("invalid_parameter", "A read names one metric.");
    const declaration = facts.publishes[name];
    if (declaration === undefined) {
      return refuse("not_found", `No metric named ${name} is declared.`);
    }
    const { dimensions, granularities } = declaration;

    // ENDP-24: an unrecognized filter is `400` and is never ignored. A dimension is spelled into a
    // parameter of its own name (MET-16), so what is left after those is a name nobody declared.
    for (const key of query.keys()) {
      if (OWN_PARAMETERS.has(key) || key in dimensions) continue;
      return refuse("unknown_filter", `This metric declares no dimension named ${key}.`);
    }

    // MET-8, MET-10: named where the metric declares more than one, omittable where it declares
    // exactly one, and `400` for one it does not accumulate by.
    const asked = query.get("granularity");
    if (asked === null && granularities.length > 1) {
      return refuse("invalid_parameter", "This metric declares more than one granularity.");
    }
    const granularity = (asked ?? granularities[0]) as Granularity;
    if (!(granularities as string[]).includes(granularity)) {
      return refuse("invalid_parameter", `This metric does not accumulate by ${granularity}.`);
    }

    // MET-11: RFC 3339 instants carrying an offset, half-open, so two adjacent reads add up. The
    // parsing is `buckets.ts`'s, because LOG-8 spells the same interval and one rule is one
    // spelling.
    const interval = halfOpen(query);
    if (interval === null) {
      return refuse("invalid_parameter", "`from` and `to` are RFC 3339 instants.");
    }
    const { from, to } = interval;
    const now = Date.now();
    const end = to ?? now;
    // Absent, `from` is the start of the current bucket: the question a console asks by default is
    // about the period in progress, not about all of history.
    const start = from ?? bucketsIn(end - 1, end, granularity, facts.timeZone)[0]?.start ?? end;

    // MET-19: only a dimension that declared its set of values may be grouped by. Over a free one
    // nothing bounds the number of series, so it is filtered and never grouped.
    const by = query.getAll("by");
    for (const dimension of by) {
      const declared = dimensions[dimension];
      if (declared === undefined) {
        return refuse("unknown_filter", `This metric declares no dimension named ${dimension}.`);
      }
      if (declared.values === undefined) {
        return refuse("invalid_parameter", `${dimension} declares no set of values to group by.`);
      }
    }

    // MET-16, MET-17: a value outside a declared set is refused. Where no set is declared the
    // Worker cannot tell a typo from a value it has not seen, so any string is accepted.
    const fixed: Record<string, string> = {};
    for (const [dimension, declared] of Object.entries(dimensions)) {
      const value = query.get(dimension);
      if (value === null) continue;
      if (declared.values !== undefined && !declared.values.includes(value)) {
        return refuse("invalid_parameter", `${dimension} does not take the value ${value}.`);
      }
      fixed[dimension] = value;
    }

    const cut = bucketsIn(start, end, granularity, facts.timeZone);
    const samples = await facts.read({
      metric: name,
      granularity,
      buckets: cut.map((bucket) => ({ start: new Date(bucket.start), end: new Date(bucket.end) })),
      fixed,
      by,
    });
    if (!Array.isArray(samples)) return samples;

    const endOf = new Map(cut.map((bucket) => [bucket.start, bucket.end]));

    // MET-14: ascending by start, and within one start by the values broken down by — an order
    // with ties in it is not one a cursor could resume from. MET-13: the end is carried rather
    // than derived, because a day across a transition is 23 or 25 hours.
    //
    // `position` is that order written down, and it is what ENDP-33 pages by. MET-15 is the reason
    // this cannot be an offset: a bucket the Worker accumulated nothing in is ABSENT, so a bucket
    // that gains its first value between two reads appears in the MIDDLE of the series and pushes
    // everything after it along.
    const position = (one: { sample: MetricSample; at: number }) =>
      `${String(one.at).padStart(16, "0")}\u0000${by.map((d) => one.sample.dimensions?.[d] ?? "").join("\u0000")}`;
    const ordered = samples
      .map((sample) => ({ sample, at: sample.start.getTime() }))
      .filter(({ at }) => endOf.has(at))
      .sort((a, b) => position(a).localeCompare(position(b)));

    const sent = query.get("cursor");
    const after = sent === null ? null : decodeCursor(sent);
    if (sent !== null && after === null) {
      return refuse("invalid_parameter", "That cursor was not produced by this Worker.");
    }
    const rest =
      after === null ? ordered : ordered.filter((one) => position(one).localeCompare(after) > 0);
    const page = rest.slice(0, cap);
    const items = page.map(({ sample, at }) => ({
      start: rfc3339(at),
      end: rfc3339(endOf.get(at) as number),
      value: sample.value,
      ...(by.length > 0 && sample.dimensions !== undefined
        ? { dimensions: sample.dimensions }
        : {}),
    }));
    const last = page.at(-1);
    return rest.length > cap && last !== undefined
      ? { items, nextCursor: encodeCursor(position(last)) }
      : { items };
  };
}

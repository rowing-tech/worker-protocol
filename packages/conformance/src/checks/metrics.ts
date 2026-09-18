import { metricPage, metricsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Result, Rule } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `metrics` Capability.
 *
 * The most checkable file in the specification — nineteen of its twenty rules have a witness a
 * tool holding one ordinary credential can reach — and the one that needs a Worker with numbers in
 * it. Several checks below report `notExercised` against a Worker that has accumulated nothing,
 * which is not a weaker verdict than `passes`: it says a check exists and this run did not reach
 * it, which is a gap somebody can close by pointing the tool at a Worker that has been running.
 */
export const CLAIMS = [
  "MET-1",
  "MET-2",
  "MET-3",
  "MET-4",
  "MET-5",
  "MET-6",
  "MET-7",
  "MET-8",
  "MET-9",
  "MET-10",
  "MET-11",
  "MET-12",
  "MET-13",
  "MET-14",
  "MET-16",
  "MET-17",
  "MET-18",
  "MET-19",
  "MET-20",
  "NAME-1",
  // A metric read is the only collection this edition has, so it is where the two collection rules
  // are judged. A generic probe cannot construct a valid read for an arbitrary surface — it would
  // have to know which parameters that surface requires, which is each Capability file's to say —
  // so the check that already holds a valid page is the one that can judge the envelope it came in.
  "ENDP-20",
  "ENDP-23",
] as const;

/**
 * MET-5: the parameters this protocol defines on a read, which a dimension may not be named after.
 *
 * The list is here rather than generated because metrics.md states it in prose and nothing in
 * `schemas/` can: the rule exists precisely because expressing *not one of these names* in a JSON
 * Schema pattern needs a negative lookahead that RE2-backed validators refuse.
 */
const OWN_PARAMETERS = ["metric", "granularity", "from", "to", "by", "cursor"];

type Declaration = {
  unit: string;
  additive: boolean;
  granularities: string[];
  dimensions: Record<string, { values?: string[] }>;
};

/** The wall-clock reading of an instant in a zone, for judging where a boundary was cut. */
function localParts(iso: string, zone: string) {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(iso))) parts[part.type] = part.value;
  // `en-CA` renders midnight as `24` rather than `00` in some ICU versions, which is the same
  // instant under another name and would otherwise read as a boundary cut in the wrong place.
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

export async function checkMetrics(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
): Promise<Result[]> {
  const results: Result[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };
  const allExcept = (verdict: Result["verdict"], why: string, except: string[] = []) => {
    for (const id of CLAIMS) if (!except.includes(id)) say(id, verdict, why);
  };

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `metrics`");
    return results;
  }

  // MET-1 through MET-6 are read off the Descriptor, and a verifier fails the Worker on them
  // without calling anything. The rule each failure belongs to is read off `schemas/`.
  const declared = metricsEntry.safeParse(entry);
  if (!declared.success) {
    const blamed = new Set<string>();
    for (const issue of declared.error.issues) {
      const id = ruleFor(attribution, "metrics-entry", issue.path) ?? "MET-1";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    allExcept("notExercised", "the `metrics` entry did not validate", [...blamed]);
    return results;
  }

  const { timeZone, metrics } = declared.data as unknown as {
    timeZone: string;
    metrics: Record<string, Declaration>;
  };
  for (const id of ["MET-1", "MET-2", "MET-3", "MET-4", "MET-6"]) say(id, "passes");

  // MET-5: a dimension named after a parameter this protocol defines on a read would be
  // unreachable — the Worker could never tell the filter from the parameter.
  const collisions: string[] = [];
  for (const [metric, declaration] of Object.entries(metrics)) {
    for (const dimension of Object.keys(declaration.dimensions)) {
      if (OWN_PARAMETERS.includes(dimension)) collisions.push(`${metric}.${dimension}`);
    }
  }
  if (collisions.length > 0) {
    say("MET-5", "fails", `${collisions.join(", ")}: named after a parameter of a read`);
  } else {
    say("MET-5", "passes");
  }

  if (url === null) {
    allExcept("notExercised", "the declared address did not resolve", [
      "MET-1",
      "MET-2",
      "MET-3",
      "MET-4",
      "MET-5",
      "MET-6",
    ]);
    return results;
  }

  const readUrl = (parameters: Record<string, string | string[]>) => {
    const target = new URL(url);
    for (const [key, value] of Object.entries(parameters)) {
      for (const one of Array.isArray(value) ? value : [value])
        target.searchParams.append(key, one);
    }
    return target.toString();
  };

  // The metric with the most to say: the most granularities, then the most dimensions. A Worker
  // that declares one metric with one granularity and no dimension is checked on less, and the
  // report says which rules that left unexercised rather than passing them.
  const [name, declaration] =
    Object.entries(metrics).sort(
      ([, a], [, b]) =>
        b.granularities.length - a.granularities.length ||
        Object.keys(b.dimensions).length - Object.keys(a.dimensions).length,
    )[0] ?? [];

  if (name === undefined || declaration === undefined) {
    allExcept("notExercised", "the entry declares no metric to read", [
      "MET-1",
      "MET-2",
      "MET-3",
      "MET-4",
      "MET-5",
      "MET-6",
    ]);
    return results;
  }

  const granularity = declaration.granularities.includes("day")
    ? "day"
    : declaration.granularities[0];

  // MET-9: a metric the entry does not declare is 404, with the code `not_found`. A name no
  // Worker would declare is the only way to ask without a Worker having to cooperate.
  const absent = await transcript.send(
    readUrl({ metric: "no-such-metric-a4f1c7", granularity }),
    "a metric the entry does not declare",
    { permanent: true },
  );
  const absentCode = (absent.json as { code?: string } | null)?.code;
  if (absent.status === 404 && absentCode === "not_found") say("MET-9", "passes");
  else say("MET-9", "fails", `answered ${absent.status} with \`${absentCode ?? "no code"}\``);

  // MET-10: a granularity the metric does not declare is 400 with `invalid_parameter`, and so is
  // an omitted one where the metric declares more than one — which is also MET-8's condition.
  const wrongGrain = await transcript.send(
    readUrl({ metric: name, granularity: "fortnight" }),
    "a granularity the metric does not declare",
    { permanent: true },
  );
  const wrongCode = (wrongGrain.json as { code?: string } | null)?.code;
  if (wrongGrain.status === 400 && wrongCode === "invalid_parameter") say("MET-10", "passes");
  else say("MET-10", "fails", `answered ${wrongGrain.status} with \`${wrongCode ?? "no code"}\``);

  if (declaration.granularities.length > 1) {
    const omitted = await transcript.send(
      readUrl({ metric: name }),
      "a read with no granularity, where the metric declares more than one",
    );
    if (omitted.status === 400) say("MET-8", "passes");
    else say("MET-8", "fails", `answered ${omitted.status} rather than refusing`);
  } else {
    const omitted = await transcript.send(
      readUrl({ metric: name }),
      "a read with no granularity, where the metric declares exactly one",
    );
    if (omitted.status === 200) say("MET-8", "passes");
    else say("MET-8", "fails", `refused an omitted granularity with ${omitted.status}`);
  }

  // A window wide enough to hold something, and explicit so that two reads can be compared.
  const now = Date.now();
  const span = 30 * 24 * 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const whole = await transcript.send(
    readUrl({ metric: name, granularity, from: iso(now - span), to: iso(now + 3_600_000) }),
    "the metric over a month",
  );

  const page = metricPage.safeParse(whole.json);
  if (whole.status !== 200 || !page.success) {
    const why =
      whole.status !== 200
        ? `the read answered ${whole.status}`
        : `the answer did not validate: ${page.success ? "" : page.error.issues[0]?.message}`;
    allExcept("notExercised", why, [
      "MET-1",
      "MET-2",
      "MET-3",
      "MET-4",
      "MET-5",
      "MET-6",
      "MET-8",
      "MET-9",
      "MET-10",
    ]);
    if (whole.status === 200) say("MET-13", "fails", why);
    return results;
  }
  const buckets = page.data.items;
  say("MET-13", "passes");

  // ENDP-20: every surface that answers a list answers it in the shared page envelope. `metricPage`
  // narrows that envelope's items, which is the narrowing ENDP-20 says each surface performs, so
  // the page having validated above is the witness.
  say("ENDP-20", "passes");

  // ENDP-23: a collection declares an order and holds it, so that paging terminates. The witness
  // is an unchanged read answering the same items in the same order — a collection whose order
  // moves between two reads has none for a cursor to resume from.
  const repeated = await transcript.send(
    readUrl({ metric: name, granularity, from: iso(now - span), to: iso(now + 3_600_000) }),
    "the same read again, to see whether the order holds",
  );
  const second = metricPage.safeParse(repeated.json);
  if (!second.success) {
    say("ENDP-23", "notExercised", "the repeated read did not validate");
  } else if (JSON.stringify(second.data.items) !== JSON.stringify(buckets)) {
    say("ENDP-23", "fails", "an unchanged read answered its buckets in a different order");
  } else {
    say("ENDP-23", "passes");
  }

  if (buckets.length === 0) {
    allExcept("notExercised", "the Worker has accumulated nothing over the last month", [
      "MET-1",
      "MET-2",
      "MET-3",
      "MET-4",
      "MET-5",
      "MET-6",
      "MET-8",
      "MET-9",
      "MET-10",
      "MET-13",
    ]);
    return results;
  }

  // MET-14: buckets ascend by start.
  const starts = buckets.map((b) => Date.parse(b.start));
  const ascending = starts.every((at, i) => i === 0 || at >= starts[i - 1]);
  if (ascending) say("MET-14", "passes");
  else say("MET-14", "fails", "buckets are not ascending by start");

  // MET-20, and MET-7 for a week. Every boundary is cut in the zone the entry declares — so the
  // wall-clock reading of a bucket's start in that zone is midnight, or the top of an hour.
  const misaligned = buckets.filter((bucket) => {
    const at = localParts(bucket.start, timeZone);
    if (granularity === "hour") return at.minute !== "00" || at.second !== "00";
    return at.hour !== "00" || at.minute !== "00" || at.second !== "00";
  });
  if (misaligned.length === 0) {
    say("MET-20", "passes");
  } else {
    const at = localParts(misaligned[0].start, timeZone);
    say("MET-20", "fails", `${misaligned[0].start} is ${at.hour}:${at.minute} in ${timeZone}`);
  }

  if (granularity === "week") {
    const notMonday = buckets.filter((b) => localParts(b.start, timeZone).weekday !== "Mon");
    if (notMonday.length === 0) say("MET-7", "passes");
    else say("MET-7", "fails", `${notMonday[0].start} does not begin a Monday in ${timeZone}`);
  } else if (declaration.granularities.includes("week")) {
    const weekly = await transcript.send(
      readUrl({ metric: name, granularity: "week", from: iso(now - span), to: iso(now) }),
      "the metric by week",
    );
    const weeks = metricPage.safeParse(weekly.json);
    const notMonday = weeks.success
      ? weeks.data.items.filter((b) => localParts(b.start, timeZone).weekday !== "Mon")
      : [];
    if (!weeks.success) say("MET-7", "notExercised", "the weekly read did not validate");
    else if (weeks.data.items.length === 0) say("MET-7", "notExercised", "no week accumulated");
    else if (notMonday.length === 0) say("MET-7", "passes");
    else say("MET-7", "fails", `${notMonday[0].start} does not begin a Monday in ${timeZone}`);
  } else {
    say("MET-7", "notExercised", "the metric declares no `week` granularity");
  }

  // MET-12: an interval that begins inside a bucket never cuts one. Asking from the midpoint of
  // the first whole bucket must not return a bucket whose start is before that midpoint.
  const first = buckets[0];
  const midpoint = Date.parse(first.start) + (Date.parse(first.end) - Date.parse(first.start)) / 2;
  const fromMid = await transcript.send(
    readUrl({ metric: name, granularity, from: iso(midpoint), to: iso(now + 3_600_000) }),
    "an interval beginning inside a bucket",
  );
  const mid = metricPage.safeParse(fromMid.json);
  if (!mid.success) {
    say("MET-12", "notExercised", "the read from a midpoint did not validate");
    say("MET-11", "notExercised", "the read from a midpoint did not validate");
  } else {
    const cut = mid.data.items.filter((b) => Date.parse(b.start) < midpoint);
    if (cut.length === 0) say("MET-12", "passes");
    else say("MET-12", "fails", `${cut[0].start} begins before the interval did`);

    // MET-11: the interval is half-open, so a bucket starting exactly at `to` is excluded and the
    // two halves of a split interval share a boundary without sharing a bucket.
    const boundary = buckets[Math.floor(buckets.length / 2)];
    const before = await transcript.send(
      readUrl({ metric: name, granularity, from: iso(now - span), to: boundary.start }),
      "the interval up to a bucket's own start",
    );
    const head = metricPage.safeParse(before.json);
    if (!head.success) {
      say("MET-11", "notExercised", "the half-open read did not validate");
    } else if (head.data.items.some((b) => b.start === boundary.start)) {
      say("MET-11", "fails", `\`to\` of ${boundary.start} returned the bucket starting there`);
    } else {
      say("MET-11", "passes");
    }
  }

  const closed = Object.entries(declaration.dimensions).find(([, d]) => d.values !== undefined);
  const free = Object.entries(declaration.dimensions).find(([, d]) => d.values === undefined);

  // MET-17: a value outside a declared set is 400 with `invalid_parameter`.
  if (closed) {
    const [dimension] = closed;
    const bad = await transcript.send(
      readUrl({ metric: name, granularity, [dimension]: "no-such-value-9c2e" }),
      "a dimension value outside the declared set",
      { permanent: true },
    );
    const code = (bad.json as { code?: string } | null)?.code;
    if (bad.status === 400 && code === "invalid_parameter") say("MET-17", "passes");
    else say("MET-17", "fails", `answered ${bad.status} with \`${code ?? "no code"}\``);
  } else {
    say("MET-17", "notExercised", "no dimension declares a closed set of values");
  }

  // NAME-1: two names are the same name when their bytes are identical — no case folding, no
  // normalisation, no trimming. Its witness is any declared name carrying an uppercase letter,
  // sent back folded where the Worker matches names: a dimension whose parameter is `taskType`
  // must not answer to `tasktype`. A Worker that folds passes every test anybody writes until the
  // day somebody declares a name with a capital in it, which is exactly why this is worth a check.
  const foldable = Object.keys(declaration.dimensions).find((d) => d !== d.toLowerCase());
  if (foldable === undefined) {
    say("NAME-1", "notExercised", "no declared dimension name carries an uppercase letter");
  } else {
    const folded = await transcript.send(
      readUrl({ metric: name, granularity, [foldable.toLowerCase()]: "anything" }),
      "a declared dimension name, folded to lowercase",
      { permanent: true },
    );
    const code = (folded.json as { code?: string } | null)?.code;
    if (folded.status === 400 && code === "unknown_filter") {
      say("NAME-1", "passes");
    } else {
      say("NAME-1", "fails", `\`${foldable.toLowerCase()}\` was matched against \`${foldable}\``);
    }
  }

  // MET-16 and MET-18: a dimension is fixed with a parameter of its own name, and one a read
  // neither fixes nor groups by is accumulated over — so on a metric that only accumulates upward
  // the unfiltered total is never smaller than any slice of it.
  const total = buckets.reduce((sum, b) => sum + (b.value ?? 0), 0);
  if (closed && declaration.additive) {
    const [dimension, { values }] = closed;
    const slice = await transcript.send(
      readUrl({
        metric: name,
        granularity,
        from: iso(now - span),
        to: iso(now + 3_600_000),
        [dimension]: (values as string[])[0],
      }),
      "the metric fixed to one value of a dimension",
    );
    const sliced = metricPage.safeParse(slice.json);
    if (slice.status !== 200 || !sliced.success) {
      say("MET-16", "fails", `fixing \`${dimension}\` answered ${slice.status}`);
      say("MET-18", "notExercised", "the filtered read did not answer");
    } else {
      say("MET-16", "passes");
      const part = sliced.data.items.reduce((sum, b) => sum + (b.value ?? 0), 0);
      if (part <= total) say("MET-18", "passes");
      else
        say(
          "MET-18",
          "fails",
          `fixing \`${dimension}\` answered ${part} against a total of ${total}`,
        );
    }
  } else {
    say("MET-16", "notExercised", "no dimension declares a closed set to filter by");
    say("MET-18", "notExercised", "no additive metric with a closed dimension to compare over");
  }

  // MET-19: a read breaks down with `by`, and only by a dimension that declared its values. Each
  // bucket then carries what it is broken down by, and the same period appears once per
  // combination.
  if (closed) {
    const [dimension] = closed;
    const grouped = await transcript.send(
      readUrl({
        metric: name,
        granularity,
        from: iso(now - span),
        to: iso(now + 3_600_000),
        by: dimension,
      }),
      "the metric broken down by a declared dimension",
    );
    const parts = metricPage.safeParse(grouped.json);
    const freeRefused = free
      ? await transcript
          .send(
            readUrl({ metric: name, granularity, by: free[0] }),
            "a breakdown by a free dimension",
          )
          .then((r) => r.status === 400)
      : true;

    if (grouped.status !== 200 || !parts.success) {
      say("MET-19", "fails", `a breakdown by \`${dimension}\` answered ${grouped.status}`);
    } else if (parts.data.items.some((b) => b.dimensions?.[dimension] === undefined)) {
      say("MET-19", "fails", "a broken-down bucket carries no value for the dimension");
    } else if (!freeRefused) {
      say("MET-19", "fails", `a breakdown by the free dimension \`${free?.[0]}\` was not refused`);
    } else {
      say("MET-19", "passes");
    }
  } else {
    say("MET-19", "notExercised", "no dimension declares a closed set to group by");
  }

  return results;
}

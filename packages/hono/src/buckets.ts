/**
 * Bucket boundaries, cut in the time zone a Worker declares.
 *
 * MET-20 cuts every boundary in the zone the `metrics` entry declares, MET-7 makes a week the ISO
 * 8601 one beginning Monday, and MET-13 has each bucket carry an end rather than a duration —
 * because a day across a daylight-saving transition is 23 or 25 hours and a reader comparing
 * against its own clock would otherwise need a calendar.
 *
 * This is the clearest case in the whole SDK for the package carrying what the specification says.
 * A Worker author who wrote this themselves would write it in UTC, it would work, and it would be
 * silently wrong for every consumer in a zone that observes daylight saving — a class of bug that
 * appears twice a year and is attributed to anything but the metric.
 */

import type { metricGranularity } from "@worker-protocol/schemas";
import type * as z from "zod";

export type Granularity = z.infer<typeof metricGranularity>;

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatter = (zone: string): Intl.DateTimeFormat => {
  let held = formatters.get(zone);
  if (held === undefined) {
    held = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    formatters.set(zone, held);
  }
  return held;
};

/** The wall clock an instant reads as, in a zone. */
function wallClock(at: number, zone: string): Parts {
  const read: Record<string, string> = {};
  for (const part of formatter(zone).formatToParts(new Date(at))) {
    if (part.type !== "literal") read[part.type] = part.value;
  }
  return {
    year: Number(read.year),
    // `hour` reads `24` at midnight under some ICU versions, which is the same instant as `0`.
    month: Number(read.month),
    day: Number(read.day),
    hour: Number(read.hour) % 24,
    minute: Number(read.minute),
  };
}

/** How far the zone is from UTC at an instant, in milliseconds. */
const offset = (at: number, zone: string): number => {
  const local = wallClock(at, zone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - at;
};

/**
 * The instant a wall clock reads at, in a zone.
 *
 * Two passes, because the offset to subtract is the one in force at the answer rather than at the
 * guess, and the two differ exactly across a transition. An hour that a zone skips has no instant
 * and this lands on the one after it; an hour a zone repeats has two and this takes the first,
 * which is the convention every calendar makes and is worth knowing about rather than discovering.
 */
function instantOf(parts: Parts, zone: string): number {
  const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const first = local - offset(local, zone);
  return local - offset(first, zone);
}

/** MET-20, MET-7 — the start of the bucket an instant falls in. */
export function startOf(at: number, granularity: Granularity, zone: string): number {
  const local = wallClock(at, zone);
  const midnight = { ...local, hour: 0, minute: 0 };

  if (granularity === "hour") return instantOf({ ...local, minute: 0 }, zone);
  if (granularity === "day") return instantOf(midnight, zone);
  if (granularity === "month") return instantOf({ ...midnight, day: 1 }, zone);
  if (granularity === "year") return instantOf({ ...midnight, month: 1, day: 1 }, zone);

  // MET-7: the ISO 8601 week, beginning Monday. The weekday is read off the local date rather than
  // off the instant, because the two disagree either side of midnight in most of the world.
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const back = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - back));
  return instantOf(
    {
      year: monday.getUTCFullYear(),
      month: monday.getUTCMonth() + 1,
      day: monday.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    zone,
  );
}

/** MET-13 — the end of a bucket, which is the start of the next one and is carried, not derived. */
export function endOf(start: number, granularity: Granularity, zone: string): number {
  const local = wallClock(start, zone);
  const next =
    granularity === "hour"
      ? { ...local, hour: local.hour + 1 }
      : granularity === "day"
        ? { ...local, day: local.day + 1 }
        : granularity === "week"
          ? { ...local, day: local.day + 7 }
          : granularity === "month"
            ? { ...local, month: local.month + 1 }
            : { ...local, year: local.year + 1 };
  // `Date.UTC` normalises a 32nd of January or a 13th month, so nothing here needs a calendar.
  return instantOf(next, zone);
}

/**
 * MET-11, MET-12 — the whole buckets a half-open interval covers.
 *
 * Whole or not at all: a read starting mid-bucket gets the buckets whose START falls in the
 * interval, so two adjacent reads share a boundary instant and no bucket is answered twice.
 */
export function bucketsIn(
  from: number,
  to: number,
  granularity: Granularity,
  zone: string,
): { start: number; end: number }[] {
  const buckets: { start: number; end: number }[] = [];
  let start = startOf(from, granularity, zone);
  if (start < from) start = endOf(start, granularity, zone);

  // A bound rather than a `while (true)`: a zone or a granularity that failed to advance would
  // otherwise hang a Worker on a request, which is a worse failure than a short answer.
  for (let n = 0; n < 10_000 && start < to; n++) {
    const end = endOf(start, granularity, zone);
    if (end <= start) break;
    buckets.push({ start, end });
    start = end;
  }
  return buckets;
}

/**
 * An RFC 3339 instant carrying an offset, which is what MET-13, TASK-28, ALRT-3 and ACTV-3 travel
 * as. It takes whichever of the two a caller already holds, so that reaching it never costs a
 * `new Date` or a `.getTime()` at the call site.
 */
export const rfc3339 = (at: number | Date): string =>
  (at instanceof Date ? at : new Date(at)).toISOString().replace(/\.\d{3}Z$/, "Z");

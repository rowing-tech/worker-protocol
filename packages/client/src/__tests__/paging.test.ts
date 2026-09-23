import { type LogQuery, type LogRecord, mount } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { Refused } from "../call.ts";
import { consume } from "../index.ts";

/**
 * Reading one page at a time, and `logs` — against a real `mount()`, over one `fetch`.
 *
 * `consumer-rules.test.ts` stubs the Worker so that it can misbehave on purpose. This file is about
 * the two halves agreeing: the cursor `mount()` mints is the one `page()` hands back, the level and
 * interval `logs` sends are the ones `mount()` decodes, and a cursor the Worker will not honour is
 * refused as a `reject` the caller can act on.
 */

const THING = "tech.rowing.test.a-thing";

/** Five records, oldest first in the store; LOG-3 has them answered newest first. */
const RECORDS: (LogRecord & { seq: number })[] = [
  { seq: 1, at: new Date("2026-09-21T10:00:00Z"), level: "debug", message: "one" },
  { seq: 2, at: new Date("2026-09-21T10:01:00Z"), level: "info", message: "two" },
  { seq: 3, at: new Date("2026-09-21T10:02:00Z"), level: "warn", message: "three" },
  { seq: 4, at: new Date("2026-09-21T10:03:00Z"), level: "error", message: "four" },
  { seq: 5, at: new Date("2026-09-21T10:04:00Z"), level: "info", message: "five" },
];

/** What the Worker's store was asked, so a test can see what `logs` sent through `mount()`. */
const asked: LogQuery[] = [];

/**
 * A store keyed on something that only grows, which is how ENDP-33 comes free (spec/logs.md). The
 * cursor is this store's own — `below:<seq>` — and anything else is refused, as ENDP-21 allows.
 */
const readLogs = (query: LogQuery) => {
  asked.push(query);
  let below = Number.POSITIVE_INFINITY;
  if (query.cursor !== undefined) {
    const match = /^below:(\d+)$/.exec(query.cursor);
    if (match === null) {
      return { code: "invalid_parameter" as const, message: "Not a cursor this Worker minted." };
    }
    below = Number(match[1]);
  }
  const held = RECORDS.filter(
    (one) =>
      one.seq < below &&
      query.levels.includes(one.level) &&
      (query.from === undefined || one.at >= query.from) &&
      (query.to === undefined || one.at < query.to),
  ).reverse();
  const records = held.slice(0, query.limit).map(({ seq: _seq, ...record }) => record);
  const last = held[query.limit - 1];
  return held.length > query.limit && last !== undefined
    ? { records, nextCursor: `below:${last.seq}` }
    : { records };
};

/** More Alerts than one page carries (ENDP-19's default cap is 50), so a second page exists. */
const ALERTS = Array.from({ length: 51 }, (_, index) => ({
  id: `a-${String(index).padStart(2, "0")}`,
  severity: "warning" as const,
  since: new Date("2026-09-21T00:00:00Z"),
  summary: `alert ${index}`,
  actions: [],
}));

const recorder = mount({
  id: "tech.rowing.test.recorder",
  logs: { pageSize: 2, read: readLogs },
  alerts: () => ALERTS,
  activity: () => [],
  tasks: {
    raises: { [THING]: { payload: z.object({}), answeredBy: "count" } },
    pageSize: 1,
    current: () => [
      { id: "t-1", type: THING, payload: {}, since: new Date(0) },
      { id: "t-2", type: THING, payload: {}, since: new Date(0) },
    ],
  },
});

const client = () =>
  consume("https://recorder.invalid/", {
    fetch: ((url: string, init?: RequestInit) =>
      recorder.fetch(new Request(url, init))) as typeof fetch,
  });

describe("logs", () => {
  it("is offered where the Worker declares it, and absent where it does not", async () => {
    expect((await client()).logs).toBeDefined();
    const quiet = mount({ id: "tech.rowing.test.quiet" });
    const consumed = await consume("https://quiet.invalid", {
      fetch: ((url: string, init?: RequestInit) =>
        quiet.fetch(new Request(url, init))) as typeof fetch,
    });
    expect(consumed.logs).toBeUndefined();
  });

  it("read() answers the whole window, most recent first, in the order it arrived (LOG-3, LOG-6)", async () => {
    const records = await (await client()).logs?.read();
    expect(records?.map((one) => one.message)).toEqual(["five", "four", "three", "two", "one"]);
  });

  it("passes the level floor and the interval through (LOG-7, LOG-8)", async () => {
    asked.length = 0;
    const records = await (await client()).logs?.read({
      level: "warn",
      from: new Date("2026-09-21T10:02:00Z"),
      to: new Date("2026-09-21T10:04:00Z"),
    });
    // The floor reached the Worker as the ladder above it — decoded by mount(), not by this client.
    expect(asked[0]?.levels).toEqual(["warn", "error"]);
    expect(asked[0]?.from?.toISOString()).toBe("2026-09-21T10:02:00.000Z");
    expect(asked[0]?.to?.toISOString()).toBe("2026-09-21T10:04:00.000Z");
    expect(records?.map((one) => one.message)).toEqual(["four", "three"]);
  });

  it("page() answers one page and the cursor, and resumes from exactly that cursor (ENDP-21)", async () => {
    const logs = (await client()).logs;
    const first = await logs?.page();
    expect(first?.items.map((one) => one.message)).toEqual(["five", "four"]);
    expect(first?.nextCursor).toBe("below:4");

    // What a stateless caller does: keeps the string, and hands it back on a later invocation.
    asked.length = 0;
    const second = await logs?.page({ cursor: first?.nextCursor });
    expect(asked[0]?.cursor).toBe("below:4");
    expect(second?.items.map((one) => one.message)).toEqual(["three", "two"]);

    const last = await logs?.page({ cursor: second?.nextCursor });
    expect(last?.items.map((one) => one.message)).toEqual(["one"]);
    // ENDP-20: absent at the end — absent, not null.
    expect(last && "nextCursor" in last).toBe(false);
  });

  it("a cursor the Worker will not honour is Refused as a reject, on the first answer", async () => {
    const refusal = await (await client()).logs
      ?.page({ cursor: "kept-since-last-week" })
      .catch((thrown: unknown) => thrown);
    expect(refusal).toBeInstanceOf(Refused);
    expect((refusal as Refused).kind).toBe("reject");
    expect((refusal as Refused).code).toBe("invalid_parameter");
  });
});

describe("page() beside every list", () => {
  it("alerts: still a function, with page() attached", async () => {
    const alerts = (await client()).alerts;
    expect(await alerts?.()).toHaveLength(51);

    const first = await alerts?.page();
    expect(first?.items).toHaveLength(50);
    expect(first?.nextCursor).toBeTypeOf("string");
    const second = await alerts?.page({ cursor: first?.nextCursor });
    expect(second?.items.map((one) => one.id)).toEqual(["a-50"]);
    expect(second && "nextCursor" in second).toBe(false);
  });

  it("alerts: a cursor mount() did not mint is Refused as a reject", async () => {
    const refusal = await (await client()).alerts
      ?.page({ cursor: "not-minted-here" })
      .catch((thrown: unknown) => thrown);
    expect(refusal).toBeInstanceOf(Refused);
    expect((refusal as Refused).kind).toBe("reject");
    expect((refusal as Refused).code).toBe("invalid_parameter");
  });

  it("activity: still a function, with page() attached", async () => {
    const activity = (await client()).activity;
    expect(await activity?.()).toEqual([]);
    expect(await activity?.page()).toEqual({ items: [] });
  });

  it("tasks: page() takes the type filter and the cursor together", async () => {
    const tasks = (await client()).tasks;
    const first = await tasks?.page({ type: THING });
    expect(first?.items.map((one) => one.id)).toEqual(["t-1"]);
    const second = await tasks?.page({ type: THING, cursor: first?.nextCursor });
    expect(second?.items.map((one) => one.id)).toEqual(["t-2"]);
    expect(second && "nextCursor" in second).toBe(false);
  });
});

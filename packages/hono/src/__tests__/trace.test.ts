import { describe, expect, it } from "vitest";
import * as z from "zod";
import { action } from "../actions.ts";
import type { LogRecord } from "../logs.ts";
import { mount } from "../mount.ts";
import { parseTraceparent, SPAN_ID, TRACE_ID, type Trace, traceparentOf } from "../trace.ts";

/**
 * ENDP-42, LOG-11 and LOG-12 as `mount()` serves them: the trace a call belongs to, continued
 * from `traceparent` or begun here, handed to the Worker, carried by the records it writes, and
 * asked for on a read.
 */

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT = "00f067aa0ba902b7";

describe("parseTraceparent", () => {
  it("reads version 00, and treats what W3C says is invalid as absent", () => {
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-01`)).toEqual({
      traceId: TRACE,
      parentSpanId: PARENT,
      sampled: true,
    });
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-00`)?.sampled).toBe(false);
    // A later version may carry more after the flags, which a `00` reader passes over.
    expect(parseTraceparent(`01-${TRACE}-${PARENT}-01-more`)?.traceId).toBe(TRACE);
    for (const invalid of [
      undefined,
      null,
      "",
      "not-a-traceparent",
      `00-${TRACE}-${PARENT}-01-more`,
      `ff-${TRACE}-${PARENT}-01`,
      `00-${"0".repeat(32)}-${PARENT}-01`,
      `00-${TRACE}-${"0".repeat(16)}-01`,
      `00-${TRACE.toUpperCase()}-${PARENT}-01`,
    ]) {
      expect(parseTraceparent(invalid), String(invalid)).toBeUndefined();
    }
  });
});

describe("mount(), the trace a call belongs to (ENDP-42, LOG-11, LOG-12)", () => {
  const records: LogRecord[] = [];
  const app = mount({
    id: "tech.rowing.worker-protocol.trace",
    authenticate: () => "accepted",
    actions: {
      accepts: {
        echo: action({
          input: z.object({}),
          result: z.object({
            traceId: z.string(),
            spanId: z.string(),
            parentSpanId: z.string().optional(),
            sampled: z.boolean(),
            tracestate: z.string().optional(),
          }),
          run: (_input, call) => {
            records.push({
              at: new Date(),
              level: "info",
              message: "echoed",
              traceId: call.trace.traceId,
              spanId: call.trace.spanId,
            });
            return call.trace;
          },
        }),
      },
    },
    logs: {
      read: ({ trace }) => ({
        records: records.filter((one) => trace === undefined || one.traceId === trace).reverse(),
      }),
    },
  });
  const perform = (headers: Record<string, string> = {}) =>
    app.fetch(
      new Request("http://worker.invalid/actions?action=echo", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{}",
      }),
    );
  const read = (query: string) => app.fetch(new Request(`http://worker.invalid/logs${query}`));

  it("continues the trace `traceparent` names, in a span of the Worker's own", async () => {
    const answer = await perform({ traceparent: `00-${TRACE}-${PARENT}-01` });
    expect(answer.status).toBe(200);
    const trace = (await answer.json()) as Trace;
    expect(trace.traceId).toBe(TRACE);
    expect(trace.parentSpanId).toBe(PARENT);
    expect(trace.spanId).toMatch(SPAN_ID);
    expect(trace.spanId).not.toBe(PARENT);
    expect(trace.sampled).toBe(true);
    // ENDP-43: what this Worker sends on to the next one names its own span as the parent.
    expect(traceparentOf(trace)).toBe(`00-${TRACE}-${trace.spanId}-01`);
  });

  it("begins one where no header came, and where the one that came cannot be read", async () => {
    const begun = (await (await perform()).json()) as Trace;
    expect(begun.traceId).toMatch(TRACE_ID);
    expect(begun.spanId).toMatch(SPAN_ID);
    expect(begun.parentSpanId).toBeUndefined();

    const restarted = await perform({ traceparent: "not-a-traceparent" });
    expect(restarted.status).toBe(200);
    expect(((await restarted.json()) as Trace).traceId).not.toBe(TRACE);
  });

  it("passes `tracestate` on untouched, and reads nothing from it", async () => {
    const answer = await perform({
      traceparent: `00-${TRACE}-${PARENT}-01`,
      tracestate: "vendor=opaque",
    });
    expect(((await answer.json()) as Trace).tracestate).toBe("vendor=opaque");
  });

  it("answers the records of one trace, and refuses a `trace` of another form", async () => {
    const ofTrace = await read(`?trace=${TRACE}`);
    expect(ofTrace.status).toBe(200);
    const page = (await ofTrace.json()) as { items: { traceId?: string; spanId?: string }[] };
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((one) => one.traceId === TRACE && SPAN_ID.test(one.spanId ?? ""))).toBe(
      true,
    );
    // The calls begun under traces of their own are there too, under other ids.
    const all = (await (await read("")).json()) as { items: unknown[] };
    expect(all.items.length).toBeGreaterThan(page.items.length);

    const refused = await read(`?trace=${TRACE.toUpperCase()}`);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { code: string }).code).toBe("invalid_parameter");
  });
});

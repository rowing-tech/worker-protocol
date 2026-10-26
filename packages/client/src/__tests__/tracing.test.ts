import { action, type Trace as Continued, mount } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { beginTrace, consume } from "../index.ts";

/**
 * ENDP-43 from the consumer's side: every call carries `traceparent`, in the trace the caller
 * handed in or in one begun for the call alone, and a read of `logs` asks for one trace (LOG-12).
 * Against a Worker on `mount()`, which answers the trace it was handed; nothing crosses a socket.
 */

const app = mount({
  id: "tech.rowing.worker-protocol.tracing",
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
        }),
        run: (_input, call) => call.trace,
      }),
    },
  },
  logs: {
    read: ({ trace }) => ({
      records:
        trace === undefined
          ? []
          : [
              {
                at: new Date(),
                level: "info",
                message: "of that trace",
                traceId: trace,
                spanId: "00f067aa0ba902b7",
              },
            ],
    }),
  },
});

const consumer = () =>
  consume("https://worker.example.com", {
    credential: "c",
    fetch: ((url: string, init?: RequestInit) =>
      app.fetch(new Request(url, init))) as unknown as typeof globalThis.fetch,
  });

describe("ENDP-43: every call names the trace it is made in", () => {
  it("performs under the trace it was handed, in a span of this call's own", async () => {
    const trace = beginTrace();
    const continued = (await (
      await consumer()
    ).actions?.perform("echo", {}, { trace })) as Continued;
    expect(continued.traceId).toBe(trace.traceId);
    // The parent the Worker saw is the span this call opened, not the caller's own span.
    expect(continued.parentSpanId).toMatch(/^[0-9a-f]{16}$/);
    expect(continued.parentSpanId).not.toBe(trace.spanId);
  });

  it("begins a trace for a call handed none, so the Worker still records under one", async () => {
    const continued = (await (await consumer()).actions?.perform("echo", {})) as Continued;
    expect(continued.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(continued.parentSpanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("asks `logs` for the records of one trace (LOG-12)", async () => {
    const trace = beginTrace();
    const records = await (await consumer()).logs?.read({ trace: trace.traceId });
    expect(records?.map((one) => one.traceId)).toEqual([trace.traceId]);
  });
});

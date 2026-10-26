/**
 * ENDP-42, LOG-11: the trace a call belongs to, read from `traceparent` or begun here.
 *
 * W3C Trace Context is what an HTTP server instrumented with OpenTelemetry does on every request,
 * and this is that convention and nothing more: continue the trace the caller named, in a span of
 * this Worker's own, or begin one where no header came or the one that came cannot be read. A
 * header that cannot be read never refuses a request — the specification says to *restart the
 * trace*, and a Worker that answered `400` to it would turn a tracing bug upstream into an outage
 * here.
 *
 * **Nothing here is a tracer.** No span is ended, no duration is measured, nothing is exported.
 * What a Worker gets is the two ids a record carries (LOG-11) and the header to send on when it
 * calls another Worker, so that the trace crosses. A Worker that runs OpenTelemetry hands
 * `call.trace` to its own tracer as the parent and records under the innermost span it opens; one
 * that does not records under the span opened here, and that is enough for a console to group a
 * call's lines and for an operator to find the trace in whatever backend the Worker's builders run.
 */

import { spanId, traceId, traceparent } from "@worker-protocol/schemas";

export type Trace = {
  /** Thirty-two lowercase hexadecimal digits: the trace this call belongs to. */
  traceId: string;
  /** Sixteen lowercase hexadecimal digits: this Worker's span for this call. */
  spanId: string;
  /** The caller's span, where `traceparent` named one. */
  parentSpanId?: string;
  /** The sampled flag as the caller sent it, or `true` for a trace begun here. */
  sampled: boolean;
  /** `tracestate` as it arrived, to send on untouched. Nothing here reads it. */
  tracestate?: string;
};

// The two ids inside are `TRACE_ID` and `SPAN_ID` from `@worker-protocol/schemas`, unanchored.
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(?:-(.*))?$/;

const allZeros = (id: string) => /^0+$/.test(id);

/**
 * `traceparent`, read: the trace, the caller's span and the sampled flag — or `undefined` for a
 * header that is absent or cannot be read, which W3C says to treat alike.
 *
 * Version `ff` is forbidden; version `00` admits nothing after the flags, and a later version may
 * carry more, which a `00` reader passes over. A trace id or a parent id of all zeros is invalid.
 */
export const parseTraceparent = (
  header: string | null | undefined,
): { traceId: string; parentSpanId: string; sampled: boolean } | undefined => {
  if (header === null || header === undefined) return undefined;
  const found = TRACEPARENT.exec(header.trim());
  if (found === null) return undefined;
  const [, version, traceId, parentSpanId, flags, rest] = found;
  if (version === "ff" || (version === "00" && rest !== undefined)) return undefined;
  if (traceId === undefined || parentSpanId === undefined || flags === undefined) return undefined;
  if (allZeros(traceId) || allZeros(parentSpanId)) return undefined;
  return { traceId, parentSpanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
};

/**
 * ENDP-42: the trace a request belongs to — the one its `traceparent` names, continued in a span
 * of this Worker's own, or one begun here. For `mount()`, and for a Worker that wraps `mount()` and
 * records on its own account, as `conformance/reference-worker` does.
 */
export const traceOf = (source: Request | Headers): Trace => {
  const headers = source instanceof Headers ? source : source.headers;
  const span = spanId();
  const named = parseTraceparent(headers.get("traceparent"));
  if (named === undefined) return { traceId: traceId(), spanId: span, sampled: true };
  const tracestate = headers.get("tracestate");
  return {
    traceId: named.traceId,
    spanId: span,
    parentSpanId: named.parentSpanId,
    sampled: named.sampled,
    ...(tracestate === null ? {} : { tracestate }),
  };
};

/**
 * ENDP-42, ENDP-43: the headers that carry this trace to the next party — `traceparent` naming this
 * span as the parent, and `tracestate` exactly as it arrived, so a vendor's state crosses a chain of
 * Workers untouched. Spread into the headers of any call a Worker makes to another.
 */
export const traceHeadersOf = (
  trace: Pick<Trace, "traceId" | "spanId" | "sampled" | "tracestate">,
): { traceparent: string; tracestate?: string } => ({
  traceparent: traceparent(trace),
  ...(trace.tracestate === undefined ? {} : { tracestate: trace.tracestate }),
});

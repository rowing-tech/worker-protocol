/**
 * ENDP-43: the trace a consumer propagates, and the span it opens for each call it makes.
 *
 * What an HTTP client instrumented with OpenTelemetry does: every outbound request carries
 * `traceparent`, naming the trace the caller is in and a span of the caller's own for this call.
 * A caller that holds no trace is given one per call, so a Worker on the other side still records
 * under an id — and a Tower that wants to read those records back mints the trace itself with
 * `beginTrace()`, hands it to the call, and asks `logs` for it (LOG-12).
 */

import { spanId, traceId, traceparent } from "@worker-protocol/schemas";

/** A trace a consumer holds: the id, and the span it is in. */
export type Trace = {
  /** Thirty-two lowercase hexadecimal digits. */
  traceId: string;
  /** Sixteen lowercase hexadecimal digits: the consumer's own span. */
  spanId: string;
  /** Whether the trace is sampled; `true` unless said otherwise. */
  sampled?: boolean;
};

/** A trace of the consumer's own, to perform under and to ask `logs` for afterwards. */
export const beginTrace = (): Trace => ({ traceId: traceId(), spanId: spanId(), sampled: true });

/**
 * The `traceparent` one call sends: in `parent`'s trace, or in one begun for this call alone, and
 * naming a fresh span either way — the span is this call's, not the caller's.
 */
export const traceparentFor = (parent?: Pick<Trace, "traceId" | "sampled">): string =>
  traceparent({
    traceId: parent?.traceId ?? traceId(),
    spanId: spanId(),
    ...(parent?.sampled === undefined ? {} : { sampled: parent.sampled }),
  });

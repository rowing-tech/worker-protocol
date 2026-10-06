/**
 * The receiving end of `subscriptions`: what a consumer serves at the address it handed a Worker.
 *
 * A Convex HTTP action, a Tower's endpoint, an automation's webhook — each has a `Request` and must
 * answer a `Response`, and each would otherwise write the same four things by hand. The handshake a
 * Worker runs before storing a subscription (SUB-10); the credential it presents on every delivery
 * (SUB-11), which is the only thing that tells this sink's deliveries from anybody's who learned its
 * URL; the structured CloudEvent itself; and deduplication by `source` and `id` (EVT-8), because
 * delivery is at least once (SUB-12) and a consumer that has not remembered an id sees an event
 * twice.
 *
 * What the answers mean to the Worker is SUB-12's: a `2xx` is a delivery, a `5xx` is retried, and
 * any other `4xx` is final for that event. So a delivery this sink refuses on its credential or its
 * shape is answered `4xx` — repeating it would not change it — and one whose handler threw is
 * answered `500`, so the Worker tries again.
 */

/** A CloudEvent as it arrives in structured mode: the attributes and `data` in one object. */
export type ReceivedEvent = {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  subject?: string;
  time?: string;
  data?: unknown;
  /** Extension attributes, such as EVT-15's `tasktype` and `alertseverity`. */
  [attribute: string]: unknown;
};

/**
 * Where a sink remembers which events it has handled, for at least EVT-8's window.
 *
 * `claim` takes a key in one operation and answers whether this caller is the first to — the same
 * shape as an outcome store's `begin`, for the same reason: a read then a write lets two deliveries
 * of one event, arriving together, both through. `release` gives a key back when its handler threw,
 * so the Worker's retry is handled rather than mistaken for a repeat. A Convex table, a KV namespace
 * with a time-to-live or a Durable Object is a store; `memorySeen()` is one for a single process.
 */
export type SeenStore = {
  claim: (key: string, untilMs: number) => boolean | Promise<boolean>;
  release: (key: string) => void | Promise<void>;
};

export type SinkOptions = {
  /** SUB-11. The credential this sink handed the Worker as `sinkCredential`. */
  credential: string;
  /**
   * SUB-10. The Worker ids this sink accepts: the origin a Worker names in the handshake, and the
   * `source` of every event it delivers (EVT-1). Anything else is refused.
   */
  origins: string[];
  /**
   * EVT-8. How long to remember an event: at least the longest `republishWindowSeconds` among the
   * Workers this sink subscribed to. Outside it, the same `source` and `id` will not come again.
   */
  windowSeconds: number;
  /** Where handled events are remembered. Defaults to `memorySeen()`, right in one process only. */
  seen?: SeenStore;
  /** What to do with an event, once — called after its credential, shape and novelty are checked. */
  onEvent: (event: ReceivedEvent) => void | Promise<void>;
};

const answer = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

/** EVT-1: the attributes a CloudEvent cannot be without, as strings. */
const isEvent = (value: unknown): value is ReceivedEvent => {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.specversion === "1.0" &&
    typeof event.id === "string" &&
    typeof event.source === "string" &&
    typeof event.type === "string"
  );
};

/** A store in memory: right in one long-lived process, and wrong anywhere that runs more than one. */
export const memorySeen = (): SeenStore => {
  const held = new Map<string, number>();
  return {
    claim: (key, untilMs) => {
      const until = held.get(key);
      if (until !== undefined && until > Date.now()) return false;
      held.set(key, untilMs);
      return true;
    },
    release: (key) => void held.delete(key),
  };
};

/**
 * A handler for the sink's address: `(request) => Response`, ready for any runtime's HTTP route.
 *
 * Build it once where the store outlives a request, or per request where `onEvent` needs what only
 * the request has — a Convex action's `ctx` — and hand it a store that outlives both.
 */
export function sink(options: SinkOptions): (request: Request) => Promise<Response> {
  const origins = new Set(options.origins);
  const seen = options.seen ?? memorySeen();

  return async (request) => {
    // SUB-10: the handshake. Allowed, it names the origin back; refused, it names nothing, and the
    // Worker stores no subscription that would deliver here.
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("webhook-request-origin");
      return origin !== null && origins.has(origin)
        ? answer(200, { "webhook-allowed-origin": origin, allow: "POST" })
        : answer(403);
    }
    if (request.method !== "POST") return answer(405, { allow: "OPTIONS, POST" });

    // SUB-11: the sink's own credential, presented by the Worker. Without it, anybody who learned
    // this URL could post here.
    if (request.headers.get("authorization") !== `Bearer ${options.credential}`) return answer(401);

    // SUB-11: structured mode — the whole event in one JSON body.
    const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/cloudevents+json") return answer(415);
    let event: unknown;
    try {
      event = JSON.parse(await request.text());
    } catch {
      return answer(400);
    }
    if (!isEvent(event)) return answer(400);
    if (!origins.has(event.source)) return answer(403);

    // EVT-8: `source` with `id` identifies one event, and a repeat inside the window is
    // acknowledged and not handled again. The key keeps the two apart whatever either contains.
    const key = JSON.stringify([event.source, event.id]);
    const first = await seen.claim(key, Date.now() + options.windowSeconds * 1000);
    if (!first) return answer(200);
    try {
      await options.onEvent(event);
    } catch {
      // Given back, so the Worker's retry (SUB-12) is handled rather than mistaken for a repeat.
      await seen.release(key);
      return answer(500);
    }
    return answer(200);
  };
}

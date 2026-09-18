/**
 * Every exchange the verifier had with the Worker, kept so that the cross-cutting rules can be
 * judged over all of them.
 *
 * Several rules in [endpoints](../../../spec/endpoints.md) are about *every* response rather than
 * about one surface — ENDP-5 puts two headers on all of them, ENDP-26 forbids one code arriving
 * under two statuses, which is a statement no single response can break. A verifier that checked
 * those inside each surface's own check would be asking a question it could not answer, so the
 * exchanges are collected first and the cross-cutting checks run last, over the whole record.
 */

export type Exchange = {
  url: string;
  method: string;
  status: number;
  headers: Headers;
  /** The raw body, so that a check can report what failed to parse rather than that it did. */
  body: string;
  /** The parsed body, or null where it is not JSON. */
  json: unknown;
  /** What the verifier was doing, for a report that has to say why a response was provoked. */
  intent: string;
  /**
   * Whether the verifier knows this request is wrong in a way that will not change.
   *
   * ENDP-11 forbids a `5xx` for a condition that will not change, and its witness is ordinarily
   * out of reach: nothing outside a Worker can tell a transient fault from a permanent one. But a
   * verifier holds one fact nobody else does — it knows which of its own requests were deliberately
   * and permanently wrong, because it made them that way. An Action no entry declares will never
   * exist; a filter no surface knows will never be recognised; a credential never issued will
   * never be accepted. A `5xx` to any of those is the rule broken, with no arrangement needed.
   */
  permanent: boolean;
};

export type Transcript = {
  exchanges: Exchange[];
  /** Performs a request, records it, and returns it. A network failure throws, as fetch does. */
  send: (
    url: string,
    intent: string,
    init?: RequestInit & { permanent?: boolean },
  ) => Promise<Exchange>;
};

export type Sender = typeof globalThis.fetch;

export function transcript(send: Sender, credential?: string): Transcript {
  const exchanges: Exchange[] = [];

  return {
    exchanges,
    async send(url, intent, init = {}) {
      // REG-3: a credential is presented as `Authorization: Bearer <token>`, and this protocol
      // fixes nothing else about it. A caller that presented it anywhere else would produce a call
      // that cannot complete however good either party's intentions are.
      const headers = new Headers(init.headers);
      if (credential !== undefined && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${credential}`);
      }

      const { permanent = false, ...request } = init;
      const response = await send(url, { ...request, headers, redirect: "manual" });
      const body = await response.text();

      let json: unknown = null;
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }

      const exchange: Exchange = {
        url,
        method: init.method ?? "GET",
        status: response.status,
        headers: response.headers,
        body,
        json,
        intent,
        permanent,
      };
      exchanges.push(exchange);
      return exchange;
    },
  };
}

/** `application/json; charset=utf-8` and `application/json` are the same media type (ENDP-4). */
export const isJson = (headers: Headers): boolean =>
  (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() === "application/json";

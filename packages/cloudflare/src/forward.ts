import { CODES } from "@worker-protocol/hono";
import { EDITION } from "@worker-protocol/schemas";

/**
 * A request handed on to the Durable Object that answers it with `mount()`, from the Worker in
 * front of it.
 *
 * Serving `mount()` from inside the object makes every store call local and costs the request one
 * round trip (the package README says why). Forwarding is then the whole of the entrypoint's part,
 * and the two ways it went wrong on a deployed Worker are both here.
 *
 * **The body is read before it is forwarded.** Handed on as a stream, a body `mount()` never reads —
 * a `401` is answered before it — is left behind when the response is sent, and the runtime records
 * `Can't read from request stream after response has been sent` on every such call.
 *
 * **A forward that fails is answered in the error envelope, `503 unavailable`.** The object is
 * reached over the network, and once in a while the connection is lost before it answers: on a
 * deployed Worker, after thirteen seconds, with the object never seeing the request. Thrown from
 * here, that is the runtime's own `500` in plain text, which no caller can classify (ENDP-39) and
 * which ENDP-13 then has it treat as `reject` — stopping a call that would have succeeded on the
 * next try. `unavailable` is `retry`, and says what happened: nothing here can answer now.
 *
 * **It does not retry**, because it cannot tell what is safe to. A read is, and the caller retries
 * it anyway. An Action under an idempotency key is safe for the caller to repeat, because the key is
 * what makes it so (ENDP-16). An Action without one may have reached the object or not, and the one
 * party able to decide whether to try again is the caller, which knows what it asked for.
 */
export async function forward(given: {
  /** The object's stub, whose `fetch` answers with `mount()`. */
  to: { fetch: (request: Request) => Promise<Response> };
  request: Request;
  /** The edition the Worker declares, for ENDP-37's header on the refusal; this package's if absent. */
  edition?: string;
}): Promise<Response> {
  const { to, request } = given;
  const body =
    request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  try {
    return await to.fetch(new Request(request, { body }));
  } catch {
    return unavailable(given.edition ?? EDITION);
  }
}

/** ENDP-39's envelope for `unavailable`, with its status and class from the closed vocabulary. */
const unavailable = (edition: string): Response => {
  const row = CODES.find((one) => one.code === "unavailable");
  return new Response(
    JSON.stringify({
      code: "unavailable",
      class: row?.class ?? "retry",
      message: "The object that answers this Worker could not be reached.",
    }),
    {
      status: row?.status ?? 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "worker-protocol-edition": edition,
      },
    },
  );
};

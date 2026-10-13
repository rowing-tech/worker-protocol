import { describe, expect, it } from "vitest";
import { forward } from "../src/index.ts";

/**
 * The entrypoint's half of serving `mount()` from inside a Durable Object, and the two ways it went
 * wrong on a deployed Worker: a body left unread behind a response, and a lost connection answered
 * by the runtime's plain-text `500` instead of the protocol's envelope.
 */

const POST = () =>
  new Request("https://worker.invalid/actions?action=record", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "k-1" },
    body: JSON.stringify({ vehicle: "ABC-123" }),
  });

describe("forward()", () => {
  it("hands the object the request whole, body and headers, already read", async () => {
    let seen: { url: string; key: string | null; body: string } | undefined;
    const answer = await forward({
      to: {
        fetch: async (request) => {
          seen = {
            url: request.url,
            key: request.headers.get("idempotency-key"),
            body: await request.text(),
          };
          return new Response(null, { status: 204 });
        },
      },
      request: POST(),
    });
    expect(answer.status).toBe(204);
    expect(seen).toEqual({
      url: "https://worker.invalid/actions?action=record",
      key: "k-1",
      body: JSON.stringify({ vehicle: "ABC-123" }),
    });
  });

  it("answers what the object answered, even when it never read the body", async () => {
    // `mount()` refuses a missing credential before it reads anything, which is the case that left
    // a stream behind the response.
    const answer = await forward({
      to: { fetch: async () => new Response(null, { status: 401 }) },
      request: POST(),
    });
    expect(answer.status).toBe(401);
  });

  it("answers a lost connection `503 unavailable`, `retry`, in the envelope (ENDP-39)", async () => {
    const answer = await forward({
      to: {
        fetch: async () => {
          throw new Error("Network connection lost.");
        },
      },
      request: POST(),
      edition: "0.7",
    });
    expect(answer.status).toBe(503);
    expect(answer.headers.get("worker-protocol-edition")).toBe("0.7");
    expect(await answer.json()).toMatchObject({ code: "unavailable", class: "retry" });
  });

  it("forwards a read with no body at all", async () => {
    let method: string | undefined;
    await forward({
      to: {
        fetch: async (request) => {
          method = request.method;
          return Response.json({ items: [] });
        },
      },
      request: new Request("https://worker.invalid/tasks"),
    });
    expect(method).toBe("GET");
  });
});

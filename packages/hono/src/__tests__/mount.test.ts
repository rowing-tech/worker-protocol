import { EDITION } from "@worker-protocol/schemas";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { mount } from "../mount.ts";

/**
 * What `mount()` promises a Worker author, checked without a socket.
 *
 * The verifier against `examples/reference-worker` is what vouches for `mount()`'s conformance;
 * this holds the two things that test cannot see. A Worker declaring one Capability gets one
 * address and no other, and the app it gets can describe itself — its own routes, under the paths
 * it actually serves — which is the reason the surface is declared as routes at all.
 */

const worker = mount({
  id: "tech.rowing.worker-protocol.test",
  health: () => ({ status: "healthy", checks: {} }),
});

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`http://worker.invalid${path}`, { headers }));

describe("mount()", () => {
  it("serves the Descriptor with only the Capabilities the Worker implements", async () => {
    const response = await get("/.well-known/worker-protocol");
    expect(response.status).toBe(200);
    // ENDP-5 on every response.
    expect(response.headers.get("worker-protocol-edition")).toBe(EDITION);
    const document = (await response.json()) as { capabilities: Record<string, unknown> };
    expect(Object.keys(document.capabilities)).toEqual(["health"]);
  });

  it("answers 404 with the envelope for an address the Worker did not declare", async () => {
    const response = await get("/metrics?metric=x");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found", class: "reject" });
  });

  it("refuses a Capability version it cannot answer, whole (ENDP-6)", async () => {
    const response = await get("/health", { "worker-protocol-capability-version": "2" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "unsupported_version" });
  });

  it("refuses a parameter a surface cannot know (ENDP-24)", async () => {
    const response = await get("/health?verbose=1");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "unknown_filter" });
  });

  it("describes itself: the mounted routes are the Worker's own OpenAPI document", () => {
    const document = worker.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "a Worker", version: "1" },
    });
    // The paths this app serves, not `/` under a variable server: this document describes one
    // Worker at the addresses it has, which is what a Worker author's own tooling wants.
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      "/.well-known/worker-protocol",
      "/health",
    ]);
    expect(Object.keys(document.components?.schemas ?? {})).toContain("health");
  });
});

/**
 * A Worker answered per request, which is what every platform but a long-lived process forces.
 *
 * Cloudflare, Vercel edge and Deno Deploy hand `env` to `fetch` and have nothing at module scope,
 * so a `mount()` that only took a built Worker could not reach a binding at all. What these hold
 * is the two halves of that: the environment of THIS request reaches the Worker, and the state
 * `mount()` owns on the Worker's behalf does not start again with it.
 */
describe("mount(), with the Worker answered per request", () => {
  let performed = 0;
  const perRequest = mount<{ token: string }>((env) => ({
    id: "tech.rowing.worker-protocol.dynamic",
    authenticate: (presented) => (presented === env.token ? "accepted" : "unauthenticated"),
    health: () => ({ status: "healthy", checks: {} }),
    tasks: {
      raises: {
        "tech.rowing.test.a-thing": { payload: {}, answeredBy: ["count"] },
      },
      answers: [],
      open: () => [
        { id: "t-1", type: "tech.rowing.test.a-thing", payload: {}, since: new Date(0) },
      ],
    },
    actions: {
      actions: {
        count: {
          input: z.object({}),
          result: z.object({ n: z.number() }),
          idempotency: { required: true, from: "header", windowSeconds: 60 },
          run: () => {
            performed += 1;
            return { n: performed };
          },
        },
      },
    },
  }));

  const call = (path: string, env: { token: string }, headers: Record<string, string> = {}) =>
    perRequest.fetch(new Request(`http://worker.invalid${path}`, { headers }), env);

  it("reads the credential out of the environment of the request in hand", async () => {
    const withA = await call("/health", { token: "a" }, { authorization: "Bearer a" });
    expect(withA.status).toBe(200);

    // The SAME app, a different environment: the second request is refused because its own env
    // says so, which a Worker built once at module scope could never have expressed.
    const withB = await call("/health", { token: "b" }, { authorization: "Bearer a" });
    expect(withB.status).toBe(401);
  });

  it("serves a Descriptor built from the Worker it resolved", async () => {
    const answer = await call(
      "/.well-known/worker-protocol",
      { token: "a" },
      {
        authorization: "Bearer a",
      },
    );
    const document = (await answer.json()) as { id: string; capabilities: Record<string, unknown> };
    expect(document.id).toBe("tech.rowing.worker-protocol.dynamic");
    expect(Object.keys(document.capabilities).sort()).toEqual(["actions", "health", "tasks"]);
  });

  it("keeps the idempotency window, though the Worker object is a new one each time", async () => {
    // The state `mount()` owns rather than the Worker: a fresh record per request would have made
    // ENDP-16's window start again with every call, so a repeat under the same key would perform
    // the Action a second time while the caller still believed it was protected.
    const env = { token: "a" };
    const headers = { authorization: "Bearer a", "idempotency-key": "k-1" };
    const post = () =>
      perRequest.fetch(
        new Request("http://worker.invalid/actions?action=count", {
          method: "POST",
          body: "{}",
          headers,
        }),
        env,
      );
    expect((await post()).status).toBe(200);
    expect(await (await post()).json()).toEqual({ n: 1 });
  });

  it("answers 404 for a Capability the resolved Worker does not declare", async () => {
    // Every route is registered, because there is no Worker at mount time to ask which to serve.
    // Nothing is lost: ENDP-1 has every reader start from the Descriptor, and this one declares
    // no `metrics`, so no reader of this protocol calls the address at all.
    const answer = await call("/metrics?metric=x", { token: "a" }, { authorization: "Bearer a" });
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ code: "not_found" });
  });
});

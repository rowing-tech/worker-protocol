import { EDITION } from "@worker-protocol/schemas";
import { describe, expect, it } from "vitest";
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

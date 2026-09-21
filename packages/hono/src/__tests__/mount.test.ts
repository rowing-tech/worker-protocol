import { EDITION } from "@worker-protocol/schemas";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { memoryOutcomes, type OutcomeStore, type Recorded } from "../actions.ts";
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
  const outcomes = memoryOutcomes();
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
      // ENDP-16: the store outlives the Worker object, which is the whole point of naming one —
      // `mount()` answers a different Worker on every request and a Map built here would start
      // again with each. This one is built once, above, and closed over.
      outcomes,
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

/**
 * ENDP-16 across more than one process, which is where a Map stops being enough.
 *
 * A Worker that scales horizontally has one Map per isolate, so a repeat under the same key reaches
 * a process that never recorded the first and the Action is performed a second time *while the
 * caller believes it is protected*. Nothing is refused and nobody sees two — which is the silent
 * shape of failure this repository keeps finding, and the third time today.
 */
describe("mount(), with the recorded outcomes somewhere durable", () => {
  it("records into and reads from the store the Worker declared", async () => {
    // A store that stands in for a durable object or a table: what matters is that it is ONE
    // store, and that two Workers built separately — as two isolates would be — share it.
    const shared = new Map<string, Recorded | null>();
    const outcomes: OutcomeStore = {
      begin: (key) => {
        const record = shared.get(key);
        if (record === null) return "in-flight";
        if (record !== undefined) return { held: record };
        shared.set(key, null);
        return "reserved";
      },
      complete: (key, held) => void shared.set(key, held),
      release: (key) => void shared.delete(key),
    };

    let performed = 0;
    const isolate = () =>
      mount({
        id: "tech.rowing.worker-protocol.durable",
        actions: {
          outcomes,
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
      });

    const post = (app: ReturnType<typeof mount>) =>
      app.fetch(
        new Request("http://worker.invalid/actions?action=count", {
          method: "POST",
          body: "{}",
          headers: { "idempotency-key": "k-1" },
        }),
      );

    expect(await (await post(isolate())).json()).toEqual({ n: 1 });

    // A DIFFERENT app object, as a second isolate would be. With the default Map this answers
    // `{ n: 2 }` — the Action performed twice under one key, which is ENDP-16 broken in silence.
    expect(await (await post(isolate())).json()).toEqual({ n: 1 });
    expect(performed).toBe(1);
  });
});

/**
 * The two ways a Worker can fail ENDP-16 without a single request going wrong.
 *
 * Both are refused at the moment somebody can still fix them. Neither is a conformance failure a
 * verifier would find: a tool sees two `200`s and has no way to know the Action ran twice.
 */
describe("mount(), refusing a Worker that cannot keep ENDP-16", () => {
  const keyed = {
    count: {
      input: z.object({}),
      idempotency: { required: true, from: "header", windowSeconds: 60 },
      run: () => undefined,
    },
  } as const;

  it("refuses a Worker handed in whole that names nowhere to record", () => {
    // A shape this app can read before a request exists, so the fault is refused where somebody is
    // still looking at it rather than six weeks later in somebody else's log.
    expect(() => mount({ id: "tech.rowing.test.unrecorded", actions: { actions: keyed } })).toThrow(
      /ENDP-16.*names nowhere to record/s,
    );
  });

  it("says so loudly when the Worker is answered per request, and does not throw", async () => {
    // There is no moment before a request to refuse it in, and throwing inside one would answer
    // `500` — which ENDP-11 forbids for a condition that will not change, and this never will. So
    // it goes to the log, and the Worker serves: broken about ENDP-16 and honest about everything.
    const said: string[] = [];
    const original = console.error;
    console.error = (line: string) => void said.push(line);
    try {
      const app = mount(() => ({ id: "tech.rowing.test.unrecorded", actions: { actions: keyed } }));
      const answer = await app.fetch(new Request("http://worker.invalid/health"), {});
      expect(answer.status).toBe(404);
    } finally {
      console.error = original;
    }
    expect(said.join()).toMatch(/ENDP-16.*names nowhere to record/s);
  });

  it("says so when a memory store is built on every request", async () => {
    // The subtler one, and the one `examples/minimal-worker` walked into: the store is named, and
    // built inside the function that answers the Worker — so it is a new Map per request and
    // forgets what the last one recorded. Obeying the first rule is how you reach this.
    const said: string[] = [];
    const original = console.error;
    console.error = (line: string) => void said.push(line);
    try {
      const app = mount(() => ({
        id: "tech.rowing.test.forgetful",
        actions: { outcomes: memoryOutcomes(), actions: keyed },
      }));
      const call = () => app.fetch(new Request("http://worker.invalid/health"), {});
      await call();
      await call();
    } finally {
      console.error = original;
    }
    expect(said.join()).toMatch(/ENDP-16.*built on every request/s);
  });

  it("allows a Worker that answers a store it built once", async () => {
    const outcomes = memoryOutcomes();
    const perRequest = mount(() => ({
      id: "tech.rowing.test.recorded",
      actions: { outcomes, actions: keyed },
    }));
    const call = () => perRequest.fetch(new Request("http://worker.invalid/health"), {});
    expect((await call()).status).toBe(404);
    expect((await call()).status).toBe(404);
  });
});

/**
 * ENDP-16 when two callers arrive at once under one key.
 *
 * The case a `get` and then a `put` cannot cover, whatever the store is built on: the Action runs
 * between the two calls, so both find nothing recorded and both perform. `begin` takes the key
 * instead, and the second caller is refused rather than served a second performance.
 */
describe("mount(), with two requests under one idempotency key", () => {
  it("performs the Action once and tells the other to come back", async () => {
    let performed = 0;
    let release!: () => void;
    const started = new Promise<void>((done) => {
      release = done;
    });

    const app = mount({
      id: "tech.rowing.test.concurrent",
      actions: {
        outcomes: memoryOutcomes(),
        actions: {
          count: {
            input: z.object({}),
            result: z.object({ n: z.number() }),
            idempotency: { required: true, from: "header", windowSeconds: 60 },
            run: async () => {
              performed += 1;
              // Held open so the second request arrives while this one is still running, which is
              // the only moment the race exists and the one a sequential test never reaches.
              await started;
              return { n: performed };
            },
          },
        },
      },
    });

    const call = () =>
      app.fetch(
        new Request("http://worker.invalid/actions?action=count", {
          method: "POST",
          body: "{}",
          headers: { "idempotency-key": "k-1" },
        }),
      );

    const first = call();
    const second = await call();
    release();

    // ENDP-32: `retry`, so the caller comes back and ENDP-16 answers it the recorded outcome. A
    // `reject` would have told it to stop over a condition that clears itself in a moment.
    expect(second.status).toBe(503);
    expect(await second.json()).toMatchObject({ code: "unavailable", class: "retry" });
    expect(await (await first).json()).toEqual({ n: 1 });
    expect(performed).toBe(1);
  });

  it("gives the key back when the Action refuses, so the next caller may take it", async () => {
    // A refusal is not an outcome. A reservation kept over one would lock the Action out for the
    // whole window over something that never happened.
    let attempts = 0;
    const app = mount({
      id: "tech.rowing.test.refusing",
      actions: {
        outcomes: memoryOutcomes(),
        actions: {
          fussy: {
            input: z.object({ ok: z.boolean() }),
            result: z.object({ n: z.number() }),
            idempotency: { required: true, from: "header", windowSeconds: 60 },
            run: ({ ok }: { ok: boolean }) => {
              attempts += 1;
              return ok
                ? { n: attempts }
                : { code: "unprocessable_content" as const, message: "no" };
            },
          },
        },
      },
    });

    const call = (ok: boolean) =>
      app.fetch(
        new Request("http://worker.invalid/actions?action=fussy", {
          method: "POST",
          body: JSON.stringify({ ok }),
          headers: { "idempotency-key": "k-1" },
        }),
      );

    expect((await call(false)).status).toBe(422);
    // The same key again, and it is free: the refusal recorded nothing.
    expect(await (await call(true)).json()).toEqual({ n: 2 });
  });
});

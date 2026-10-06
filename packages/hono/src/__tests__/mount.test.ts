import { EDITION } from "@worker-protocol/schemas";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { type ActionCall, memoryOutcomes, type OutcomeStore, type Recorded } from "../actions.ts";
import { mount } from "../mount.ts";
import type { Worker } from "../worker.ts";

/**
 * What `mount()` promises a Worker author, checked without a socket.
 *
 * The verifier against `conformance/reference-worker` is what vouches for `mount()`'s conformance;
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
    // ENDP-37 on every response.
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
        "tech.rowing.test.a-thing": { payload: z.object({}), answeredBy: "count" },
      },
      current: () => [
        { id: "t-1", type: "tech.rowing.test.a-thing", payload: {}, since: new Date(0) },
      ],
    },
    actions: {
      // ENDP-16: the store outlives the Worker object, which is the whole point of naming one —
      // `mount()` answers a different Worker on every request and a Map built here would start
      // again with each. This one is built once, above, and closed over.
      outcomes,
      accepts: {
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
          accepts: {
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
    expect(() => mount({ id: "tech.rowing.test.unrecorded", actions: { accepts: keyed } })).toThrow(
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
      const app = mount(() => ({ id: "tech.rowing.test.unrecorded", actions: { accepts: keyed } }));
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
        actions: { outcomes: memoryOutcomes(), accepts: keyed },
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
      actions: { outcomes, accepts: keyed },
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
        accepts: {
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
        accepts: {
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

/**
 * ENDP-34 and ENDP-35: whose a key is follows where it was read from.
 *
 * A header key is the caller's statement about its own attempts, so the same string from another
 * caller is another key. An input key is the Worker's own data, so any caller sending it names the
 * same performance. `authenticate` says who is calling, and without that every caller is one.
 */
describe("mount(), with one key from two callers", () => {
  const build = () => {
    const calls: ActionCall[] = [];
    const app = mount({
      id: "tech.rowing.test.scoped",
      authenticate: (token) =>
        token === "anonymous" ? "accepted" : { verdict: "accepted", caller: token ?? "nobody" },
      actions: {
        outcomes: memoryOutcomes(),
        accepts: {
          "by-header": {
            input: z.object({ n: z.number() }),
            result: z.object({ n: z.number() }),
            idempotency: { required: true, from: "header", windowSeconds: 60 },
            run: ({ n }: { n: number }, call: ActionCall) => {
              calls.push(call);
              return { n };
            },
          },
          "by-input": {
            input: z.object({ reading: z.string(), n: z.number() }),
            result: z.object({ n: z.number() }),
            idempotency: { required: true, from: "input", members: ["reading"], windowSeconds: 60 },
            run: ({ n }: { n: number }, call: ActionCall) => {
              calls.push(call);
              return { n };
            },
          },
        },
      },
    });
    const post = (action: string, token: string, body: unknown, key?: string) =>
      app.fetch(
        new Request(`http://worker.invalid/actions?action=${action}`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${token}`,
            ...(key === undefined ? {} : { "idempotency-key": key }),
          },
        }),
      );
    return { calls, post };
  };

  it("performs a header key another caller already used, with another body", async () => {
    const { calls, post } = build();
    expect(await (await post("by-header", "acme", { n: 1 }, "k-1")).json()).toEqual({ n: 1 });
    // Not `409`, and not acme's outcome: what globex sent says nothing about acme's work.
    const other = await post("by-header", "globex", { n: 2 }, "k-1");
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ n: 2 });
    expect(calls.map((call) => call.caller)).toEqual(["acme", "globex"]);
  });

  it("still refuses one caller reusing its own header key with another body", async () => {
    const { post } = build();
    await post("by-header", "acme", { n: 1 }, "k-1");
    expect((await post("by-header", "acme", { n: 2 }, "k-1")).status).toBe(409);
  });

  it("names the same performance for an input key, whoever sends it", async () => {
    const { calls, post } = build();
    await post("by-input", "acme", { reading: "r-1", n: 1 });
    // The key is the reading, and a reading is one fact whoever reports it.
    expect((await post("by-input", "globex", { reading: "r-1", n: 2 })).status).toBe(409);
    expect(await (await post("by-input", "globex", { reading: "r-1", n: 1 })).json()).toEqual({
      n: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps a credential naming no caller apart from one that names a caller", async () => {
    const { post } = build();
    // The raw key `acme:k-1` from nobody in particular, and the key `k-1` from acme: one string
    // under a separator, two under the tuple.
    await post("by-header", "anonymous", { n: 1 }, "acme:k-1");
    expect((await post("by-header", "acme", { n: 2 }, "k-1")).status).toBe(200);
  });
});

/**
 * A Worker that has to look something up before it can answer anything.
 *
 * Every callback that reaches outside the process may answer a promise, and two of them could not
 * until now: `authenticate`, which `spec/registration.md` describes validating a key against an
 * identity provider — a network call the signature forbade — and `covers`, which reads what a
 * Contract the Tower brokered says this credential may see.
 */
describe("mount(), with a Worker that awaits", () => {
  const worker = mount(async () => {
    // The declaration itself awaited: a time zone in a database, a set of metrics an operator
    // switched on. Nothing in the object below is a function of its own, because this is.
    const settings = await Promise.resolve({ zone: "America/Mexico_City", token: "from-the-db" });
    return {
      id: "tech.rowing.test.awaiting",
      authenticate: async (presented: string | undefined) =>
        (await Promise.resolve(presented === settings.token)) ? "accepted" : "unauthenticated",
      metrics: {
        timeZone: settings.zone,
        publishes: {
          seen: { unit: "things", additive: true, granularities: ["day"], dimensions: {} },
        },
        read: async () => [],
      },
      tasks: {
        raises: {},
        current: async () => [
          { id: "t-1", type: "tech.rowing.test.a-thing", payload: {}, since: new Date(0) },
          { id: "t-2", type: "tech.rowing.test.a-thing", payload: {}, since: new Date(0) },
        ],
        covers: async () => ["t-2"],
      },
    } satisfies Worker;
  });

  const get = (path: string, token: string) =>
    worker.fetch(
      new Request(`http://worker.invalid${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

  it("awaits `authenticate`, which is what validating against an identity provider needs", async () => {
    expect((await get("/.well-known/worker-protocol", "from-the-db")).status).toBe(200);
    expect((await get("/.well-known/worker-protocol", "no")).status).toBe(401);
  });

  it("declares what the awaited configuration said", async () => {
    const answer = await get("/.well-known/worker-protocol", "from-the-db");
    const document = (await answer.json()) as {
      capabilities: { metrics: { timeZone: string } };
    };
    expect(document.capabilities.metrics.timeZone).toBe("America/Mexico_City");
  });

  it("awaits `covers`, so TASK-6 filters on what a lookup answered", async () => {
    const answer = await get("/tasks", "from-the-db");
    const page = (await answer.json()) as { items: { id: string }[] };
    expect(page.items.map((task) => task.id)).toEqual(["t-2"]);
  });
});

/**
 * A builder is asked once per request, whichever address the request is for.
 *
 * The guard that authenticates and the handler that serves are two callbacks on one request, and
 * each used to resolve the Worker. Every read a builder made ran twice, and the Worker that accepted
 * the credential was a different object from the one that answered — which is what these count.
 */
describe("mount(), resolving a Worker answered per request", () => {
  let built = 0;
  const app = mount(() => {
    built += 1;
    return {
      id: "tech.rowing.test.built-once",
      health: () => ({ status: "healthy", checks: {} }),
      actions: {
        settings: () => ({}),
        accepts: {
          configure: { input: z.object({}), run: () => undefined },
          noop: { input: z.object({}), run: () => undefined },
        },
      },
    } satisfies Worker;
  });

  it.each([
    ["the Descriptor", "/.well-known/worker-protocol", {}, 200],
    ["a Capability read", "/health", {}, 200],
    ["a POSTed Action", "/actions?action=noop", { method: "POST", body: "{}" }, 204],
    ["the settings", "/settings", {}, 200],
  ] as const)("builds the Worker once for %s", async (_, path, init, status) => {
    built = 0;
    const answer = await app.fetch(new Request(`http://worker.invalid${path}`, init), {});
    expect(answer.status).toBe(status);
    expect(built).toBe(1);
  });
});

/**
 * What a performance knows about the call beyond its input: the key, and whom it came from.
 *
 * A Worker that performs by asking another needs both. The key is what it derives the one it sends
 * downstream from, so a repeat is not a second performance there either; the principal is what
 * `authenticate` already found, handed on rather than looked up again.
 */
describe("mount(), telling a performance about its call", () => {
  const seen: ActionCall[] = [];
  const covered: unknown[] = [];

  /**
   * Refuses the first time and performs the second. A repeat under one key reaches `run` only after
   * an earlier performance gave the key back, and this is the shortest way to make one.
   */
  const refusingOnce = () => {
    let refused = false;
    return (_input: unknown, call: ActionCall) => {
      seen.push(call);
      if (refused) return undefined;
      refused = true;
      return { code: "unprocessable_content" as const, message: "Not yet." };
    };
  };

  const app = mount({
    id: "tech.rowing.test.call",
    authenticate: (token) =>
      token === "named" ? { verdict: "accepted", principal: { holder: "h-1" } } : "accepted",
    actions: {
      outcomes: memoryOutcomes(),
      accepts: {
        "by-header": {
          input: z.object({}),
          idempotency: { required: true, from: "header", windowSeconds: 60 },
          run: refusingOnce(),
        },
        "by-input": {
          input: z.object({ order: z.string() }),
          idempotency: { required: true, from: "input", members: ["order"], windowSeconds: 60 },
          run: refusingOnce(),
        },
        unkeyed: { input: z.object({}), run: refusingOnce() },
      },
    },
    tasks: {
      raises: {},
      current: () => [],
      covers: (_token, principal) => {
        covered.push(principal);
        return undefined;
      },
    },
  });

  const post = (action: string, body: unknown, headers: Record<string, string> = {}) =>
    app.fetch(
      new Request(`http://worker.invalid/actions?action=${action}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers,
      }),
    );

  const keysSeen = (action: string) =>
    seen.filter((call) => call.name === action).map((call) => call.idempotencyKey);

  it("hands `run` the key from the header, the same on a repeat", async () => {
    expect((await post("by-header", {}, { "idempotency-key": "k-1" })).status).toBe(422);
    expect((await post("by-header", {}, { "idempotency-key": "k-1" })).status).toBe(204);
    // As the caller sent it: the prefix the store keys on is the store's, and never leaks here.
    expect(keysSeen("by-header")).toEqual(["k-1", "k-1"]);
  });

  it("hands `run` the key from the declared member, the same on a repeat", async () => {
    expect((await post("by-input", { order: "o-7" })).status).toBe(422);
    expect((await post("by-input", { order: "o-7" })).status).toBe(204);
    expect(keysSeen("by-input")).toEqual(["o-7", "o-7"]);
  });

  it("hands `run` no key for an Action that takes none, whatever was sent", async () => {
    expect((await post("unkeyed", {}, { "idempotency-key": "k-2" })).status).toBe(422);
    expect((await post("unkeyed", {}, { "idempotency-key": "k-2" })).status).toBe(204);
    expect(keysSeen("unkeyed")).toEqual([undefined, undefined]);
  });

  it("hands `run` and `covers` whom `authenticate` accepted, where it said", async () => {
    seen.length = 0;
    covered.length = 0;
    const named = { authorization: "Bearer named" };
    await post("unkeyed", {}, named);
    await post("unkeyed", {}, { authorization: "Bearer anonymous" });
    await app.fetch(new Request("http://worker.invalid/tasks", { headers: named }));
    await app.fetch(
      new Request("http://worker.invalid/tasks", {
        headers: { authorization: "Bearer anonymous" },
      }),
    );
    // The bare `"accepted"` still works, and names nobody.
    expect(seen.map((call) => call.principal)).toEqual([{ holder: "h-1" }, undefined]);
    expect(covered).toEqual([{ holder: "h-1" }, undefined]);
  });
});

/**
 * The one surface whose body this protocol fixes rather than the Worker.
 *
 * Every other write takes the shape its declarer chose — an Action's input is the Worker's own
 * (ACT-2) — so `mount()` hands the body over unread and the Worker judges it. A nudge is the
 * opposite: NDG-2 fixes what arrives and NDG-3 fixes which types may arrive, both from the
 * Descriptor the Worker already serves. So every answer below is one no Worker author writes, and
 * the reason `nudge` stopped being an Action is that it never could have been written once.
 */
describe("mount(), told there is work of a Task type", () => {
  const LOCATE = "tech.rowing.dispatch.locate-vehicle";
  const told: string[] = [];
  const app = mount({
    id: "tech.rowing.worker-protocol.test",
    skills: { [LOCATE]: { payload: z.object({ vehicle: z.string() }) } },
    nudges: (type) => {
      told.push(type);
    },
  });

  const nudge = (body: string) =>
    app.fetch(
      new Request("http://worker.invalid/nudges", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    );

  it("declares the address, and nothing else — the types are already its Skills", async () => {
    const answer = await app.fetch(
      new Request("http://worker.invalid/.well-known/worker-protocol"),
    );
    const document = (await answer.json()) as { capabilities: Record<string, unknown> };
    expect(document.capabilities.nudges).toEqual({ version: 1, address: "../nudges" });
  });

  it("answers 204 and no body for a type it declares a Skill for (NDG-2)", async () => {
    const answer = await nudge(JSON.stringify({ type: LOCATE }));
    expect(answer.status).toBe(204);
    expect(await answer.text()).toBe("");
    expect(told).toEqual([LOCATE]);
  });

  it("refuses a type it declares no Skill for, and does not call the Worker (NDG-3)", async () => {
    const before = told.length;
    const answer = await nudge(JSON.stringify({ type: "tech.rowing.somebody.else-entirely" }));
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ code: "not_found", class: "reject" });
    expect(told.length).toBe(before);
  });

  it("refuses a body carrying more than the type (NDG-2)", async () => {
    // The whole point of the shape being the protocol's: a Task travelling here would be a claim
    // the owner may already have stopped making (TASK-15), and nothing in a Worker has to know it.
    const answer = await nudge(JSON.stringify({ type: LOCATE, task: { id: "t-1" } }));
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ code: "schema_mismatch" });
  });

  it("refuses a body that does not parse, in the envelope ENDP-39 fixes", async () => {
    const answer = await nudge("{");
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ code: "malformed_request", class: "reject" });
  });
});

/**
 * What the audit of 0.4 changed in what `mount()` answers: secrets that are written and never read,
 * a `202` that carries what the Action declares, a key made of several members, and a Capability's
 * version stated only where a Capability answered.
 */
describe("mount(), after the audit of 0.4", () => {
  let settings: Record<string, unknown> = { label: "fleet", apiKey: "k-1" };
  const runs: unknown[] = [];
  const app = mount({
    id: "tech.rowing.test.audited",
    health: () => ({ status: "healthy", checks: {} }),
    actions: {
      outcomes: memoryOutcomes(),
      settings: () => settings,
      accepts: {
        configure: {
          input: z.object({
            label: z.string(),
            apiKey: z.string().meta({ writeOnly: true }),
          }),
          run: (next: Record<string, unknown>) => {
            settings = next;
          },
        },
        "rebuild-index": {
          input: z.object({}),
          result: z.object({ job: z.string() }),
          completesWithinCall: false,
          run: () => ({ job: "j-42" }),
        },
        "record-reading": {
          input: z.object({ vehicle: z.string(), kind: z.string(), value: z.number() }),
          idempotency: {
            required: true,
            from: "input",
            members: ["vehicle", "kind"],
            windowSeconds: 60,
          },
          run: (_input: unknown, call: ActionCall) => {
            runs.push(call.idempotencyKey);
          },
        },
      },
    },
  });
  const post = (action: string, body: unknown) =>
    app.fetch(
      new Request(`http://worker.invalid/actions?action=${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

  it("never reads back a writeOnly member, and keeps it when a form omits it (ACT-20, ACT-21)", async () => {
    const read = await app.fetch(new Request("http://worker.invalid/settings"));
    expect(await read.json()).toEqual({ label: "fleet" });

    expect((await post("configure", { label: "renamed" })).status).toBe(204);
    expect(settings).toEqual({ label: "renamed", apiKey: "k-1" });

    await post("configure", { label: "renamed", apiKey: "k-2" });
    expect(settings).toEqual({ label: "renamed", apiKey: "k-2" });
  });

  it("answers 202 with the result an asynchronous Action declares (ACT-18)", async () => {
    const answer = await post("rebuild-index", {});
    expect(answer.status).toBe(202);
    expect(await answer.json()).toEqual({ job: "j-42" });
  });

  it("makes one key of several members, in order (ENDP-38)", async () => {
    await post("record-reading", { vehicle: "ABC-123", kind: "temp", value: 1 });
    // The same vehicle and kind is the same reading: `409` for another body, and no second run.
    expect(
      (await post("record-reading", { vehicle: "ABC-123", kind: "temp", value: 2 })).status,
    ).toBe(409);
    expect(runs).toEqual([JSON.stringify(["ABC-123", "temp"])]);
  });

  it("states a Capability's version where one answered, and only there (ENDP-37)", async () => {
    const descriptor = await app.fetch(
      new Request("http://worker.invalid/.well-known/worker-protocol"),
    );
    expect(descriptor.headers.get("worker-protocol-edition")).toBe(EDITION);
    expect(descriptor.headers.has("worker-protocol-capability-version")).toBe(false);

    const health = await app.fetch(new Request("http://worker.invalid/health"));
    expect(health.headers.get("worker-protocol-capability-version")).toBe("1");

    const nowhere = await app.fetch(new Request("http://worker.invalid/nowhere"));
    expect(nowhere.status).toBe(404);
    expect(nowhere.headers.has("worker-protocol-capability-version")).toBe(false);
  });
});

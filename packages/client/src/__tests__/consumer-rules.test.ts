import { describe, expect, it } from "vitest";
import { type Call, caller, Malformed, pages, Refused, Unserved } from "../call.ts";
import { consume } from "../index.ts";

/**
 * The eleven rules that oblige a consumer, each with a witness for the first time.
 *
 * `conformance/verifiability.md` classes these `P` — *the subject is not a Worker* — and a report
 * from `@worker-protocol/conformance` says `other subject` about every one of them, correctly:
 * that tool's subject is a Worker and it never contacted whoever these bind. Which left eleven
 * required rules that nothing anywhere checked, because until this package there was no consumer
 * to check.
 *
 * So each one has a test here, named by its id, and a fake Worker that can be made to misbehave on
 * purpose. This does not change what a conformance report says about a Worker; it says that the
 * consumer in this repository obeys the rules the specification writes for its side.
 */

const DESCRIPTOR = {
  id: "tech.rowing.test.worker",
  edition: "0.1",
  capabilities: {
    health: { version: 1, address: "../health" },
    tasks: { version: 1, address: "../tasks", claimAddress: "../claims", raises: {}, answers: [] },
    actions: { version: 1, address: "../actions", actions: {} },
  },
};

const HEADERS = {
  "content-type": "application/json",
  "worker-protocol-edition": "0.1",
  "worker-protocol-capability-version": "1",
};

type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A Worker that answers whatever a test tells it to, and records what it was asked. */
function fakeWorker(answers: (url: URL, init: RequestInit) => Answer) {
  const seen: { url: string; method: string; headers: Headers; body: string | null }[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    seen.push({
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : null,
    });
    if (parsed.pathname.endsWith("/.well-known/worker-protocol")) {
      return new Response(JSON.stringify(DESCRIPTOR), { headers: HEADERS });
    }
    const answer = answers(parsed, init);
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), {
      status,
      headers: { ...HEADERS, ...answer.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const BASE = "https://worker.example.com";
const nowait = async () => {};

describe("the rules that bind a consumer", () => {
  it("ENDP-28: does not retry a reject", async () => {
    // A `reject` is wrong and will be wrong again. A caller that retries one hammers a Worker with
    // a request that can never succeed and buries the failure; both parties are worse off and one
    // of them did not choose it.
    const worker = fakeWorker(() => ({
      status: 422,
      body: { code: "unprocessable_content", message: "no", class: "reject" },
    }));
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    await expect(client.actions?.perform("x", {})).rejects.toBeInstanceOf(Refused);
    const posts = worker.seen.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("ENDP-30: backs off and repeats a retry, unchanged", async () => {
    // Recommended, and obeyed: the Worker could not answer now and the same request may succeed
    // later. `unchanged` is the load-bearing word — the same body, and under the same key.
    let attempts = 0;
    const worker = fakeWorker(() => {
      attempts += 1;
      return attempts < 3
        ? { status: 503, body: { code: "unavailable", message: "starting", class: "retry" } }
        : { status: 200, body: { status: "healthy", checks: {} } };
    });
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    expect(await client.health?.()).toEqual({ status: "healthy", checks: {} });
    expect(attempts).toBe(3);
    const bodies = new Set(worker.seen.filter((c) => c.url.includes("/health")).map((c) => c.body));
    expect(bodies.size).toBe(1);
  });

  it("ENDP-13, ENDP-14: an answer it cannot classify is a reject", async () => {
    // Stopping loudly on something that would have succeeded costs an alert. Retrying on something
    // that never will costs the work, and costs it silently — so the unclassifiable case is the
    // one that stops. This Worker answers a 500, which the table calls `retry`, with no envelope
    // to read a class off and a body that is not even JSON.
    let attempts = 0;
    const worker = fakeWorker(() => {
      attempts += 1;
      return { status: 418, body: "not json at all", headers: { "content-type": "text/plain" } };
    });
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    // 418 is in no row of ENDP-29 and carries no envelope: neither the class nor the status
    // classifies it, so ENDP-13 makes it `reject` and nothing is sent twice.
    await expect(client.health?.()).rejects.toBeInstanceOf(Refused);
    expect(attempts).toBe(1);
  });

  it("ENDP-27: the code in the envelope wins over a status that disagrees", async () => {
    // A proxy that rewrote a 422 into a 502 has not changed what the Worker meant, and a caller
    // that followed the proxy would redeliver a body the Worker has already refused.
    let attempts = 0;
    const worker = fakeWorker(() => {
      attempts += 1;
      // A `reject` envelope arriving under a status the table calls `retry`.
      return {
        status: 503,
        body: { code: "unprocessable_content", message: "no", class: "reject" },
      };
    });
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    const refusal = await client.health?.().catch((thrown: unknown) => thrown);
    expect(refusal).toBeInstanceOf(Refused);
    expect((refusal as Refused).kind).toBe("reject");
    expect(attempts).toBe(1);
  });

  it("ENDP-21: never constructs a cursor, and sends back exactly what arrived", async () => {
    // A cursor a caller may construct is one whose format the Worker can never change. This one is
    // deliberately not a number, not a date and not anything a client could have guessed.
    const opaque = "eyJvZmZzZXQiOjJ9.signed";
    const worker = fakeWorker((url) => {
      const cursor = url.searchParams.get("cursor");
      return cursor === null
        ? { body: { items: [], nextCursor: opaque } }
        : { body: { items: [] } };
    });
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    await client.tasks?.list();
    const sent = worker.seen
      .map((call) => new URL(call.url).searchParams.get("cursor"))
      .filter((cursor): cursor is string => cursor !== null);
    expect(sent).toEqual([opaque]);
  });

  it("ENDP-31: reads how many items it received, never how many it asked for", async () => {
    // The rule a caller breaks without noticing. A short page is not the end of a collection and a
    // full one is not a promise of more: only the cursor says, and this pages until it is absent.
    const worker = fakeWorker((url) => {
      const cursor = url.searchParams.get("cursor");
      if (cursor === null) return { body: { items: [task("a")], nextCursor: "1" } };
      if (cursor === "1") return { body: { items: [], nextCursor: "2" } };
      return { body: { items: [task("b"), task("c")] } };
    });
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    // The middle page came back EMPTY with a cursor. A caller that stopped on a short page would
    // have lost the last two Tasks and never known.
    const held = await client.tasks?.list();
    expect(held?.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("DESC-13: does not present the credential to an off-origin address", async () => {
    // A Descriptor is a document the Worker controls, and an address in it is an instruction to
    // send a request somewhere. Without this rule a Worker could name any host and be handed the
    // token an operator granted for it.
    const elsewhere = {
      ...DESCRIPTOR,
      capabilities: {
        ...DESCRIPTOR.capabilities,
        health: { version: 1, address: "https://somewhere-else.example.net/health" },
      },
    };
    const seen: { url: string; authorization: string | null }[] = [];
    const fetch = (async (url: string, init: RequestInit = {}) => {
      seen.push({ url, authorization: new Headers(init.headers).get("authorization") });
      const body = new URL(url).pathname.endsWith("/.well-known/worker-protocol")
        ? elsewhere
        : { status: "healthy", checks: {} };
      return new Response(JSON.stringify(body), { headers: HEADERS });
    }) as typeof globalThis.fetch;

    const client = await consume(BASE, { fetch, credential: "a-token", wait: nowait });
    await client.health?.();

    const descriptor = seen.find((call) => call.url.includes(".well-known"));
    const health = seen.find((call) => call.url.includes("somewhere-else"));
    expect(descriptor?.authorization).toBe("Bearer a-token");
    expect(health?.authorization).toBeNull();
  });

  it("DESC-30: stops on a declared address that serves nothing, and does not call it again", async () => {
    // It is a contract error: the Descriptor says the Worker answers here and it does not. A
    // consumer that treated it as transient would retry against a Worker that will never answer,
    // and the mistake would surface as slow silence instead of a refusal.
    let calls = 0;
    const worker = fakeWorker((url) => {
      if (!url.pathname.endsWith("/health")) return { body: {} };
      calls += 1;
      return { status: 404, body: { code: "not_found", message: "no", class: "reject" } };
    });
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    await expect(client.health?.()).rejects.toBeInstanceOf(Unserved);
    // And a second call does not reach the network at all, which is what `does not retry` means
    // for a consumer that keeps running.
    await expect(client.health?.()).rejects.toBeInstanceOf(Unserved);
    expect(calls).toBe(1);
  });

  it("DESC-30: a 404 about a RESOURCE is an ordinary refusal and not that", async () => {
    // The narrowing DESC-30 was written for. An Action no entry declares is ACT-6's `404` from an
    // address that answers perfectly well, and a consumer that stopped polling over it would be
    // making the mistake this rule exists to prevent, pointed at the wrong party.
    const worker = fakeWorker(() => ({
      status: 404,
      body: { code: "not_found", message: "no such Action", class: "reject" },
    }));
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    const thrown = await client.actions?.perform("no-such", {}).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Refused);
    expect(thrown).not.toBeInstanceOf(Unserved);
  });

  it("TASK-20: names its Claim in the header, and never in the body", async () => {
    // ACT-5 makes the body the input and nothing else, so the Claim travels beside it — the
    // precedent is `Idempotency-Key`, a fact about the call that is not part of what the Action
    // takes. A Response that did not name its Claim would be indistinguishable from an operator
    // posting the same Action from a console.
    const worker = fakeWorker((url) =>
      url.pathname.endsWith("/claims")
        ? { body: { id: "claim-1", task: "t-1", expires: "2999-01-01T00:00:00Z" } }
        : { status: 204 },
    );
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    const held = await client.tasks?.claim("t-1");
    await held?.answer("record-verification", { vehicle: "ABC-123" });

    const performed = worker.seen.find((call) => call.url.includes("/actions"));
    expect(performed?.headers.get("worker-protocol-claim")).toBe("claim-1");
    expect(performed?.body).toBe(JSON.stringify({ vehicle: "ABC-123" }));
  });

  it("TASK-18: does no arithmetic against the owner's clock to decide whether it may act", async () => {
    // Two processes that never met do not share a clock. The expiry is a hint about when to renew,
    // and every question of the form *is this Claim still mine* is answered by asking — so a Claim
    // whose lease this consumer's clock says lapsed an hour ago is still posted, and refused by
    // the one party whose clock decides.
    const worker = fakeWorker((url) =>
      url.pathname.endsWith("/claims")
        ? { body: { id: "claim-1", task: "t-1", expires: "2000-01-01T00:00:00Z" } }
        : { status: 204 },
    );
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    const held = await client.tasks?.claim("t-1");
    expect(held?.expires.getTime()).toBeLessThan(Date.now());

    // It acts anyway, because the alternative is a consumer deciding on a clock the owner never
    // saw. A holder whose clock runs slow acts and is refused; neither loses work.
    await held?.answer("record-verification", {});
    expect(worker.seen.some((call) => call.url.includes("/actions"))).toBe(true);
  });

  it("validates what the protocol fixes and nothing the Worker owns", async () => {
    // The line `packages/README.md` draws for `mount()`, drawn again from the other side: a Task
    // missing a member `schemas/` requires is caught and named; a payload of any shape at all is
    // the Worker's own, because this protocol has no data model.
    const worker = fakeWorker(() => ({
      body: { items: [{ id: "a", type: "tech.rowing.x.y", payload: { anything: [1, 2] } }] },
    }));
    const client = await consume(BASE, { fetch: worker.fetch, wait: nowait });

    const thrown = await client.tasks?.list().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Malformed);
    expect((thrown as Malformed).rule).toBe("TASK-5");
    expect((thrown as Malformed).detail).toContain("failedClaims");
  });

  it("resolves every address against the Descriptor's own route (DESC-12)", async () => {
    // Relative, and resolved against the URL the Descriptor was READ FROM — not against the base
    // URL. The two coincide for a Worker at the origin root and diverge the moment one is mounted
    // under a path, which is the case that catches it.
    const worker = fakeWorker(() => ({ body: { status: "healthy", checks: {} } }));
    const client = await consume(`${BASE}/fleet`, { fetch: worker.fetch, wait: nowait });
    await client.health?.();

    expect(worker.seen.map((call) => call.url)).toEqual([
      `${BASE}/fleet/.well-known/worker-protocol`,
      `${BASE}/fleet/health`,
    ]);
  });
});

describe("the caller itself", () => {
  it("sends the credential as `Authorization: Bearer` and nowhere else (REG-3)", async () => {
    const seen: Headers[] = [];
    const fetch = (async (_url: string, init: RequestInit = {}) => {
      seen.push(new Headers(init.headers));
      return new Response(JSON.stringify({ status: "healthy", checks: {} }), { headers: HEADERS });
    }) as typeof globalThis.fetch;

    const call = caller(`${BASE}/.well-known/worker-protocol`, { credential: "t", fetch });
    await call.call({ url: `${BASE}/health` } satisfies Call);
    expect(seen[0]?.get("authorization")).toBe("Bearer t");
  });

  it("stops paging when a Worker's cursor does not advance", async () => {
    // Not a rule: a guard, because a Worker that answered the same cursor forever would otherwise
    // spin a consumer until it ran out of memory. `pages` bounds what it will read.
    const fetch = (async () =>
      new Response(JSON.stringify({ items: [], nextCursor: "always" }), {
        headers: HEADERS,
      })) as typeof globalThis.fetch;
    const call = caller(`${BASE}/.well-known/worker-protocol`, { fetch });

    let read = 0;
    const { taskPage } = await import("@worker-protocol/schemas");
    for await (const _page of pages(call, `${BASE}/tasks`, taskPage, "TASK-5")) read += 1;
    expect(read).toBe(10_000);
  });
});

const task = (id: string) => ({
  id,
  type: "tech.rowing.test.a-thing",
  payload: {},
  failedClaims: 0,
  lapsedClaims: 0,
  claimable: true,
});

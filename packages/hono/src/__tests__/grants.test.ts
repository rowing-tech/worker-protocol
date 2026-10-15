import { describe, expect, it } from "vitest";
import * as z from "zod";
import { action } from "../actions.ts";
import { memoryGrants } from "../grants.ts";
import { mount } from "../mount.ts";
import {
  eventHub,
  memoryDeliveries,
  memorySubscriptions,
  SUBSCRIPTION_ENDED,
  type SubscriptionFacts,
} from "../subscriptions.ts";
import type { Worker } from "../worker.ts";

/**
 * `grants`, checked without a socket: applying, what a grant's credential covers, and when a change
 * takes effect (GRANT-1 to GRANT-9).
 *
 * Two applicants, `tower-a` and `tower-b`, and an operator that may not apply. The sink answers the
 * handshake and records what it was sent, as in `subscriptions.test.ts`.
 */

const ID = "tech.rowing.worker-protocol.granting";
const REVIEW = "tech.rowing.test.review";
const INSPECT = "tech.rowing.test.inspect";
const MOVED = "tech.rowing.fleet.vehicle-moved";
const PARKED = "tech.rowing.fleet.vehicle-parked";
const SINCE = new Date("2026-10-15T09:00:00Z");

const EVENTS = {
  publishes: {
    [MOVED]: { data: z.object({ vehicle: z.string() }) },
    [PARKED]: { data: z.object({ vehicle: z.string() }) },
  },
  republishWindowSeconds: 3600,
};

const build = () => {
  const posted: { url: string; body: unknown }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "OPTIONS") {
      return new Response(null, { headers: { "webhook-allowed-origin": ID } });
    }
    posted.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const queue = memoryDeliveries();
  const subscriptions: SubscriptionFacts = {
    abandonAfterSeconds: 3600,
    store: memorySubscriptions(),
    queue,
    fetch,
  };
  const grants = { store: memoryGrants(), applicants: (caller: string | null) => caller !== "ops" };
  let runs = 0;
  const run = () => {
    runs += 1;
    return undefined;
  };
  const worker: Worker = {
    id: ID,
    authenticate: (token) =>
      token === "tower-a" || token === "tower-b" || token === "ops"
        ? { verdict: "accepted", caller: token }
        : "unauthenticated",
    health: () => ({ status: "healthy", checks: {} }),
    actions: {
      accepts: {
        approve: action({ input: z.object({ document: z.string() }), run }),
        inspect: action({ input: z.object({}), run }),
      },
    },
    tasks: {
      raises: {
        [REVIEW]: { payload: z.object({}), answeredBy: ["approve"] },
        [INSPECT]: { payload: z.object({}), answeredBy: ["inspect"] },
      },
      current: () => [
        { id: "D-1", type: REVIEW, payload: {}, since: SINCE },
        { id: "V-1", type: INSPECT, payload: {}, since: SINCE },
      ],
    },
    events: EVENTS,
    subscriptions,
    grants,
  };
  const hub = eventHub({ id: ID, events: EVENTS, subscriptions, grants });
  queue.consume(hub.deliver);
  const app = mount(worker);

  const call = (
    token: string,
    path: string,
    init: { method?: string; body?: unknown; raw?: string } = {},
  ) =>
    app.fetch(
      new Request(`http://worker.invalid${path}`, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(init.raw !== undefined
          ? { body: init.raw }
          : init.body === undefined
            ? {}
            : { body: JSON.stringify(init.body) }),
      }),
    );
  const apply = (token: string, body: Record<string, unknown>) =>
    call(token, "/grants", { method: "POST", body });
  const taskIds = async (token: string) =>
    ((await (await call(token, "/tasks")).json()) as { items: { id: string }[] }).items.map(
      (one) => one.id,
    );
  return { app, call, apply, taskIds, hub, queue, posted, runs: () => runs };
};

const REVIEWER = { id: "c-42", tasks: [REVIEW], actions: ["approve"], events: [MOVED] };

describe("grants, applying", () => {
  it("is declared with its address (GRANT-1)", async () => {
    const { call } = build();
    const document = (await (await call("ops", "/.well-known/worker-protocol")).json()) as {
      capabilities: Record<string, unknown>;
    };
    expect(document.capabilities.grants).toEqual({ version: 1, address: "../grants" });
  });

  it("creates a grant and answers the credential issued for it, once (GRANT-4)", async () => {
    const { apply } = build();
    const created = await apply("tower-a", REVIEWER);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { credential: string };
    expect(body).toEqual({ ...REVIEWER, credential: expect.any(String) });
    expect(body.credential.length).toBeGreaterThanOrEqual(43);
  });

  it("refuses a caller that may not apply, and a grant's own credential (GRANT-2)", async () => {
    const { apply, call } = build();
    expect((await apply("ops", REVIEWER)).status).toBe(403);
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    expect((await apply(credential, { ...REVIEWER, id: "c-43" })).status).toBe(403);
    expect((await call(credential, "/grants")).status).toBe(403);
  });

  it("refuses a name the Worker does not declare, and applies nothing (GRANT-3)", async () => {
    const { apply, call } = build();
    const refused = await apply("tower-a", { ...REVIEWER, actions: ["approve", "delete-all"] });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "unprocessable_content" });
    expect(await (await call("tower-a", "/grants")).json()).toEqual({ items: [] });
  });

  it("replaces without issuing, and rotates only when asked (GRANT-5)", async () => {
    const { apply, call } = build();
    const first = (await (await apply("tower-a", REVIEWER)).json()) as { credential: string };

    const replaced = await apply("tower-a", { ...REVIEWER, tasks: "all" });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({ ...REVIEWER, tasks: "all" });
    expect((await call(first.credential, "/.well-known/worker-protocol")).status).toBe(200);

    const rotated = await apply("tower-a", { ...REVIEWER, rotate: true });
    expect(rotated.status).toBe(200);
    const { credential } = (await rotated.json()) as { credential: string };
    expect(credential).not.toBe(first.credential);
    expect((await call(first.credential, "/.well-known/worker-protocol")).status).toBe(401);
    expect((await call(credential, "/.well-known/worker-protocol")).status).toBe(200);
  });
});

describe("grants, listing and revoking", () => {
  it("lists an applicant's own grants, never another's, never a credential (GRANT-6)", async () => {
    const { apply, call } = build();
    await apply("tower-a", REVIEWER);
    await apply("tower-b", { ...REVIEWER, tasks: [] });
    expect(await (await call("tower-a", "/grants")).json()).toEqual({ items: [REVIEWER] });
    expect(await (await call("tower-b", "/grants")).json()).toEqual({
      items: [{ ...REVIEWER, tasks: [] }],
    });
  });

  it("revokes, and answers 404 for an id the caller holds no grant under (GRANT-7, GRANT-9)", async () => {
    const { apply, call } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    expect((await call("tower-b", "/grants?grant=c-42", { method: "DELETE" })).status).toBe(404);
    expect((await call(credential, "/tasks")).status).toBe(200);

    expect((await call("tower-a", "/grants?grant=c-42", { method: "DELETE" })).status).toBe(204);
    expect((await call(credential, "/tasks")).status).toBe(401);
    expect((await call("tower-a", "/grants?grant=c-42", { method: "DELETE" })).status).toBe(404);
  });
});

describe("grants, what a credential covers", () => {
  it("reads the Tasks of the types its grant names, and no `covers` is asked (GRANT-8)", async () => {
    const { apply, taskIds } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    expect(await taskIds(credential)).toEqual(["D-1"]);
    expect(await taskIds("ops")).toEqual(["D-1", "V-1"]);
  });

  it("performs only the Actions its grant names, and `403`s a narrowed one (GRANT-8, GRANT-9)", async () => {
    const { apply, call, runs } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    const post = (name: string, body: unknown) =>
      call(credential, `/actions?action=${name}`, { method: "POST", body });
    expect((await post("approve", { document: "d" })).status).toBe(204);
    expect((await post("inspect", {})).status).toBe(403);

    await apply("tower-a", { ...REVIEWER, actions: [] });
    const before = runs();
    const narrowed = await post("approve", { document: "d" });
    expect(narrowed.status).toBe(403);
    expect(runs()).toBe(before);
  });

  it("refuses the surfaces of enrollment to a grant's credential, and reads the Descriptor", async () => {
    const { apply, call } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    expect((await call(credential, "/.well-known/worker-protocol")).status).toBe(200);
    expect((await call(credential, "/health")).status).toBe(403);
  });
});

describe("grants, and the subscriptions a credential made", () => {
  const subscribe = (call: ReturnType<typeof build>["call"], token: string, types: string[]) =>
    call(token, "/subscriptions", {
      method: "POST",
      body: { types, sink: "https://sink.example.com/events", sinkCredential: "s" },
    });

  it("subscribes only to the event types its grant names (GRANT-8)", async () => {
    const { apply, call } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    expect((await subscribe(call, credential, [PARKED])).status).toBe(403);
    expect((await subscribe(call, credential, [MOVED])).status).toBe(201);
  });

  it("ends a narrowed subscription as revoked, and delivers it nothing more (GRANT-9)", async () => {
    const { apply, call, hub, queue, posted } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    await subscribe(call, credential, [MOVED]);
    await apply("tower-a", { ...REVIEWER, events: [] });

    await hub.publish({ type: MOVED, subject: "ABC-123", data: { vehicle: "ABC-123" } });
    await queue.idle();
    expect(posted.map((one) => (one.body as { type: string }).type)).toEqual([SUBSCRIPTION_ENDED]);
    expect(posted[0]?.body).toMatchObject({ data: { reason: "revoked" } });
  });

  it("ends a rotated credential's subscriptions as revoked (GRANT-9)", async () => {
    const { apply, call, hub, queue, posted } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    await subscribe(call, credential, [MOVED]);
    await apply("tower-a", { ...REVIEWER, rotate: true });

    await hub.publish({ type: MOVED, subject: "ABC-123", data: { vehicle: "ABC-123" } });
    await queue.idle();
    expect(posted.map((one) => (one.body as { type: string }).type)).toEqual([SUBSCRIPTION_ENDED]);
  });

  it("keeps delivering to a subscription its grant still covers", async () => {
    const { apply, call, hub, queue, posted } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    await subscribe(call, credential, [MOVED]);
    await apply("tower-a", { ...REVIEWER, tasks: "all" });

    await hub.publish({ type: MOVED, subject: "ABC-123", data: { vehicle: "ABC-123" } });
    await queue.idle();
    expect(posted.map((one) => (one.body as { type: string }).type)).toEqual([MOVED]);
  });
});

describe("grants, refused at construction", () => {
  it("will not mount a Worker that declares `grants` and nobody who may apply (GRANT-2)", () => {
    const unguarded = {
      id: ID,
      grants: { store: memoryGrants() },
    } as unknown as Worker;
    expect(() => mount(unguarded)).toThrow(/GRANT-2/);
  });
});

describe("grants, applied twice at once", () => {
  it("answers one credential and refuses the race's loser 503, writing nothing (GRANT-4)", async () => {
    const { apply, call } = build();
    const [one, two] = await Promise.all([apply("tower-a", REVIEWER), apply("tower-a", REVIEWER)]);
    expect([one.status, two.status].sort()).toEqual([201, 503]);
    const winner = (await (one.status === 201 ? one : two).json()) as { credential: string };
    expect((await call(winner.credential, "/.well-known/worker-protocol")).status).toBe(200);
  });
});

describe("grants, and the Worker's own covers", () => {
  it("narrows inside a grant and never widens it (GRANT-8)", async () => {
    const grants = { store: memoryGrants(), applicants: () => true };
    const app = mount({
      id: ID,
      authenticate: (token) =>
        token === "tower" ? { verdict: "accepted", caller: "tower" } : "unauthenticated",
      actions: {
        accepts: {
          approve: action({ input: z.object({}), run: () => undefined }),
          inspect: action({ input: z.object({}), run: () => undefined }),
        },
        // The Worker's own rule: nobody inspects here, whatever a grant says.
        covers: () => ["approve"],
      },
      tasks: {
        raises: { [REVIEW]: { payload: z.object({}), answeredBy: ["approve", "inspect"] } },
        current: () => [
          { id: "D-1", type: REVIEW, payload: {}, since: SINCE },
          { id: "D-2", type: REVIEW, payload: {}, since: SINCE },
        ],
        covers: () => ["D-1"],
      },
      grants,
    });
    const send = (token: string, path: string, method = "GET", body?: unknown) =>
      app.fetch(
        new Request(`http://worker.invalid${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    const { credential } = (await (
      await send("tower", "/grants", "POST", {
        id: "c-1",
        tasks: "all",
        actions: "all",
        events: [],
      })
    ).json()) as { credential: string };

    const page = (await (await send(credential, "/tasks")).json()) as {
      items: { id: string; available?: string[] }[];
    };
    expect(page.items).toEqual([expect.objectContaining({ id: "D-1", available: ["approve"] })]);
    expect((await send(credential, "/actions?action=inspect", "POST", {})).status).toBe(403);
    expect((await send(credential, "/actions?action=approve", "POST", {})).status).toBe(204);
  });
});

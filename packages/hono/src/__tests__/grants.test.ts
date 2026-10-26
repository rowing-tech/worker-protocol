import { describe, expect, it } from "vitest";
import * as z from "zod";
import { action } from "../actions.ts";
import { contractKey, grantCaller, grantOf, memoryGrants } from "../grants.ts";
import { mount } from "../mount.ts";
import {
  eventHub,
  memoryDeliveries,
  memorySubscriptions,
  SUBSCRIPTION_ENDED,
  type SubscriptionFacts,
  taskAnswered,
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

/** One request to a mounted Worker, with a credential and a JSON body or a raw one. */
type Sent = { path: string; method?: string; body?: unknown; raw?: string; task?: string };

const requester =
  (app: { fetch: (request: Request) => Response | Promise<Response> }) =>
  (token: string, sent: Sent) =>
    app.fetch(
      new Request(`http://worker.invalid${sent.path}`, {
        method: sent.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(sent.task === undefined ? {} : { "worker-protocol-task": sent.task }),
        },
        ...(sent.raw !== undefined
          ? { body: sent.raw }
          : sent.body === undefined
            ? {}
            : { body: JSON.stringify(sent.body) }),
      }),
    );

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
  const grants = {
    store: memoryGrants(),
    applicants: ({ caller }: { caller: string }) => caller !== "ops",
  };
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

  const call = requester(app);
  const apply = (token: string, body: Record<string, unknown>) =>
    call(token, { path: "/grants", method: "POST", body });
  const taskIds = async (token: string) =>
    (
      (await (await call(token, { path: "/tasks" })).json()) as { items: { id: string }[] }
    ).items.map((one) => one.id);
  return { app, call, apply, taskIds, hub, queue, posted, subscriptions, runs: () => runs };
};

const REVIEWER = { id: "c-42", tasks: [REVIEW], actions: ["approve"], events: [MOVED] };

describe("grants, applying", () => {
  it("is declared with its address (GRANT-1)", async () => {
    const { call } = build();
    const document = (await (
      await call("ops", { path: "/.well-known/worker-protocol" })
    ).json()) as {
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
    expect((await call(credential, { path: "/grants" })).status).toBe(403);
  });

  it("refuses a name the Worker does not declare, and applies nothing (GRANT-3)", async () => {
    const { apply, call } = build();
    const refused = await apply("tower-a", { ...REVIEWER, actions: ["approve", "delete-all"] });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "unprocessable_content" });
    expect(await (await call("tower-a", { path: "/grants" })).json()).toEqual({ items: [] });
  });

  it("replaces without issuing, and rotates only when asked (GRANT-5)", async () => {
    const { apply, call } = build();
    const first = (await (await apply("tower-a", REVIEWER)).json()) as { credential: string };

    const replaced = await apply("tower-a", { ...REVIEWER, tasks: "all" });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({ ...REVIEWER, tasks: "all" });
    expect((await call(first.credential, { path: "/.well-known/worker-protocol" })).status).toBe(
      200,
    );

    const rotated = await apply("tower-a", { ...REVIEWER, rotate: true });
    expect(rotated.status).toBe(200);
    const { credential } = (await rotated.json()) as { credential: string };
    expect(credential).not.toBe(first.credential);
    expect((await call(first.credential, { path: "/.well-known/worker-protocol" })).status).toBe(
      401,
    );
    expect((await call(credential, { path: "/.well-known/worker-protocol" })).status).toBe(200);
  });
});

describe("grants, listing and revoking", () => {
  it("lists an applicant's own grants, never another's, never a credential (GRANT-6)", async () => {
    const { apply, call } = build();
    await apply("tower-a", REVIEWER);
    await apply("tower-b", { ...REVIEWER, tasks: [] });
    expect(await (await call("tower-a", { path: "/grants" })).json()).toEqual({
      items: [REVIEWER],
    });
    expect(await (await call("tower-b", { path: "/grants" })).json()).toEqual({
      items: [{ ...REVIEWER, tasks: [] }],
    });
  });

  it("revokes, and answers 404 for an id the caller holds no grant under (GRANT-7, GRANT-9)", async () => {
    const { apply, call } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    expect((await call("tower-b", { path: "/grants?grant=c-42", method: "DELETE" })).status).toBe(
      404,
    );
    expect((await call(credential, { path: "/tasks" })).status).toBe(200);

    expect((await call("tower-a", { path: "/grants?grant=c-42", method: "DELETE" })).status).toBe(
      204,
    );
    expect((await call(credential, { path: "/tasks" })).status).toBe(401);
    expect((await call("tower-a", { path: "/grants?grant=c-42", method: "DELETE" })).status).toBe(
      404,
    );
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
      call(credential, { path: `/actions?action=${name}`, method: "POST", body });
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
    expect((await call(credential, { path: "/.well-known/worker-protocol" })).status).toBe(200);
    expect((await call(credential, { path: "/health" })).status).toBe(403);
  });
});

describe("grants, and the subscriptions a credential made", () => {
  const subscribe = (
    call: ReturnType<typeof build>["call"],
    asked: { token: string; types: string[] },
  ) =>
    call(asked.token, {
      path: "/subscriptions",

      method: "POST",
      body: { types: asked.types, sink: "https://sink.example.com/events", sinkCredential: "s" },
    });

  it("subscribes only to the event types its grant names (GRANT-8)", async () => {
    const { apply, call } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    expect((await subscribe(call, { token: credential, types: [PARKED] })).status).toBe(403);
    expect((await subscribe(call, { token: credential, types: [MOVED] })).status).toBe(201);
  });

  it("ends a narrowed subscription as revoked, and delivers it nothing more (GRANT-9)", async () => {
    const { apply, call, hub, queue, posted } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    await subscribe(call, { token: credential, types: [MOVED] });
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
    await subscribe(call, { token: credential, types: [MOVED] });
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
    await subscribe(call, { token: credential, types: [MOVED] });
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
    expect((await call(winner.credential, { path: "/.well-known/worker-protocol" })).status).toBe(
      200,
    );
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
    const send = requester(app);
    const { credential } = (await (
      await send("tower", {
        path: "/grants",
        method: "POST",
        body: { id: "c-1", tasks: "all", actions: "all", events: [] },
      })
    ).json()) as { credential: string };

    const page = (await (await send(credential, { path: "/tasks" })).json()) as {
      items: { id: string; available?: string[] }[];
    };
    expect(page.items).toEqual([expect.objectContaining({ id: "D-1", available: ["approve"] })]);
    expect(
      (await send(credential, { path: "/actions?action=inspect", method: "POST", body: {} }))
        .status,
    ).toBe(403);
    expect(
      (await send(credential, { path: "/actions?action=approve", method: "POST", body: {} }))
        .status,
    ).toBe(204);
  });
});

/**
 * `contract`: what came under a grant, told to its applicant and nobody else — a metric dimension
 * fixed by the applicant's own id (MET-23), and a member of `task-answered` in its deliveries only
 * (EVT-22).
 */
describe("contract, for the applicant only", () => {
  const ANSWERED = "tech.rowing.worker-protocol.task-answered";
  const setup = () => {
    const posted: { auth: string | null; body: { data: Record<string, unknown> } }[] = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "OPTIONS") {
        return new Response(null, { headers: { "webhook-allowed-origin": ID } });
      }
      posted.push({
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const queue = memoryDeliveries();
    const subscriptions: SubscriptionFacts = {
      abandonAfterSeconds: 3600,
      store: memorySubscriptions(),
      queue,
      fetch,
    };
    const events = {
      publishes: { [ANSWERED]: { data: z.looseObject({}), extensions: { tasktype: z.string() } } },
      republishWindowSeconds: 3600,
    };
    const grants = {
      store: memoryGrants(),
      applicants: ({ caller }: { caller: string }) => caller !== "ops",
    };
    const hub = eventHub({ id: ID, events, subscriptions, grants });
    queue.consume(hub.deliver);
    // What this Worker counts: one answer per performance, under the grant it came under.
    const answers: { contract: string | null }[] = [];
    const worker: Worker = {
      id: ID,
      authenticate: (token) =>
        token === "tower-a" || token === "tower-b" || token === "ops"
          ? { verdict: "accepted", caller: token }
          : "unauthenticated",
      metrics: {
        timeZone: "UTC",
        publishes: {
          answers: {
            unit: "1",
            additive: true,
            granularities: ["year"],
            dimensions: { contract: {} },
          },
        },
        read: ({ buckets, fixed }) => {
          const counted = answers.filter(
            (one) => fixed.contract === undefined || one.contract === fixed.contract,
          ).length;
          return counted === 0 ? [] : [{ start: buckets[0]?.start ?? new Date(), value: counted }];
        },
      },
      actions: {
        accepts: {
          approve: action({
            input: z.object({}),
            run: async (_, call) => {
              answers.push({ contract: call.grant === undefined ? null : contractKey(call.grant) });
              if (call.task !== undefined) {
                await hub.publish(
                  taskAnswered({
                    task: call.task,
                    action: call.name,
                    at: new Date(),
                    grant: call.grant,
                  }),
                );
              }
              return undefined;
            },
          }),
        },
      },
      tasks: {
        raises: { [REVIEW]: { payload: z.object({}), answeredBy: ["approve"] } },
        current: () => [{ id: "D-1", type: REVIEW, payload: {}, since: SINCE }],
      },
      events,
      subscriptions,
      grants,
    };
    const app = mount(worker);
    const send = requester(app);
    return { send, queue, posted };
  };

  const YEAR = (() => {
    const year = new Date().getUTCFullYear();
    return `from=${year}-01-01T00:00:00Z&to=${year + 1}-01-01T00:00:00Z`;
  })();
  const total = async (
    send: ReturnType<typeof setup>["send"],
    asked: { token: string; contract?: string },
  ) => {
    const { token, contract } = asked;
    const page = (await (
      await send(token, {
        // MET-11: whole buckets only, so a whole year.
        path: `/metrics?metric=answers&${YEAR}${contract === undefined ? "" : `&contract=${contract}`}`,
      })
    ).json()) as { items: { value: number }[] };
    return page.items.reduce((sum, one) => sum + one.value, 0);
  };

  it("counts under the applicant's own id, and under nobody else's (MET-23)", async () => {
    const { send } = setup();
    const { credential } = (await (
      await send("tower-a", { path: "/grants", method: "POST", body: { ...REVIEWER, events: [] } })
    ).json()) as { credential: string };
    await send(credential, { path: "/actions?action=approve", method: "POST", body: {} });
    await send("ops", { path: "/actions?action=approve", method: "POST", body: {} });

    expect(await total(send, { token: "tower-a", contract: "c-42" })).toBe(1);
    expect(await total(send, { token: "tower-b", contract: "c-42" })).toBe(0);
    expect(await total(send, { token: "ops", contract: "c-42" })).toBe(0);
    // MET-18: fixing nothing accumulates over every Contract and none.
    expect(await total(send, { token: "ops" })).toBe(2);
    // MET-19: never broken down.
    expect(
      (await send("tower-a", { path: `/metrics?metric=answers&${YEAR}&by=contract` })).status,
    ).toBe(400);
  });

  it("tells the applicant's subscription the `contract`, and no other subscriber (EVT-22)", async () => {
    const { send, queue, posted } = setup();
    const { credential } = (await (
      await send("tower-a", { path: "/grants", method: "POST", body: { ...REVIEWER, events: [] } })
    ).json()) as { credential: string };
    for (const [token, sinkCredential] of [
      ["tower-a", "for-a"],
      ["ops", "for-ops"],
    ]) {
      await send(token as string, {
        path: "/subscriptions",
        method: "POST",
        body: { types: [ANSWERED], sink: "https://sink.example.com/events", sinkCredential },
      });
    }
    await send(credential, {
      path: "/actions?action=approve",
      method: "POST",
      body: {},
      task: "D-1",
    });
    await queue.idle();

    const to = (sink: string) => posted.find((one) => one.auth === `Bearer ${sink}`)?.body.data;
    expect(to("for-a")).toEqual({ id: "D-1", type: REVIEW, action: "approve", contract: "c-42" });
    expect(to("for-ops")).toEqual({ id: "D-1", type: REVIEW, action: "approve" });
  });
});

describe("grants, an applicant is a named caller", () => {
  it("refuses a caller `authenticate` names nothing for, without asking `applicants` (GRANT-2)", async () => {
    let asked = false;
    const app = mount({
      id: ID,
      authenticate: () => "accepted",
      grants: {
        store: memoryGrants(),
        applicants: () => {
          asked = true;
          return true;
        },
      },
    });
    const answer = await requester(app)("anyone", {
      path: "/grants",
      method: "POST",
      body: { id: "c-1", tasks: [], actions: [], events: [] },
    });
    expect(answer.status).toBe(403);
    expect(asked).toBe(false);
  });

  it("will not mount a metric that declares a set of values for `contract` (MET-23)", () => {
    const enumerated = {
      id: ID,
      metrics: {
        timeZone: "UTC",
        publishes: {
          answers: {
            unit: "1",
            additive: true,
            granularities: ["day"],
            dimensions: { contract: { values: ["c-1"] } },
          },
        },
        read: () => [],
      },
    } as unknown as Worker;
    expect(() => mount(enumerated)).toThrow(/MET-23/);
  });
});

describe("grants, and a hub that was not handed the store", () => {
  it("ends a grant's subscription rather than keep delivering to it (GRANT-9)", async () => {
    const { apply, call, queue, posted, subscriptions } = build();
    const { credential } = (await (await apply("tower-a", REVIEWER)).json()) as {
      credential: string;
    };
    await call(credential, {
      path: "/subscriptions",
      method: "POST",
      body: { types: [MOVED], sink: "https://sink.example.com/events", sinkCredential: "s" },
    });
    // The same subscriptions and queue, and no `grants`: the wiring a Worker can forget.
    const forgetful = eventHub({ id: ID, events: EVENTS, subscriptions });
    const errors: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      queue.consume(forgetful.deliver);
      await forgetful.publish({ type: MOVED, subject: "ABC-123", data: { vehicle: "ABC-123" } });
      await queue.idle();
    } finally {
      console.error = error;
    }
    expect(posted.map((one) => (one.body as { type: string }).type)).toContain(SUBSCRIPTION_ENDED);
    expect(posted.map((one) => (one.body as { type: string }).type)).not.toContain(MOVED);
    expect(errors).toHaveLength(1);
  });
});

describe("grantOf, the caller a grant's credential is named by", () => {
  it("reads back what grantCaller wrote, and nothing else (SUB-8)", () => {
    const grant = { applicant: "tower-a", id: "c-1", serial: 2 };
    expect(grantOf(grantCaller(grant))).toEqual(grant);
    expect(grantOf(null)).toBeUndefined();
    expect(grantOf("tower-a")).toBeUndefined();
    expect(grantOf('["grant",')).toBeUndefined();
    expect(grantOf('["grant","tower-a"]')).toBeUndefined();
    expect(grantOf('["grant","tower-a",1,2]')).toBeUndefined();
    expect(grantOf('["grant","tower-a","c-1",2.5]')).toBeUndefined();
  });

  it("refuses a caller `authenticate` names in a grant's form, as the Worker's fault (SUB-8)", async () => {
    const forged = grantCaller({ applicant: "tower-a", id: "c-1", serial: 1 });
    const app = mount({
      id: ID,
      authenticate: () => ({ verdict: "accepted", caller: forged }),
      health: () => ({ status: "healthy", checks: {} }),
    });
    const errors: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const answer = await requester(app)("anyone", { path: "/health" });
      expect(answer.status).toBe(500);
    } finally {
      console.error = error;
    }
    expect(errors).toHaveLength(1);
  });
});

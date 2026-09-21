import { OpenAPIHono, type RouteConfig } from "@hono/zod-openapi";
import { EDITION } from "@worker-protocol/schemas";
import type { Context, MiddlewareHandler } from "hono";
import { actions as actionsSurface, jsonSchema, type Recorded } from "./actions.ts";
import { type ClaimStore, claims as claimLifecycle, memoryClaims } from "./claims.ts";
import { byCode } from "./codes.ts";
import { metrics as metricsSurface } from "./metrics.ts";
import {
  performAction,
  pollHealth,
  readAlerts,
  readDescriptor,
  readMetric,
  readTasks,
  writeClaim,
} from "./surfaces.ts";
import { tasks as taskSurface } from "./tasks.ts";
import type { Answer, Refusal, Worker } from "./worker.ts";

/**
 * Everything a conformant Worker owes and nobody should write twice, as one Hono app.
 *
 * `mount(worker)` takes what only the Worker knows — see `worker.ts` — and returns an app that
 * serves the Descriptor at the one route this protocol fixes (DESC-3) and every declared
 * Capability at an address of its own. Mount it wherever the Worker lives: at the root, or under a
 * path beside an application that already owns the root.
 *
 * **It takes a Worker, or a function that answers one from an environment.** The second form is
 * the one most Workers on this network need and the reason is not a detail of any one platform: a
 * Cloudflare Worker, a Vercel edge function and a Deno Deploy handler are all handed their
 * bindings, secrets and execution context *per request*, so a Worker built once at module scope
 * cannot reach a database, a queue or a durable object at all. Only a long-lived Node or Bun
 * process has an ambient environment, and that is the narrower case.
 *
 * ```ts
 * // Cloudflare, Vercel edge, Deno Deploy — env arrives with the request
 * export default { fetch: mount<Env>((env) => workerFor(env)).fetch }
 *
 * // Node, Bun, Deno with an ambient environment
 * export const app = mount(worker)
 * ```
 *
 * What it carries, so that a Worker author does not: ENDP-5's two headers on every response;
 * REG-3 and REG-21; ENDP-6's whole refusal of a version it cannot answer; ENDP-24; ENDP-25 and
 * ENDP-26's envelope; ENDP-19 through ENDP-23's page and cursor; DESC-12's addresses; TASK-9
 * through TASK-26, the whole Claim lifecycle; MET-7 through MET-20, the parameters and the
 * boundaries; ACT-6 through ACT-12 and ENDP-15 through ENDP-18; and ACT-2 and ACT-3's JSON Schema,
 * generated from the Zod object a Worker declared so the document a console renders a form from and
 * the object a request is validated against are one declaration.
 *
 * What it does not carry is anything the Worker is authoritative over: whether a credential is
 * good, which conditions hold, what a number is, what performing an Action does.
 */

/** What a runtime hands a `fetch` handler beside the environment. Structural, so every one fits. */
export type ExecutionCtx = { waitUntil?: (promise: Promise<unknown>) => void };

/**
 * A Worker, or how to answer one from the environment of the request in hand.
 *
 * The function form is called on every request and must be cheap: it is a declaration being read,
 * not a connection being opened. What it answers may close over `env` freely — that is the point —
 * but **what it DECLARES may not differ between two callers**, because REG-8 requires the
 * Descriptor to be the same document for every one of them.
 */
export type WorkerSource<E = unknown> =
  | Worker
  | ((env: E, ctx: ExecutionCtx) => Worker | Promise<Worker>);

const JSON_UTF8 = { "content-type": "application/json; charset=utf-8" };

/** ENDP-25, ENDP-26: the envelope, with the status and class the code fixes and nothing chosen. */
const envelope = ({ code, message }: Refusal): Response => {
  const row = byCode.get(code);
  return new Response(JSON.stringify({ code, message, class: row?.class ?? "reject" }), {
    status: row?.status ?? 400,
    headers: JSON_UTF8,
  });
};

const refused = (answer: object): answer is Refusal => "code" in answer;

/** What a write answered, as a response: a refusal enveloped, a body as JSON, or no body at all. */
const reply = (c: Context, answer: Answer | Refusal): Response => {
  if (refused(answer)) return envelope(answer);
  if (answer.body === null) return c.body(null, answer.status as 204);
  return c.json(answer.body as Record<string, unknown>, answer.status as 200);
};

/** What a read answered: a refusal enveloped, or the page as `200`. */
const page = (c: Context, answer: Refusal | Record<string, unknown>): Response =>
  refused(answer) ? envelope(answer) : c.json(answer, 200);

const query = (c: Context) => new URL(c.req.url).searchParams;

const bearer = (c: Context): string | undefined => {
  const presented = c.req.header("authorization");
  return presented?.startsWith("Bearer ") ? presented.slice("Bearer ".length) : undefined;
};

/** A parameter the route's declaration refuses is a parameter fault, and nothing was done. */
const defaultHook = (result: { success: boolean }) =>
  result.success
    ? undefined
    : envelope({ code: "invalid_parameter", message: "A parameter is missing or malformed." });

// ENDP-24: an unrecognized filter parameter is `400` and is never ignored. A filter dropped in
// silence answers with MORE than the caller asked for, in a shape it will happily parse. The
// surfaces with parameters of their own check them where they know what they mean; the rest take
// none, so anything at all is a parameter they cannot know.
const noParameters: MiddlewareHandler = async (c, next) => {
  const [first] = Object.keys(c.req.query());
  if (first !== undefined) {
    return envelope({
      code: "unknown_filter",
      message: `This address takes no parameter named ${first}.`,
    });
  }
  await next();
};

/**
 * The state this package owns rather than the Worker, and that therefore outlives one request.
 *
 * Every one of these is a rule keeping a promise across calls, so a fresh copy per request would
 * be the rule silently broken: Claims granted in a Map nobody looks at again, an idempotency
 * window that forgets before it said it would, two holders minted the same id. A Worker that runs
 * across isolates gives its own `claims` store; these are what a single one gets for free.
 */
type Durable = {
  /** TASK-9 onward, where the Worker declares no store of its own. */
  memory: ClaimStore;
  /** TASK-26. The opaque id this Worker calls each credential by. */
  minted: Map<string, string>;
  /** ENDP-16. The outcome recorded against a key, for as long as the Action declared. */
  recorded: Map<string, Recorded>;
};

/** One Worker's surfaces, over state that is older than this request. */
function surfacesOf(worker: Worker, durable: Durable) {
  const held = worker.tasks
    ? claimLifecycle(worker.tasks.claims ?? durable.memory, worker.tasks.lease)
    : undefined;

  // TASK-26: absent, every credential this Worker authenticated counts as recorded at enrollment.
  // A Worker with one credential has recorded it, and a default of `false` would have made that
  // Worker fail a required rule in order to guard a case it does not have.
  const enrolled = worker.enrolled ?? ((token: string | undefined) => token !== undefined);

  const tasks =
    worker.tasks && held
      ? taskSurface(worker.tasks.raises, worker.tasks, held, enrolled, durable.minted)
      : undefined;

  const actions = worker.actions
    ? actionsSurface(
        worker.actions,
        async (claim, action) => (await tasks?.allows(claim, action)) ?? false,
        durable.recorded,
      )
    : undefined;

  const metrics = worker.metrics ? metricsSurface(worker.metrics) : undefined;

  return { tasks, actions, metrics };
}

/** DESC-1. The Descriptor, derived from what the Worker implements and nothing else. */
function descriptorOf(worker: Worker, edition: string): string {
  const capabilities: Record<string, unknown> = {};

  if (worker.health) capabilities.health = { version: 1, address: "../health" };

  if (worker.metrics) {
    const { read, pageSize, ...declared } = worker.metrics;
    capabilities.metrics = { version: 1, address: "../metrics", ...declared };
  }

  if (worker.actions) {
    // ACT-2, ACT-3: the Descriptor carries JSON Schema, generated from the Zod object the Worker
    // declared — one declaration, so the form a console renders and the validation a request meets
    // are the same document and cannot drift.
    const declared: Record<string, unknown> = {};
    for (const [name, action] of Object.entries(worker.actions.actions)) {
      declared[name] = {
        input: jsonSchema(action.input),
        ...(action.result === undefined ? {} : { result: jsonSchema(action.result) }),
        completesWithinCall: action.completesWithinCall ?? true,
        ...(action.idempotency === undefined ? {} : { idempotency: action.idempotency }),
        // ACT-15: where the Worker exposes its settings, the reading address is this app's to fix,
        // because this app serves it — written into the declaration so the two cannot disagree.
        ...(name === "configure" && worker.actions.settings ? { readAddress: "../settings" } : {}),
      };
    }
    capabilities.actions = { version: 1, address: "../actions", actions: declared };
  }

  if (worker.alerts) capabilities.alerts = { version: 1, address: "../alerts" };
  if (worker.events) capabilities.events = { version: 1, ...worker.events };

  if (worker.tasks) {
    const { raises, answers, claimByType } = worker.tasks;
    capabilities.tasks = {
      version: 1,
      address: "../tasks",
      claimAddress: "../claims",
      raises: Object.fromEntries(
        Object.entries(raises).map(([type, declaration]) => [
          type,
          { payload: declaration.payload, answeredBy: declaration.answeredBy },
        ]),
      ),
      answers,
      ...(claimByType === undefined ? {} : { claimByType }),
    };
  }

  return JSON.stringify({ id: worker.id, edition, capabilities });
}

export function mount<E = unknown>(source: WorkerSource<E>): OpenAPIHono {
  const durable: Durable = { memory: memoryClaims(), minted: new Map(), recorded: new Map() };

  /**
   * What the runtime gave this request, where it gave one.
   *
   * Hono's accessor THROWS rather than answering `undefined` when there is none, and there is none
   * on Node, on Bun, and on any `app.fetch(request, env)` called with two arguments — which is to
   * say in most of this repository's own tests. A Worker that never uses it must not fail because
   * of which runtime it woke up in.
   */
  const executionCtx = (c: Context): ExecutionCtx => {
    try {
      return c.executionCtx as ExecutionCtx;
    } catch {
      return {};
    }
  };

  /** The Worker for the request in hand. A static one is answered without being asked again. */
  const resolve =
    typeof source === "function"
      ? (c: Context) => source(c.env as E, executionCtx(c))
      : () => source;

  /**
   * Which Capabilities this app registers a route for, or `null` when it cannot know yet.
   *
   * A Worker handed in whole is a shape this app can read at mount, so it registers exactly the
   * addresses that Worker declares and its own OpenAPI document describes that Worker. A Worker
   * answered per request is not knowable before one arrives, so every route is registered and the
   * handler answers `404` for a Capability the resolved Worker does not declare. The document then
   * describes the protocol's whole surface rather than this Worker's — which costs nothing on the
   * wire, because ENDP-1 has every reader start from the Descriptor and nothing there is a path
   * anybody assembles.
   */
  const declared: Set<string> | null =
    typeof source === "function"
      ? null
      : new Set(
          (["health", "metrics", "actions", "alerts", "tasks"] as const).filter(
            (name) => source[name] !== undefined,
          ),
        );

  // DESC-23. Read from the static Worker where there is one, so the header is right before any
  // request has arrived; a resolved Worker that declares another edition overrides it below.
  const staticEdition = typeof source === "function" ? EDITION : (source.edition ?? EDITION);

  const app = new OpenAPIHono({ defaultHook });

  // ENDP-5, outermost, so that a refusal from any guard below carries the headers too. A caller
  // reading a version it did not expect re-reads the Descriptor whatever the status was.
  app.use(async (c, next) => {
    await next();
    if (!c.res.headers.has("worker-protocol-edition")) {
      c.res.headers.set("worker-protocol-edition", staticEdition);
    }
    c.res.headers.set("worker-protocol-capability-version", "1");
  });

  // REG-7 and its converse: an address this Worker genuinely does not serve is `404`, and an
  // address it does serve is never `404` in place of `401` — the guard below is registered on
  // every path this app serves, so a credential is looked at exactly where a route answers.
  app.notFound(() => envelope({ code: "not_found", message: "No such address." }));

  const guard: MiddlewareHandler = async (c, next) => {
    const worker = await resolve(c);
    // REG-21: the Worker accepts the credential recorded for it on every address this protocol
    // defines, the Descriptor's route included. What makes one good is the Worker's (REG-3).
    // REG-32: the refusal distinguishes nothing — a refusal that explains itself is an oracle.
    const verdict = worker.authenticate?.(bearer(c)) ?? "accepted";
    if (verdict !== "accepted") return envelope({ code: verdict, message: "No." });

    // ENDP-6: a caller may state the Capability version it expects, and a Worker that cannot
    // answer that version refuses the request WHOLE rather than substituting its own. On every
    // route, reads and writes alike, because ENDP-6 says `on a request` and a write is a request.
    const asked = c.req.header("worker-protocol-capability-version");
    if (asked !== undefined && asked !== "1") {
      return envelope({ code: "unsupported_version", message: "This Worker answers version 1." });
    }
    c.res.headers.set("worker-protocol-edition", worker.edition ?? EDITION);
    await next();
  };

  /**
   * One surface, at the path this app serves it.
   *
   * **Every route is registered whether or not this Worker declares its Capability**, and the
   * handler answers `404` when it does not — because with a Worker resolved per request there is
   * no Worker at mount time to ask. That is the same answer an undeclared address gives today:
   * DESC-2 admits any combination of Capabilities including none, and nothing a Descriptor does
   * not declare is an address any reader of this protocol calls (ENDP-1).
   */
  const serve = (
    capability: string | null,
    path: string,
    route: RouteConfig,
    handler: (c: Context, worker: Worker) => Response | Promise<Response>,
    ownParameters = false,
  ) => {
    if (capability !== null && declared !== null && !declared.has(capability)) return;
    app.use(path, guard);
    if (!ownParameters) app.use(path, noParameters);
    app.openapi({ ...route, path }, (async (c: Context) => {
      const worker = await resolve(c);
      return handler(c, worker);
    }) as never);
  };

  const undeclared = (capability: string) =>
    envelope({ code: "not_found", message: `This Worker declares no \`${capability}\`.` });

  serve(null, readDescriptor.path, readDescriptor, async (c, worker) =>
    c.body(descriptorOf(worker, worker.edition ?? EDITION), 200, JSON_UTF8),
  );

  // HLTH-5: `200` whatever it reports. The status is read from the body.
  serve("health", "/health", pollHealth, async (c, worker) =>
    worker.health ? c.json(await worker.health(), 200) : undeclared("health"),
  );

  serve(
    "metrics",
    "/metrics",
    readMetric,
    async (c, worker) => {
      const read = surfacesOf(worker, durable).metrics;
      if (!read) return undeclared("metrics");
      return page(c, await read(query(c)));
    },
    true,
  );

  // ACT-5: the Action is named in the query and the body is the input, raw. TASK-20: the Claim
  // an Action answers under travels as a header, outside the body.
  serve(
    "actions",
    "/actions",
    performAction,
    async (c, worker) => {
      const perform = surfacesOf(worker, durable).actions;
      if (!perform) return undeclared("actions");
      return reply(
        c,
        await perform(
          query(c).get("action") ?? "",
          await c.req.text(),
          c.req.header("idempotency-key"),
          c.req.header("worker-protocol-claim"),
          bearer(c),
        ),
      );
    },
    true,
  );

  // ACT-15: where the Worker exposes its settings, this app serves the reading address, which is
  // why the declaration above points at it and the two cannot disagree.
  app.use("/settings", guard);
  app.use("/settings", noParameters);
  app.get("/settings", async (c) => {
    const worker = await resolve(c);
    const settings = worker.actions?.settings;
    if (!settings || !worker.actions?.actions.configure) return undeclared("configure");
    return c.json((await settings()) as Record<string, unknown>);
  });

  // ALRT-2, ENDP-20: the Alerts whose conditions hold, in the page envelope this app builds.
  serve("alerts", "/alerts", readAlerts, async (c, worker) =>
    worker.alerts ? c.json({ items: await worker.alerts() }, 200) : undeclared("alerts"),
  );

  // TASK-5, TASK-6: the Tasks whose conditions hold, and only those the credential covers.
  serve(
    "tasks",
    "/tasks",
    readTasks,
    async (c, worker) => {
      const tasks = surfacesOf(worker, durable).tasks;
      if (!tasks) return undeclared("tasks");
      return page(c, await tasks.read(query(c), bearer(c)));
    },
    true,
  );

  serve(
    "tasks",
    "/claims",
    writeClaim,
    async (c, worker) => {
      const tasks = surfacesOf(worker, durable).tasks;
      if (!tasks) return undeclared("tasks");
      // TASK-23: a claim naming a type where the entry declares no `claimByType` is a parameter
      // fault, and this app refuses it because it serves the declaration and cannot disagree.
      const asked = query(c);
      if (asked.has("type") && worker.tasks?.claimByType !== true) {
        return envelope({
          code: "invalid_parameter",
          message: "This Worker does not declare `claimByType`.",
        });
      }
      return reply(c, await tasks.write(asked, bearer(c)));
    },
    true,
  );

  return app;
}

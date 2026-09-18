import { OpenAPIHono, type RouteConfig } from "@hono/zod-openapi";
import { EDITION } from "@worker-protocol/schemas";
import type { Context, MiddlewareHandler } from "hono";
import { byCode } from "./codes.ts";
import {
  performAction,
  pollHealth,
  readAlerts,
  readDescriptor,
  readMetric,
  readTasks,
  writeClaim,
} from "./surfaces.ts";
import type { Answer, Refusal, Worker } from "./worker.ts";

/**
 * Everything a conformant Worker owes and nobody should write twice, as one Hono app.
 *
 * `mount(worker)` takes what only the Worker knows — see `worker.ts` — and returns an app that
 * serves the Descriptor at the one route this protocol fixes (DESC-3) and every declared
 * Capability at an address of its own. Mount it wherever the Worker lives: at the root, or under a
 * path beside an application that already owns the root, which DESC-3 permits and which is where
 * the Workers people use tend to sit.
 *
 * What it carries, so that a Worker author does not:
 *
 * - ENDP-5, the two headers on every response, refusals included.
 * - REG-3 and REG-21, reading `Authorization: Bearer` and asking the Worker whether it is good on
 *   every address, the Descriptor's included; and the `401`/`403` of ENDP-29 when it is not.
 * - ENDP-6, refusing a Capability version this Worker cannot answer, whole, before anything else.
 * - ENDP-24, refusing an unrecognised filter on every surface that takes no parameter of its own.
 * - ENDP-25 and ENDP-26, the error envelope with the status and class the code carries.
 * - DESC-12, the addresses: relative, `../health` and not `health`, because the base for
 *   resolution is the Descriptor's own route and a bare `health` would land under `.well-known/`.
 *   Climbing one segment lands beside the base URL and keeps doing so under a path.
 * - The routes `surfaces.ts` declares, registered at the paths this app serves them at, so that a
 *   Worker author's own `OpenAPIHono` can describe this Worker — with its own Actions and Task
 *   payloads — by asking for its document.
 *
 * What it does not carry is anything the Worker is authoritative over: whether a credential is
 * good, what a metric read answers, what performing an Action does. Those arrive as functions and
 * are called; their refusals travel as `{ code, message }` and are enveloped here.
 */

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
// surfaces with parameters of their own — metrics, tasks, the writes — check them where they know
// what they mean; the rest take none, so anything at all is a parameter they cannot know.
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

export function mount(worker: Worker): OpenAPIHono {
  const edition = worker.edition ?? EDITION;
  const app = new OpenAPIHono({ defaultHook });

  // ENDP-5, outermost, so that a refusal from any guard below carries the headers too. A caller
  // reading a version it did not expect re-reads the Descriptor whatever the status was.
  app.use(async (c, next) => {
    await next();
    c.res.headers.set("worker-protocol-edition", edition);
    c.res.headers.set("worker-protocol-capability-version", "1");
  });

  // REG-7 and its converse: an address this Worker genuinely does not serve is `404`, and an
  // address it does serve is never `404` in place of `401` — the guard below is registered only on
  // the paths this app serves, so a credential is looked at exactly where a route answers.
  app.notFound(() => envelope({ code: "not_found", message: "No such address." }));

  const guard: MiddlewareHandler = async (c, next) => {
    // REG-21: the Worker accepts the credential recorded for it on every address this protocol
    // defines, the Descriptor's route included. What makes one good is the Worker's (REG-3).
    // REG-32: the refusal distinguishes nothing. Not which credential, not which scope, not which
    // address would have changed the answer — a refusal that explains itself is an oracle.
    const verdict = worker.authenticate?.(bearer(c)) ?? "accepted";
    if (verdict !== "accepted") return envelope({ code: verdict, message: "No." });

    // ENDP-6: a caller may state the Capability version it expects, and a Worker that cannot
    // answer that version refuses the request WHOLE rather than substituting its own. On every
    // route, reads and writes alike, because ENDP-6 says `on a request` and a write is a request.
    const asked = c.req.header("worker-protocol-capability-version");
    if (asked !== undefined && asked !== "1") {
      return envelope({ code: "unsupported_version", message: "This Worker answers version 1." });
    }
    await next();
  };

  /** A path behind the guard and, where it takes no parameter of its own, behind ENDP-24. */
  const protect = (path: string, ownParameters: boolean) => {
    app.use(path, guard);
    if (!ownParameters) app.use(path, noParameters);
  };

  /**
   * One surface: the route from `surfaces.ts` at the path this app serves it. The one cast lives
   * here: `envelope` answers a bare `Response` where the route's typed responses expect one of its
   * declared shapes, and a refusal is by construction one of them.
   */
  const serve = (
    path: string,
    route: RouteConfig,
    handler: (c: Context) => Response | Promise<Response>,
    ownParameters = false,
  ) => {
    protect(path, ownParameters);
    app.openapi({ ...route, path }, handler as never);
  };

  // DESC-1: the Descriptor, derived from what the Worker implements and nothing else. What it
  // declares, this app serves, so DESC-18 has nothing to catch. It is filled in below and
  // serialised once at the end: it does not change for the life of the app, and it is the document
  // every caller reads first.
  const capabilities: Record<string, unknown> = {};
  let descriptor = "";
  serve(readDescriptor.path, readDescriptor, (c) => c.body(descriptor, 200, JSON_UTF8));

  if (worker.health) {
    const { health } = worker;
    capabilities.health = { version: 1, address: "../health" };
    // HLTH-5: `200` whatever it reports. The status is read from the body.
    serve("/health", pollHealth, (c) => c.json(health(), 200));
  }

  if (worker.metrics) {
    const { read, ...declared } = worker.metrics;
    capabilities.metrics = { version: 1, address: "../metrics", ...declared };
    serve("/metrics", readMetric, (c) => page(c, read(query(c))), true);
  }

  if (worker.actions) {
    const { perform, settings } = worker.actions;
    const actions = { ...worker.actions.actions };
    // ACT-15: where the Worker exposes its settings, the reading address is this app's to fix,
    // because this app serves it — written into the declaration so the two cannot disagree. It is
    // not one of `surfaces.ts`'s routes: its document is shaped by `configure`'s own input schema,
    // which is the Worker's, so it is served plainly and described by nothing here.
    if (settings && actions.configure) {
      actions.configure = { ...actions.configure, readAddress: "../settings" };
      protect("/settings", false);
      app.get("/settings", (c) => c.json(settings() as Record<string, unknown>));
    }
    capabilities.actions = { version: 1, address: "../actions", actions };
    // ACT-5: the Action is named in the query and the body is the input, raw. The name has been
    // validated as present before this runs.
    serve(
      "/actions",
      performAction,
      async (c) =>
        reply(
          c,
          perform(
            query(c).get("action") ?? "",
            await c.req.text(),
            c.req.header("idempotency-key"),
          ),
        ),
      true,
    );
  }

  if (worker.alerts) {
    const { alerts } = worker;
    capabilities.alerts = { version: 1, address: "../alerts" };
    serve("/alerts", readAlerts, (c) => c.json(alerts(), 200));
  }

  if (worker.events) capabilities.events = { version: 1, ...worker.events };

  if (worker.tasks) {
    const { read, write, ...declared } = worker.tasks;
    capabilities.tasks = {
      version: 1,
      address: "../tasks",
      claimAddress: "../claims",
      ...declared,
    };
    // TASK-5, TASK-6: the Tasks whose conditions hold, and only those the credential covers.
    serve("/tasks", readTasks, (c) => page(c, read(query(c), bearer(c))), true);
    serve("/claims", writeClaim, (c) => reply(c, write(query(c))), true);
  }

  descriptor = JSON.stringify({ id: worker.id, edition, capabilities });
  return app;
}

import { OpenAPIHono, type RouteConfig } from "@hono/zod-openapi";
import { EDITION } from "@worker-protocol/schemas";
import type { Context, MiddlewareHandler } from "hono";
import { actions as actionsSurface, jsonSchema } from "./actions.ts";
import { claims as claimLifecycle, memoryClaims } from "./claims.ts";
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
 * path beside an application that already owns the root, which DESC-3 permits and which is where
 * the Workers people use tend to sit.
 *
 * What it carries, so that a Worker author does not:
 *
 * - ENDP-5, the two headers on every response, refusals included.
 * - REG-3 and REG-21, reading `Authorization: Bearer` and asking the Worker whether it is good on
 *   every address, the Descriptor's included; and the `401`/`403` of ENDP-29 when it is not.
 * - ENDP-6, refusing a Capability version this Worker cannot answer, whole, before anything else.
 * - ENDP-24, refusing an unrecognised filter on every surface.
 * - ENDP-25 and ENDP-26, the error envelope with the status and class the code carries.
 * - ENDP-19, ENDP-20, ENDP-21, ENDP-23, the page envelope and its cursor, on every collection.
 * - DESC-12, the addresses: relative, `../health` and not `health`, because the base for
 *   resolution is the Descriptor's own route and a bare `health` would land under `.well-known/`.
 * - TASK-9 through TASK-26, the whole Claim lifecycle — `claims.ts` and `tasks.ts`.
 * - MET-7 through MET-20, the parameters and the boundaries — `metrics.ts` and `buckets.ts`.
 * - ACT-6 through ACT-12 and ENDP-15 through ENDP-18, the call and its key — `actions.ts`.
 * - ACT-2 and ACT-3, generating the Descriptor's JSON Schema from the Zod object a Worker declared,
 *   so the document a console renders a form from and the object a request is validated against
 *   are one declaration.
 *
 * What it does not carry is anything the Worker is authoritative over: whether a credential is
 * good, which conditions hold, what a number is, what performing an Action does.
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
  // declares, this app serves, so DESC-18 has nothing to catch.
  const capabilities: Record<string, unknown> = {};
  let descriptor = "";
  serve(readDescriptor.path, readDescriptor, (c) => c.body(descriptor, 200, JSON_UTF8));

  if (worker.health) {
    const { health } = worker;
    capabilities.health = { version: 1, address: "../health" };
    // HLTH-5: `200` whatever it reports. The status is read from the body.
    serve("/health", pollHealth, async (c) => c.json(await health(), 200));
  }

  if (worker.metrics) {
    const { read, pageSize, ...declared } = worker.metrics;
    capabilities.metrics = { version: 1, address: "../metrics", ...declared };
    const answer = metricsSurface(worker.metrics);
    serve("/metrics", readMetric, async (c) => page(c, await answer(query(c))), true);
  }

  // TASK-21 is asked on the Actions address and answered by the Claims, so the tasks surface is
  // built first whether or not this Worker declares `actions`. A Worker with no `tasks` answers
  // no Claim, and an Action naming one is then a Claim that is not current.
  const held = worker.tasks
    ? claimLifecycle(worker.tasks.claims ?? memoryClaims(), worker.tasks.lease)
    : undefined;
  // TASK-26: absent, every credential this Worker authenticated counts as recorded at enrollment.
  // A Worker with one credential has recorded it, and a default of `false` would have made that
  // Worker fail a required rule in order to guard a case it does not have.
  const enrolled = worker.enrolled ?? ((token: string | undefined) => token !== undefined);
  const surface =
    worker.tasks && held
      ? taskSurface(worker.tasks.raises, worker.tasks, held, enrolled)
      : undefined;

  if (worker.actions) {
    const { settings } = worker.actions;
    const perform = actionsSurface(
      worker.actions,
      async (claim, action) => (await surface?.allows(claim, action)) ?? false,
    );
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
        ...(name === "configure" && settings ? { readAddress: "../settings" } : {}),
      };
    }
    if (settings && worker.actions.actions.configure) {
      protect("/settings", false);
      app.get("/settings", async (c) => c.json((await settings()) as Record<string, unknown>));
    }
    capabilities.actions = { version: 1, address: "../actions", actions: declared };
    // ACT-5: the Action is named in the query and the body is the input, raw. TASK-20: the Claim
    // an Action answers under travels as a header, outside the body.
    serve(
      "/actions",
      performAction,
      async (c) =>
        reply(
          c,
          await perform(
            query(c).get("action") ?? "",
            await c.req.text(),
            c.req.header("idempotency-key"),
            c.req.header("worker-protocol-claim"),
            bearer(c),
          ),
        ),
      true,
    );
  }

  if (worker.alerts) {
    const { alerts } = worker;
    capabilities.alerts = { version: 1, address: "../alerts" };
    // ALRT-2, ENDP-20: the Alerts whose conditions hold, in the page envelope this app builds.
    serve("/alerts", readAlerts, async (c) => c.json({ items: await alerts() }, 200));
  }

  if (worker.events) capabilities.events = { version: 1, ...worker.events };

  if (worker.tasks && surface) {
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
    serve("/tasks", readTasks, async (c) => page(c, await surface.read(query(c), bearer(c))), true);
    serve(
      "/claims",
      writeClaim,
      async (c) => {
        // TASK-23: a claim naming a type where the entry declares no `claimByType` is a parameter
        // fault, and this app refuses it because it serves the declaration and cannot disagree.
        const asked = query(c);
        if (asked.has("type") && claimByType !== true) {
          return envelope({
            code: "invalid_parameter",
            message: "This Worker does not declare `claimByType`.",
          });
        }
        return reply(c, await surface.write(asked, bearer(c)));
      },
      true,
    );
  }

  descriptor = JSON.stringify({ id: worker.id, edition, capabilities });
  return app;
}

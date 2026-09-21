import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { mount, type Worker } from "@worker-protocol/hono";
import { Hono } from "hono";
import { createActions } from "./actions.ts";
import { activity } from "./activity.ts";
import { alerts } from "./alerts.ts";
import { DECLARATIONS, read, TIME_ZONE } from "./metrics.ts";
import { createTasks, RAISES, SKILLS } from "./tasks.ts";

/**
 * A Worker that conforms, built to be checked.
 *
 * It is not a demo and not a starting point to copy — `examples/minimal-worker` is that. This one
 * exists so that `@worker-protocol/conformance` has something to run against, and every choice in
 * it is made to put a rule within reach of a check. `conformance/verifiability.md` marks
 * twenty-nine rules `H`, meaning no tool observes them unless a Worker is *arranged* for them — two
 * credentials for one holder, a boot window left pollable, a Task its operators will let go of —
 * and this file is where that arrangement lives.
 *
 * Everything the protocol fixes is `mount()`'s, so a rule passing here is a rule passing for every
 * Worker that mounts the same package. What is left is only what the protocol leaves to a Worker.
 */

export type WorkerOptions = {
  /**
   * The Worker's own id. DESC-6 and DESC-27: not the URL, and not derived from it — so the default
   * is a constant written here rather than anything read from the address at boot, which is
   * precisely the mechanism DESC-27 forbids.
   */
  id?: string;
  /** The edition this Worker speaks (DESC-23). */
  edition?: string;
  /** Where the Worker is mounted, so it can live under a path like any application (ENDP-1). */
  basePath?: string;
  /** Presented as `Authorization: Bearer <token>` (REG-3). Omitted, the Worker reads openly. */
  credential?: string;
  /**
   * A second credential for the same holder, live at the same time (REG-28).
   *
   * Without it rotation is a flag day: the old credential stops working at the instant the new one
   * starts, and every caller holding the old one fails in the window between.
   */
  secondCredential?: string;
  /**
   * A credential issued under a Contract rather than recorded at enrollment (TASK-6).
   *
   * It authenticates like the others and covers only what `visibleTasks` says it covers, which is
   * what gives TASK-6 two lists to compare.
   */
  consumerCredential?: string;
  /**
   * A credential this Worker authenticates and that carries no right here (REG-32).
   *
   * It exists so that two refusals can be compared. A refusal that explained itself would be an
   * oracle: a caller told *that key is expired* has learned the key exists.
   */
  unprivilegedCredential?: string;
  /**
   * How long before this Worker has established its state (HLTH-4).
   *
   * A process that has just started has checked nothing, and `healthy` is a claim it has no basis
   * for. The one window in which a Worker is most likely to be broken is the window it would
   * otherwise report itself best in.
   */
  readyAfterMs?: number;
  /** Which Tasks each credential covers, for TASK-6. A credential absent from it covers all. */
  visibleTasks?: Record<string, string[]>;
};

const DEFAULT_ID = "tech.rowing.worker-protocol.reference";

/**
 * What this Worker knows, which outlives any one request and is not read from the environment.
 *
 * On Cloudflare this is a durable object, on Convex a table, here a closure — and the distinction
 * that matters is the same in all three: a Worker is ANSWERED per request and its Facts are not.
 * Building these inside `referenceWorker` made every request start a Worker that had never seen a
 * verification, so a Task closed by an Action reopened on the next call and TASK-15 was untestable.
 */
export function createFacts() {
  const tasks = createTasks();
  return {
    tasks,
    ...createActions(tasks.verify),
    // HLTH-4: the window between a process starting and its first evaluation, which is a fact
    // about this deployment and not about the request asking.
    started: Date.now(),
  };
}

export type Facts = ReturnType<typeof createFacts>;

/**
 * The Worker, as `@worker-protocol/hono` sees it: what only this Worker knows.
 *
 * `options` is its environment — what a Cloudflare Worker reads off `env` and a Node one off
 * `process.env` — and `facts` is its store. Both arrive from outside for the same reason: this is
 * resolved on every request, so anything it built itself would be built again.
 */
export function referenceWorker(options: WorkerOptions = {}, facts: Facts = createFacts()): Worker {
  const { tasks, actions, settings, outcomes, started } = facts;
  const readyAfter = options.readyAfterMs ?? 0;

  // REG-28: more than one valid credential for one holder at a time, so replacing one is an
  // overlap and not an outage.
  const recorded = new Set(
    [options.credential, options.secondCredential].filter((t): t is string => t !== undefined),
  );

  return {
    id: options.id ?? DEFAULT_ID,
    edition: options.edition,

    // TASK-29: what this Worker answers, beside the id and not inside `tasks`. A Skill is served
    // at no address — it is what this Worker IS, and a Capability is what it serves.
    skills: SKILLS,

    // REG-21 on every address. `403` for the credential this Worker reads and that carries no
    // right, because ENDP-29 divides `401` from `403` at whether it could be READ.
    authenticate: (token) => {
      if (options.credential === undefined) return "accepted";
      if (token !== undefined && token === options.unprivilegedCredential) return "forbidden";
      if (token !== undefined && token === options.consumerCredential) return "accepted";
      return token !== undefined && recorded.has(token) ? "accepted" : "unauthenticated";
    },

    // HLTH-4: until it has established its state it answers `unhealthy`, never `healthy`.
    // Answering `unhealthy` costs nothing, because ENDP-29 classes the condition `retry` and a
    // poller comes round again. HLTH-2: this Worker depends on nothing, so `checks` is empty.
    health: () =>
      Date.now() - started < readyAfter
        ? { status: "unhealthy", checks: {} }
        : { status: "healthy", checks: {} },

    // MET-1, MET-21, MET-6: the calendar every boundary is cut in, and the whole catalog of what
    // this Worker publishes. The surface itself never lists what exists.
    metrics: {
      timeZone: TIME_ZONE,
      publishes: DECLARATIONS,
      read: (query) => read(query, Date.now()),
    },

    // ACT-16: the Actions this Worker accepts, keyed by name. `mount()` generates each one's JSON
    // Schema from the Zod object beside it and writes `configure`'s reading address (ACT-15).
    // ENDP-16: `outcomes` travels with them, because `record-verification` declares a key and a
    // Worker that declares one and names nowhere to record it is refused at construction.
    actions: { accepts: actions, settings, outcomes },

    // TASK-6: only what the credential covers, because a list showing every Task to every holder
    // of any Contract is a disclosure the owner cannot take back.
    tasks: {
      raises: RAISES,
      current: tasks.current,
      covers: (token: string | undefined) => options.visibleTasks?.[token ?? ""],
      // ENDP-19: a cap of two, so that this Worker's own three Tasks actually page — a cap nothing
      // ever reaches is a cap nobody has seen work.
      pageSize: 2,
    },

    alerts,

    // ACTV-2: one activity in each state, so every state a check can read is read. What this Worker
    // is "doing" is arranged, like everything else here; what is real is the shape.
    activity,

    // EVT-11: no address at all, which is the one case DESC-22 leaves the shared entry's address
    // optional for. An event travels over a broker, and this Worker names the broker, the binding
    // and where on it the events land — none of which anything here parses.
    events: {
      broker: "nats",
      protocolBinding: "cloudevents/nats-1.0",
      // The shape NATS needs, under keys this Worker chose. On Kafka it would be bootstrap
      // servers and a topic; on Event Hubs a namespace and a hub. Nothing here reads a key.
      destination: { servers: "nats://events.invalid:4222", subject: "worker-protocol.reference" },
      publishes: {
        "tech.rowing.worker-protocol.vehicle-verified": {
          data: {
            type: "object",
            properties: { vehicle: { type: "string" } },
            required: ["vehicle"],
            additionalProperties: false,
          },
        },
      },
      // EVT-8: what a consumer sizes its deduplication store against. An hour, declared, because
      // `remember forever` is not implementable.
      republishWindowSeconds: 3600,
    },
  };
}

/**
 * The Worker as a Node server, mounted at `basePath`, for a test to listen on a socket.
 *
 * **It is mounted in the form a Cloudflare, Vercel or Deno Worker has to use**, with the Worker
 * answered from the environment of each request — because this is the Worker the verifier runs
 * against, and conformance proven only for the shape a long-lived Node process can take would be
 * proven for the narrower case. `WorkerOptions` IS the environment here: credentials, a boot
 * window, which Tasks a credential covers. The other form, a Worker handed in whole, is a property
 * of `mount()` rather than of any Worker, and `packages/hono/src/__tests__/mount.test.ts` holds it.
 */
export function createWorker(options: WorkerOptions = {}): Server {
  // The Facts are built once, here, and the Worker is answered from them on every request.
  const facts = createFacts();
  const mounted = mount<WorkerOptions>((env) => referenceWorker(env, facts));
  const serve = (request: Request) => mounted.fetch(request, options);
  const base = (options.basePath ?? "").replace(/\/*$/, "");
  if (base === "") return createServer(getRequestListener(serve));

  // Under a path, exactly as an application that already owns the root would mount it (DESC-3).
  // The addresses in the Descriptor are relative and climb one segment, so they resolve beside
  // the base URL wherever that is — which is the case an absolute `/health` would have got wrong.
  const app = new Hono()
    .route(base, mounted)
    .notFound(() => serve(new Request("http://worker.invalid/none")));
  return createServer(getRequestListener((request) => app.fetch(request, options)));
}

/** `node examples/reference-worker/src/server.ts` runs it on 8787, or on `PORT`. */
if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 8787);
  createWorker({ credential: process.env.CREDENTIAL }).listen(port, () => {
    console.log(`reference worker on http://localhost:${port}/.well-known/worker-protocol`);
  });
}

import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { mount, type Worker } from "@worker-protocol/hono";
import { Hono } from "hono";
import { DECLARATIONS as ACTIONS, createActions } from "./actions.ts";
import { alerts } from "./alerts.ts";
import { DECLARATIONS, read, TIME_ZONE } from "./metrics.ts";
import { ANSWERS, createTasks, RAISES } from "./tasks.ts";

/**
 * A Worker that conforms, built to be checked.
 *
 * It is not a demo and not a starting point to copy: it exists so that
 * `@worker-protocol/conformance` has something to run against, and every choice in it is made to
 * put a rule within reach of a check. `conformance/verifiability.md` marks twenty-three rules `H`,
 * meaning no tool observes them unless a Worker is *arranged* for them — two credentials for one
 * holder, a boot window left pollable, a Task its operators will let go of — and this file is
 * where that arrangement lives.
 *
 * It is `mount()` from `@worker-protocol/hono` over an implementation of `Worker`, and that is the
 * shape a real Worker on Hono has. What is here is only what the protocol leaves to the Worker:
 * which credentials are good, how it is doing, what it counts, what it does, what it has raised.
 * Every address, header and refusal the protocol fixes is `mount()`'s, so a rule about one of
 * those passing here is a rule passing for every Worker that mounts the same package — which is
 * what makes the verifier's report against this file worth something to a Worker that is not it.
 *
 * It lives outside `packages/` because what it holds is arrangement: Actions, Tasks and metrics
 * chosen so that a check can observe a rule, and nothing anybody would build for use.
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
   * starts, and every caller holding the old one fails in the window between. Comparing against
   * two secrets instead of one is the cheapest version that works.
   */
  secondCredential?: string;
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
   * for — it is reporting a default. The one window in which a Worker is most likely to be broken
   * is the window it would otherwise report itself best in.
   */
  readyAfterMs?: number;
  /**
   * A credential issued under a Contract rather than recorded at enrollment (TASK-6, TASK-26).
   *
   * It authenticates like the others and covers only what `visibleTasks` says it covers. What it
   * never reads is `holder`: a Task under a Claim names who holds it to the credentials this
   * Worker was enrolled with, and to no other.
   */
  consumerCredential?: string;
  /** Which Tasks each credential covers, for TASK-6. A credential absent from it covers all. */
  visibleTasks?: Record<string, string[]>;
};

const DEFAULT_ID = "tech.rowing.worker-protocol.reference";

/** The Worker, as `@worker-protocol/hono` sees it: what only this Worker knows. */
export function referenceWorker(options: WorkerOptions = {}): Worker {
  // The Actions reach into the Tasks: `record-verification` changes the Fact a verify-vehicle Task
  // is derived from (TASK-15), and an Action performed under a Claim asks the Tasks whether that
  // Claim is current before it does anything (TASK-21).
  const tasks = createTasks();
  const actions = createActions(tasks);

  // HLTH-4: until it has established its state it answers `unhealthy`, never `healthy`. Answering
  // `unhealthy` costs nothing, because ENDP-29 classes the condition `retry` and a poller comes
  // round again. HLTH-2: this Worker depends on nothing, so the map of checks is empty and its
  // summary is the whole of what it has to say — which health.md says is conformant.
  const started = Date.now();
  const readyAfter = options.readyAfterMs ?? 0;

  // REG-28: more than one valid credential for one holder at a time, so replacing one is an
  // overlap and not an outage. Built once; it is asked on every request to every address.
  const good = new Set(
    [options.credential, options.secondCredential].filter((t): t is string => t !== undefined),
  );
  // TASK-26: the credentials recorded at enrollment are the ones `holder` is answered to. A Worker
  // that reads openly has recorded none and answers it to nobody.
  const enrolled = (token: string | undefined) =>
    options.credential !== undefined && token !== undefined && good.has(token);

  return {
    id: options.id ?? DEFAULT_ID,
    edition: options.edition,

    // REG-21 on every address. `403` for the credential this Worker reads and that carries no
    // right, because ENDP-29 divides `401` from `403` at whether it could be READ.
    authenticate: (token) => {
      if (options.credential === undefined) return "accepted";
      if (token !== undefined && token === options.unprivilegedCredential) return "forbidden";
      if (token !== undefined && token === options.consumerCredential) return "accepted";
      return token !== undefined && good.has(token) ? "accepted" : "unauthenticated";
    },

    health: () =>
      Date.now() - started < readyAfter
        ? { status: "unhealthy", checks: {} }
        : { status: "healthy", checks: {} },

    // MET-1, MET-2, MET-6: the calendar every boundary is cut in, and the whole catalog of what
    // this Worker publishes. The surface itself never lists what exists.
    metrics: {
      timeZone: TIME_ZONE,
      metrics: DECLARATIONS,
      read: (query) => read(query, Date.now()),
    },

    // ACT-1: the Actions this Worker accepts, keyed by name. `mount()` writes the reading address
    // of `configure` into the declaration, because it is `mount()` that serves it (ACT-15).
    actions: {
      actions: ACTIONS,
      perform: actions.perform,
      settings: actions.settings,
    },

    // TASK-6: only what the credential covers. The owner filters rather than the consumer
    // discarding, because a list showing every Task to every holder of any Contract is a
    // disclosure the owner cannot take back.
    tasks: {
      raises: RAISES,
      answers: ANSWERS,
      // TASK-23: declared, so that a claim by type (TASK-24) has a Worker to be observed against.
      claimByType: true,
      read: (query, token) =>
        tasks.read(query, options.visibleTasks?.[token ?? ""], enrolled(token)),
      write: (query, token) => tasks.write(query, token, options.visibleTasks?.[token ?? ""]),
    },

    alerts,

    // EVT-2: no address at all, which is the one case DESC-22 leaves the shared entry's address
    // optional for. An event travels over a broker, and this Worker's is named and not parsed.
    events: {
      broker: "nats://events.invalid",
      binding: "cloudevents/nats-1.0",
      events: {
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
      // `remember forever` is not implementable and a consumer that forgot too early would process
      // an event twice while believing it was protected.
      republishWindowSeconds: 3600,
    },
  };
}

/** The Worker as a Node server, mounted at `basePath`, for a test to listen on a socket. */
export function createWorker(options: WorkerOptions = {}): Server {
  const mounted = mount(referenceWorker(options));
  const base = (options.basePath ?? "").replace(/\/*$/, "");
  if (base === "") return createServer(getRequestListener(mounted.fetch));

  // Under a path, exactly as an application that already owns the root would mount it (DESC-3).
  // The addresses in the Descriptor are relative and climb one segment, so they resolve beside
  // the base URL wherever that is — which is the case an absolute `/health` would have got wrong.
  // Outside the path nothing is served, and the refusal is the Worker's own so that it carries
  // the envelope and the headers like every other answer.
  const app = new Hono()
    .route(base, mounted)
    .notFound(() => mounted.fetch(new Request("http://worker.invalid/none")));
  return createServer(getRequestListener(app.fetch));
}

/** `node examples/reference-worker/src/server.ts` runs it on 8787, or on `PORT`. */
if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 8787);
  createWorker({ credential: process.env.CREDENTIAL }).listen(port, () => {
    console.log(`reference worker on http://localhost:${port}/.well-known/worker-protocol`);
  });
}

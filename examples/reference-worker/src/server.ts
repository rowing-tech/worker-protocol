import { createServer, type Server } from "node:http";
import { DECLARATIONS as ACTIONS, createActions } from "./actions.ts";
import { DECLARATIONS, read, TIME_ZONE } from "./metrics.ts";

/**
 * A Worker that conforms, built to be checked.
 *
 * It is not a demo and not a starting point to copy: it exists so that
 * `@worker-protocol/conformance` has something to run against, and every choice in it is made to
 * put a rule within reach of a check. `conformance/verifiability.md` lists nine rules that no tool
 * can observe unless a Worker is *arranged* for them — two credentials for one holder, a boot
 * window left pollable, a condition that will not change — and closing that list is this file's
 * job as it grows.
 *
 * It lives outside `packages/` deliberately. Nothing under `packages/` may carry behaviour of its
 * own, and this is nothing but behaviour.
 *
 * What it declares, it serves. A Descriptor naming a Capability that answers nothing is a fault in
 * the Descriptor (DESC-18), so this Worker declares `health` because it answers `health`, and
 * declares nothing else.
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
};

const DEFAULTS = {
  id: "tech.rowing.worker-protocol.reference",
  edition: "0.1",
  basePath: "/",
} as const;

export function createWorker(options: WorkerOptions = {}): Server {
  const id = options.id ?? DEFAULTS.id;
  const edition = options.edition ?? DEFAULTS.edition;
  const base = (options.basePath ?? DEFAULTS.basePath).replace(/\/*$/, "/");

  const routes = {
    descriptor: `${base}.well-known/worker-protocol`,
    health: `${base}health`,
    metrics: `${base}metrics`,
    actions: `${base}actions`,
    settings: `${base}settings`,
  };

  const actions = createActions();

  const descriptor = {
    id,
    edition,
    capabilities: {
      // DESC-12: a relative reference, resolved against the URL the Descriptor was read from. It
      // is the shape a Worker that does not know its own public address can always produce.
      //
      // `../health` and not `health`, and the difference is a trap worth naming because the first
      // implementation of this rule fell into it. The base for resolution is the Descriptor's own
      // route — `<base>/.well-known/worker-protocol` — so a bare `health` resolves under
      // `.well-known/`, which is not where any Worker serves anything. Climbing one segment lands
      // it beside the base URL, and keeps doing so when the Worker is mounted under a path: with
      // basePath `/fleet/` the Descriptor is at `/fleet/.well-known/worker-protocol` and this
      // resolves to `/fleet/health`, which an absolute `/health` would have got wrong.
      health: { version: 1, address: "../health" },
      // MET-1, MET-2, MET-6: the address, the calendar every boundary is cut in, and the whole
      // catalog of what this Worker publishes. The surface itself never lists what exists.
      metrics: {
        version: 1,
        address: "../metrics",
        timeZone: TIME_ZONE,
        metrics: DECLARATIONS,
      },
      // ACT-1: one address for the Capability, and the Actions this Worker accepts keyed by name.
      // ACT-5 names the Action in a parameter there rather than in a path segment, so no reader
      // ever assembles an address.
      actions: { version: 1, address: "../actions", actions: ACTIONS },
    },
  };

  // HLTH-2: one status for the Worker and a map of named checks. This Worker depends on nothing,
  // so the map is empty and its summary is the whole of what it has to say — which health.md says
  // is conformant rather than a placeholder.
  const health = { status: "healthy", checks: {} };

  return createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://worker.invalid").pathname;

    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      response.writeHead(status, {
        // ENDP-4: JSON, UTF-8. ENDP-5: what produced this answer, on every protocol response.
        "content-type": "application/json; charset=utf-8",
        "worker-protocol-edition": edition,
        "worker-protocol-capability-version": "1",
      });
      response.end(payload);
    };

    // ENDP-25: every response that is not a success carries the shared envelope, with the class
    // the code carries rather than one chosen beside it.
    const reject = (status: number, code: string, message: string) =>
      send(status, { code, message, class: "reject" });

    const query = new URL(request.url ?? "/", "http://worker.invalid").searchParams;

    const known = [
      routes.descriptor,
      routes.health,
      routes.metrics,
      routes.actions,
      routes.settings,
    ];
    if (!known.includes(path)) {
      // REG-7: a Worker does not answer 404 in place of 401 on an address it serves — and this is
      // the converse, an address it genuinely does not serve.
      return reject(404, "not_found", "No such address.");
    }

    // REG-21: the Worker accepts the credential recorded for it on every address this protocol
    // defines, the Descriptor's route included. REG-32: the refusal distinguishes nothing.
    if (options.credential !== undefined) {
      const presented = request.headers.authorization;
      if (presented !== `Bearer ${options.credential}`) {
        return reject(401, "unauthenticated", "No.");
      }
    }

    // ENDP-3: everything that changes state is POST, on an address declared for the purpose. The
    // Actions address is the only one here that does, and ENDP-2 keeps every other a GET.
    if (path === routes.actions) {
      if (request.method !== "POST") {
        return reject(404, "not_found", "No such address.");
      }
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const key = request.headers["idempotency-key"];
        const answer = actions.perform(
          query.get("action"),
          Buffer.concat(chunks).toString("utf8"),
          typeof key === "string" ? key : undefined,
        );
        if ("code" in answer) {
          return send(answer.status, {
            code: answer.code,
            message: answer.message,
            class: "reject",
          });
        }
        // ACT-10, ACT-11: `200` with the declared result, `204` where none is declared, `202`
        // where the Action said it does not finish here.
        return send(answer.status, answer.body);
      });
      return;
    }

    // ENDP-2 and DESC-5: reading is GET, and a GET changes nothing a later reader could observe.
    if (request.method !== "GET") {
      return reject(404, "not_found", "No such address.");
    }

    // ENDP-6: a caller may state the Capability version it expects, and a Worker that cannot
    // answer that version refuses the request WHOLE rather than substituting its own. A client
    // that guesses at a shape it does not know is worse than one that says so, and the caller's
    // recourse is to re-read the Descriptor, which is where the answer was all along.
    const asked = request.headers["worker-protocol-capability-version"];
    if (typeof asked === "string" && asked !== "1") {
      return reject(400, "unsupported_version", "This Worker answers version 1.");
    }

    // ACT-15: a GET of the reading address answers a document `configure` would accept.
    if (path === routes.settings) return send(200, actions.settings());

    // ENDP-24: an unrecognized filter parameter is 400 and is never ignored. A filter dropped in
    // silence answers with MORE than the caller asked for, in a shape it will happily parse — and
    // a caller that filtered in order to stay inside a Contract is handed exactly what it
    // excluded, with no sign that anything happened. The Descriptor route and `health` take no
    // parameters at all, so every one they receive is unrecognized.
    if (path !== routes.metrics) {
      for (const key of query.keys()) {
        return reject(400, "unknown_filter", `This address takes no parameter named ${key}.`);
      }
    }

    if (path === routes.descriptor) return send(200, descriptor);

    if (path === routes.metrics) {
      const answer = read(query, Date.now());
      if ("status" in answer) {
        // ENDP-26: the code fixes the status and the class, and this Worker answers the status
        // that code names rather than choosing one beside it.
        const retry = answer.status >= 500 || answer.status === 408 || answer.status === 429;
        return send(answer.status, {
          code: answer.code,
          message: answer.message,
          class: retry ? "retry" : "reject",
        });
      }
      return send(200, answer);
    }

    // HLTH-5: the health address answers 200 whatever it reports. A response that is not 200 means
    // the Worker did not answer, not that it is unwell.
    return send(200, health);
  });
}

/** `node examples/reference-worker/src/server.ts` runs it on 8787, or on `PORT`. */
if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 8787);
  createWorker({ credential: process.env.CREDENTIAL }).listen(port, () => {
    console.log(`reference worker on http://localhost:${port}/.well-known/worker-protocol`);
  });
}

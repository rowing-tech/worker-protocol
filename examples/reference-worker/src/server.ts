import { createServer, type Server } from "node:http";

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
  };

  const descriptor = {
    id,
    edition,
    capabilities: {
      // DESC-12: a relative reference, resolved against the URL the Descriptor was read from. It
      // is the shape a Worker that does not know its own public address can always produce.
      health: { version: 1, address: "health" },
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

    if (path !== routes.descriptor && path !== routes.health) {
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

    // ENDP-2 and DESC-5: reading is GET, and a GET changes nothing a later reader could observe.
    if (request.method !== "GET") {
      return reject(404, "not_found", "No such address.");
    }

    if (path === routes.descriptor) return send(200, descriptor);

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

/**
 * `@worker-protocol/hono` — the protocol's surface as Hono routes, and `mount()`.
 *
 * Two things, and the second exists because of the first. The routes in `surfaces.ts` are the
 * declaration `openapi/` is generated from, and they are `createRoute` objects rather than data of
 * this repository's own because most Workers built on this protocol run on Hono: the declaration
 * that runs is the one that generates, and nothing is declared twice. `mount()` is what makes them
 * run — a Worker author implements `Worker` and gets every address, header, envelope and refusal
 * this protocol fixes, once, the same way in every Worker.
 *
 * This package carries behaviour, and `README.md` says what standing that has: `mount()` is
 * derivable from `surfaces.ts` and verifiable by `@worker-protocol/conformance`, which is the
 * standing the verifier itself has. `examples/reference-worker` is `mount()` over an
 * implementation arranged to be checked, and the verifier passing against it is what vouches for
 * this package.
 */

export { CODES, type ErrorCode } from "./codes.ts";
export { mount } from "./mount.ts";
export {
  performAction,
  pollHealth,
  readAlerts,
  readDescriptor,
  readMetric,
  readTasks,
  writeClaim,
} from "./surfaces.ts";
export type { Answer, Refusal, Worker } from "./worker.ts";

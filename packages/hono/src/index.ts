/**
 * `@worker-protocol/hono` — the protocol's surface as Hono routes, and `mount()`.
 *
 * Two things, and the second exists because of the first. The routes in `surfaces.ts` are the
 * declaration `openapi/` is generated from, and they are `createRoute` objects rather than data of
 * this repository's own because most Workers built on this protocol run on Hono: the declaration
 * that runs is the one that generates, and nothing is declared twice. `mount()` is what makes them
 * run — a Worker author implements `Worker` and gets every address, header, envelope, refusal,
 * page and bucket boundary this protocol fixes, once, the same way in every Worker.
 *
 * This package carries behaviour, and `packages/README.md` says what standing that has: what is
 * forbidden is behaviour of its OWN — something `spec/` does not say — and what is wanted is all of
 * what `spec/` does say, because the alternative is every Worker deriving the same rules again.
 * Every line here cites the rule it carries. `examples/reference-worker` is `mount()` over an
 * implementation arranged to be checked, and `@worker-protocol/conformance` passing against it is
 * what vouches for this package; `examples/minimal-worker` is what says it is cheap.
 */

export type {
  Action,
  ActionCall,
  ActionDeclarations,
  ActionFacts,
  Recorded,
} from "./actions.ts";
export { jsonSchema } from "./actions.ts";
export { bucketsIn, endOf, type Granularity, rfc3339, startOf } from "./buckets.ts";
export { CODES, type ErrorCode } from "./codes.ts";
export type { Bucket, MetricFacts, MetricQuery, MetricSample } from "./metrics.ts";
export { type ExecutionCtx, mount, type WorkerSource } from "./mount.ts";
export {
  performAction,
  pollHealth,
  readAlerts,
  readDescriptor,
  readMetric,
  readTasks,
} from "./surfaces.ts";
export type { OpenTask, TaskFacts, TaskTypes } from "./tasks.ts";
export type { Answer, Refusal, Worker } from "./worker.ts";

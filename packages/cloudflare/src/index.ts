/**
 * `@worker-protocol/cloudflare` — the protocol's stores in Durable Objects, and the two Queues
 * between an outbox and a sink.
 *
 * `@worker-protocol/hono` leaves to the platform what depends on it: where ENDP-16's outcomes,
 * SUB-7's subscriptions and LOG-2's records live, and what carries a delivery. On Cloudflare that is
 * a Durable Object and a Queue, and this package is the one way of writing both, so that each Worker
 * on the platform does not write it again with its own mistakes.
 *
 * **One mixin per piece**, because a Worker in production keeps one object per vehicle and one for
 * the fleet, and each object should carry only what it holds: the subscriptions in the one, an
 * outbox in every other. A Worker with a single object composes all four in it.
 */

export type { DurableObjectClass, EnvOf, Mixed } from "./durable.ts";
export {
  durableLogs,
  type LogMethods,
  type LogRow,
  type LogRows,
  type LogsQuery,
  type LogsRpc,
  tailRecords,
  withLogs,
} from "./logs.ts";
export { type Flushed, type OutboxEvent, type OutboxMethods, withOutbox } from "./outbox.ts";
export {
  durableOutcomes,
  type OutcomeMethods,
  type OutcomesRpc,
  withOutcomes,
} from "./outcomes.ts";
export {
  consumeQueues,
  deliveryQueue,
  type GivenUp,
  type QueuesConfig,
} from "./queues.ts";
export {
  durableSubscriptions,
  type SubscriptionMethods,
  type SubscriptionsRpc,
  withSubscriptions,
} from "./subscriptions.ts";

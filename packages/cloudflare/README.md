# @worker-protocol/cloudflare

The protocol's stores in Durable Objects, and the two Queues between an outbox and a sink: one
mixin per piece, for Workers on Cloudflare.

**Not published yet.** It is `private: true` until `examples/fleet-worker`, which is built on it,
has run on a real Cloudflare account — its Queues, its dead-letter queue, an alarm and a real sink
— rather than only on workerd in tests. `docs/roadmap.md` holds that decision and the reasoning
behind the shape below.

**worker-protocol is an open specification for Workers that can be seen, operated and given work by
people who did not build them.** `@worker-protocol/hono` carries everything the protocol fixes and
leaves to the platform what depends on it: where ENDP-16's outcomes, SUB-7's subscriptions and
LOG-2's records live, and what carries a delivery. On Cloudflare that is a Durable Object and a
Queue, and this package is the one way of writing both.

## One mixin per piece

| Mixin | What it adds | Where it goes |
|---|---|---|
| `withOutcomes` | ENDP-16's reservations and recorded outcomes | the object `actions.outcomes` reads |
| `withSubscriptions` | SUB-7's subscriptions, found and ensured in one step | **one** object, never one per shard |
| `withOutbox` | an outbox, drained when a call ends and retried by the alarm | every object whose changes raise events |
| `withLogs` | LOG-2's window, filtered and paged in SQL | the object `/logs` reads, and a Tail Worker writes |

Mixins rather than one base class, because a Worker in production keeps one object per vehicle and
one for the fleet: the subscriptions belong in the one, an outbox in every other, and a class that
carried everything would put subscription tables in thousands of objects. A Worker with a single
object composes all four in it:

```ts
import { DurableObject } from "cloudflare:workers";
import { withLogs, withOutbox, withOutcomes, withSubscriptions } from "@worker-protocol/cloudflare";

export class Fleet extends withLogs(
  withOutbox(withSubscriptions(withOutcomes(DurableObject<Env>)), {
    events: (env) => env.EVENTS,
  }),
  { keep: 500 },
) {
  async ingest(readings: Reading[], now: number) {
    // ...the domain's own writes...
    this.enqueue(now, [taskRaised(task)]); // same transaction as the writes above
    await this.flush(); // sends what was raised; what does not go, the alarm retries
  }
}
```

And one that shards puts each where it belongs:

```ts
export class Fleet extends withSubscriptions(DurableObject<Env>) {}
export class Asset extends withOutbox(DurableObject<Env>, { events: (env) => env.EVENTS }) {
  override async wake() {
    // the domain's own alarm, asked for with `this.wakeAt(at)`
    await this.ctx.storage.deleteAll();
  }
}
```

Each piece keeps its tables under a `wp_` prefix, so none meets a table of the domain's, and
creates them on every call rather than once: an object that empties itself with `deleteAll()` keeps
running in the same instance.

## The outbox, and the one alarm

`enqueue(at, events)` writes each event with its id in the same transaction as the calling method's
own writes, so there is no moment at which a Fact changed and its event was not yet owed. The row
holds the whole event, so the domain's retention need not wait for what is pending. An id still
waiting is not enqueued twice; once sent, the same id enqueued again is a republication under the
same `source` and `id`, which a consumer remembering them discards (EVT-8).

`flush()` sends what is waiting to the events Queue, in order, a hundred at a time, and never
rejects: what could not be sent stays, and the alarm tries again from five seconds, doubling to
five minutes. **A Durable Object has one alarm**, so the domain does not set it: it asks with
`wakeAt(at)` and overrides `wake()`, and the alarm fires at the earlier of the domain's instant and
the outbox's retry. A base class that sets the alarm itself does not compose with this one.

## The two Queues

```ts
import { consumeQueues, deliveryQueue, durableSubscriptions } from "@worker-protocol/cloudflare";

const hubOf = (env: Env) =>
  eventHub({
    id: ID,
    events: EVENTS,
    subscriptions: {
      abandonAfterSeconds: 86_400,
      store: durableSubscriptions(fleetOf(env)),
      queue: deliveryQueue(env.DELIVERIES),
    },
  });

export default {
  fetch: app.fetch,
  queue: consumeQueues<Env>({
    queues: { events: "fleet-events", deliveries: "fleet-deliveries" },
    hub: hubOf,
    deadLetter: (env) => env.DEAD,
    broker: ({ event }) => publishToKafka(event), // where the Worker declares a broker
    record: ({ rows, env }) => fleetOf(env).record(rows), // where it keeps logs
  }),
};
```

The consumer of the events Queue publishes each batch through the hub — the subscriptions are read
once per type for the whole batch — and leaves one delivery per matching subscription on the
deliveries Queue, then hands each event to the broker. An event of a type the Worker does not
declare is set aside rather than retried, since no retry would mend it, and a failure to reach the
store retries the batch whole, once. The consumer of the deliveries Queue runs `deliver()` and hands
its decision back: `retry({ delaySeconds })`, or `ack()`.

What is given up goes to the dead-letter queue as a `GivenUp`, tagged by its `kind` — a delivery
refused for good, outside EVT-8's window or abandoned with its subscription, with the reason; or an
event of an undeclared type — to be inspected and never redriven, and to a record an operator reads
through `/logs`. Name the same queue as each consumer's `dead_letter_queue` in
`wrangler.jsonc`, so it also receives what the platform drops after `max_retries`, and set
`max_retries` well above what the hub asks for: its default of 3 cuts a delivery short.

## Also exported

`durableOutcomes`, `durableSubscriptions` and `durableLogs` turn a stub into the store `mount()`
takes. A subscription crosses the RPC boundary as JSON — its filters nest, and a stub's types do not
survive a recursive one — and these do the parsing, so a Worker never sees the strings.
`tailRecords(events)` is what a Tail Worker records of the invocations it is handed: an exception
nobody caught and an invocation that ended badly, and never their `console` output.

## Related packages

- `@worker-protocol/hono` — `mount()` and `eventHub()`, which these stores are for.
- `@worker-protocol/client` — `consume()` and `sink()`, the other end of a subscription.
- `@worker-protocol/conformance` — point it at a Worker's base URL, get a report of what it complies
  with.

## License and name

Apache-2.0, patent grant included — implement the protocol in any product, commercial or not,
without asking anyone. The name is not part of that grant (Apache-2.0 §6): a claim that something
*speaks worker-protocol* is one this project vouches for, and the conformance tool is how it is
earned.

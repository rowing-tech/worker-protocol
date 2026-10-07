# @worker-protocol/cloudflare

The protocol's stores in Durable Objects, and the two Queues between an outbox and a sink: one
mixin per piece, for Workers on Cloudflare.

**worker-protocol is an open specification for Workers that can be seen, operated and given work by
people who did not build them.** `@worker-protocol/hono` carries everything the protocol fixes and
leaves to the platform what depends on it: where ENDP-16's outcomes, SUB-7's subscriptions and
LOG-2's records live, and what carries a delivery. On Cloudflare that is a Durable Object and a
Queue, and this package is the one way of writing both.

## Install

```
npm i @worker-protocol/cloudflare @worker-protocol/hono hono zod
```

`hono` (`^4.13.7`) and `zod` (`^4.5.4`) are peer dependencies, shared with `@worker-protocol/hono`.
The declarations name the Workers runtime's own types — `DurableObjectState`, `Queue`,
`MessageBatch` — so a Worker type-checks against them with what `wrangler types` writes.

**What has run, and what has not yet.** Every piece runs on workerd in this package's suite, and
`examples/fleet-worker`, built on it, delivers to a subscriber's sink across Miniflare's Queues in
the conformance suite. What no local run shows is a real Cloudflare account: what reaches the
dead-letter queue after the platform's last retry, the platform's limits on batches and alarms,
and how much writing a delivery's outcome costs the one object at scale. Those are the first things
to watch in a first deployment.

## One mixin per piece

| Mixin | What it adds | Where it goes |
|---|---|---|
| `withOutcomes` | ENDP-16's reservations and recorded outcomes | the object `actions.outcomes` reads |
| `withSubscriptions` | SUB-7's subscriptions, found and ensured in one step | **one** object, never one per shard |
| `withOutbox` | an outbox, drained when a call ends and retried by the alarm | every object whose changes raise events |
| `withLogs` | LOG-2's window, filtered and paged in SQL | the object `/logs` reads, and a Tail Worker writes |

Mixins rather than one base class, because a Worker in production keeps one object per vehicle and
one for the fleet: the subscriptions belong in the one, an outbox in every other, and a class that
carried everything would put subscription tables in thousands of objects. Plain functions over
`SqlStorage` would compose with any base class as well, at the price of a dozen one-line RPC
wrappers per Worker per piece — the boilerplate this package exists to remove. A Worker with a
single object composes all four in it:

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

Each piece keeps its tables under a `wp_` prefix, so none meets a table of the domain's.

## Migrations, object by object

A Worker with an object per vehicle has thousands of copies of each piece's tables, and a column
or an index added in a later release has to reach every one of them — each on its own, the first
time it is reached after a deploy. `CREATE TABLE IF NOT EXISTS` reaches only the objects created
after the change, so each piece instead declares a `Schema`: its name, and every step its tables
have ever taken, oldest first. `migrate(storage, schema)` runs at the start of every method,
applies the steps an object still lacks in one transaction with the version it records in
`wp_schema`, and costs one read of that table when there is nothing to do.

A published step is never edited, and a change is a new step at the end. An object written by a
later release than the one running is refused rather than read, because older code over a newer
shape is a rollback and not a migration.

`migrate` is exported for a domain's own tables too, under a piece name of its own, so one object
keeps one record of what shape it is in:

```ts
import { migrate, type Schema } from "@worker-protocol/cloudflare";

const VEHICLES: Schema = {
  piece: "fleet.vehicles",
  steps: [
    ["CREATE TABLE IF NOT EXISTS vehicle (plate TEXT PRIMARY KEY)"],
    ["ALTER TABLE vehicle ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown'"],
  ],
};

const sql = migrate(this.ctx.storage, VEHICLES);
```

**There is no ORM here, on purpose.** The tables are few, the queries plain, and most of what they
hold is a JSON record in one column. A query builder carried by a library would be a version every
Worker installing it has to agree with — and Drizzle's migrations keep one journal per database,
which a Worker using Drizzle for its own tables in the same object would share with this package's.
A Worker that wants Drizzle or Kysely for its domain uses it, beside these tables.

## The outbox, and the one alarm

`enqueue(at, events)` writes each event with its id in the same transaction as the calling method's
own writes, so there is no moment at which a Fact changed and its event was not yet owed. The row
holds the whole event, so the domain's retention need not wait for what is pending — an outbox of
ids, rendered into events only when they are sent, would duplicate nothing and make every Worker
coordinate its retention with it by hand. An id still
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

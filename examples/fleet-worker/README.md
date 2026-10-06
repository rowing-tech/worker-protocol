# fleet-worker

A conformant Worker on Cloudflare, whose Facts live in a Durable Object.

`examples/minimal-worker` is the one to copy for shape: it is the same Worker with its Facts in
memory, written out and explained. This one exists for the question that file cannot answer, which
is **where a Worker keeps what a rule needs between two requests**.

Five things here have to outlive a request: the condition a Task is derived from (TASK-15), the
counters a metric is read from (MET-21), the outcome ENDP-16 promised to replay, an outbox of events
not yet published, and who subscribed to them (SUB-7). Every example in this repository kept them in
a `Map` in a process, which is correct in one long-lived process and silently wrong across isolates
— a repeat under an idempotency key reaches a process that recorded nothing, the Action runs a
second time *while the caller believes it is protected*, and both calls answer `200` so nobody sees
two.

[src/fleet.ts](src/fleet.ts) is the Durable Object all five live in. [src/worker.ts](src/worker.ts)
is the Worker over it, and is the file to read beside `minimal-worker` to see what changed: the
declarations are identical and the Facts come from somewhere else. What is the protocol's in that
object — the outcomes, the subscriptions, the outbox and the records — comes from
[`@worker-protocol/cloudflare`](../../packages/cloudflare), one mixin per piece, and what is left in
the file is the domain.

## The domain

A fleet, simplified from a telemetry worker that polls a GPS provider.

- A cron records what the source last said about each vehicle.
- A vehicle that has not reported inside the window is **quiet**.
- A quiet vehicle is a Task (`tech.rowing.fleet.inspect-quiet-vehicle`) for whoever can go and look.
- Performing `record-inspection` puts a verification on record, so the condition stops holding and
  the Task is gone the next time anybody reads — TASK-15, with nothing closing anything.
- Each *crossing* into quiet is an event. The crossing and not the state: republishing on every
  cycle a vehicle stayed quiet would be publishing a state under a name that says *changed*.
- The crossing is also when the Task is born, and a reading or an inspection is when it ends, so
  `task-raised` and `task-ended` (EVT-15) are written into the outbox at those moments — by the
  Worker, which is the only party that knows them.

The GPS provider and the broker are both stubs. The subscribers are not: each delivery is a message
on a Cloudflare Queue. What is real either way is the shape: an outbox that survives a publish that
failed, because a Fact that was true does not stop being true because a broker was down.

## Running it

```
pnpm --filter @worker-protocol/fleet-worker dev
```

`wrangler dev` serves it on a local port with a real Durable Object. Everything below is relative to
the Descriptor, which is the only address this protocol fixes:

```
curl -H 'authorization: Bearer f-token' localhost:8787/.well-known/worker-protocol
```

The cron does not fire in local development. Drive a cycle by hand, either through the Action or
through wrangler's scheduled endpoint:

```
curl -X POST -H 'authorization: Bearer f-token' -H 'content-type: application/json' \
  'localhost:8787/actions?action=run-cycle' -d '{}'
curl 'localhost:8787/cdn-cgi/handler/scheduled'
```

`CREDENTIAL` is a secret and is not in `wrangler.jsonc`. Set one with `wrangler secret put
CREDENTIAL` for a deployment, or pass `--var CREDENTIAL:f-token` to `wrangler dev`.

To push to a backend running on your own machine — a local Convex deployment, say — name its
origin in `.dev.vars`, which `wrangler dev` reads and a deployment never does:

```
DEV_SINK_ORIGINS=http://127.0.0.1:3211
```

That origin is then held to neither SUB-5 nor SUB-6. Every other sink still has to be `https` and
public.

## Testing it

Two suites, and they answer different questions.

```
pnpm --filter @worker-protocol/fleet-worker test
```

Runs [test/](test/) on **workerd**, through `@cloudflare/vitest-pool-workers`: real Durable Objects,
real input gates, real isolate boundaries. [test/fleet.test.ts](test/fleet.test.ts) reaches the
object directly — the quiet condition, the events the outbox sends, the counters.
[test/protocol.test.ts](test/protocol.test.ts) goes through `SELF.fetch`, so the Facts it reads were
written from a *different isolate*, which is the claim the Durable Object is here to make and which
no test sharing a process with its Worker can make.
[test/subscriptions.test.ts](test/subscriptions.test.ts) subscribes, makes a vehicle quiet, and
drives the Worker's `queue` handler through both Queues against a sink the test answers. The
object's events Queue is swapped on the live instance ([test/outbound.ts](test/outbound.ts)), which
works because the pool runs the object in the test's own isolate. The stores themselves are tested
in `packages/cloudflare`.

```
pnpm --filter @worker-protocol/conformance test
```

Runs the verifier. [that package's fleet-worker suite][verify] starts this Worker on workerd over a
real socket with `wrangler`'s `unstable_dev`, and points `verify()` at the port with nothing changed
— the same tool and the same rule universe it judges the two Workers on Node by. It fails nothing:
DESC-35 requires `https` only where a network is crossed, and a dev server on a loopback address
crosses none.

[verify]: ../../packages/conformance/src/__tests__/fleet-worker.test.ts

## Type-checking it

```
pnpm --filter @worker-protocol/fleet-worker typecheck
```

`wrangler types` runs first and writes `worker-configuration.d.ts` from `wrangler.jsonc`. That file
is generated and git-ignored: it is Cloudflare's runtime declarations, not this repository's, and
regenerating it is cheaper than gating a committed copy for drift.

**`compatibility_date` in `wrangler.jsonc` is held to what the workerd bundled with the test pool
will start on, not to today's date.** A later one is not a stricter setting — it is a Worker the
test runtime refuses to load. It moves when the pool does.

## What this file found

The first run of the suite answered `500` to every idempotent retry. `Fleet.beginOutcome` returned
`Recorded` where `OutcomeStore` takes `{ held: Recorded }`, and the compiler said nothing: a Durable
Object's methods are reached through a stub whose types are mapped, and the mapping was wide enough
to accept the wrong shape. The fix was to name the return type — `Promise<Reservation>` — and
`@worker-protocol/hono` now exports that type so any store outside this repository can do the same.

That is the whole argument for this example existing. The bug was in a store that a `Map` would have
hidden, on the platform this protocol's architecture names first, and no suite running on Node would
ever have reached it.

It found a second one the same way. Moving two shared constants onto [src/worker.ts](src/worker.ts)
— the obvious place, so the tests could import them instead of re-declaring them — type-checked,
and both suites went on passing, because `@cloudflare/vitest-pool-workers` *imports* the module.
`wrangler dev` *deploys* it, and the runtime refused to start: **an entrypoint module may export
only handlers and Durable Object classes**, so a number beside them is `Incorrect type for map
entry` at startup. The constants live in [src/fleet.ts](src/fleet.ts) now. The suite that caught it
is the one in `packages/conformance`, which is the only place anything here is deployed rather than
imported — and that is the second argument for this example, in the same shape as the first.

## `logs`, and the one thing Cloudflare will not do

**There is no API in the Workers runtime for reading a Worker's own `console` output back.** It
leaves the isolate and does not return. Querying Workers Logs would recover it and costs too much:
it needs a secret holding an account token with **`Workers Observability Write`**, there is no
read-only scope, and that token covers every Worker in the account.

This example does not go looking for it. [cycle()](src/worker.ts) *records* what it did, in one call
to the durable object, the way it already counts a metric and raises an event. A record written on
purpose belongs to the work that produced it; a `console` line scraped out of the runtime belongs to
whichever isolate was running, which is a different thing and a worse one to serve.

**What the durable object buys is the same thing it buys everywhere else here.** A window kept in
the isolate is one window per isolate: a read can land somewhere that never saw the write, which
passes every local test and is wrong in production.

The records are `withLogs` from `@worker-protocol/cloudflare`, in SQL rather than in the key-value
API the domain uses: a read filters by a level floor and a half-open interval (LOG-7, LOG-8), and a
store that cannot filter would hand the Worker every row so it could throw most of them away. `seq`
is what makes ENDP-33 free — it only grows, a cursor names one, and a page asks for what is below
it, so a record written since the last page cannot appear in the next.

The feed is one feed and LOG-10 answers it to every caller this Worker authenticates, which is
uncomplicated here because it watches one fleet. Records that belong to a Worker's customers rather
than to whoever runs it want a surface of their own, and `spec/logs.md` lists that open.

## The second Worker, for what the first cannot say about itself

**A Worker that died cannot write its own last line.** `cycle()` records at the end of its work, so
an invocation that threw without catching, ran out of CPU or was cancelled records nothing at all —
and no other surface covers it. `health` is a poll, so a Worker that crashes on one request and
answers the next poll truthfully reports `healthy`. An Alert is a condition that holds, and an
exception three minutes ago does not. A metric was never incremented, because the line that would
have incremented it is the line that did not run. Without something outside the invocation, a hard
failure is **silence indistinguishable from calm**.

[src/tail.ts](src/tail.ts) is that something: a Tail Worker, deployed from
[wrangler.tail.jsonc](wrangler.tail.jsonc), which Cloudflare invokes after an invocation of this one
finishes. It writes an uncaught exception and a non-`ok` outcome into the same Durable Object, so
`/logs` answers one feed and a Control Tower still asks this Worker. The tail serves nothing, has no
Descriptor and is invisible to the protocol.

Two things about it are worth reading before copying:

**The binding reaches the object, not this Worker.** `script_name` in `wrangler.tail.jsonc` says
which script *defines* the `Fleet` class; the call goes to the Durable Object instance by RPC. No
request reaches `fleet-worker`, which is the point — if the tail had to go through this Worker's
HTTP surface it would fail exactly when it is needed, and `logs` is a read with no write to go
through anyway.

**It throws `event.logs` away.** That array is every `console` call this Worker made, and forwarding
it would be the capture `spec/logs.md` argues against. It is also what stops the tail feeding
itself: a Durable Object call is traced like any other — Cloudflare's trace event types include
`alarm` and `hibernatable_web_socket`, which only a Durable Object has, and an RPC arrives as
`worker_rpc` — so the tail's own write comes back here, carrying `outcome: ok` and no exceptions,
and writes nothing. A version that forwarded the logs would never stop.

Deploy order matters, because the producer resolves its consumer by service name, and a Queue has to
exist before a Worker can bind it:

```
wrangler queues create fleet-events            # the three Queues, once
wrangler queues create fleet-deliveries
wrangler queues create fleet-dead
wrangler deploy --config wrangler.tail.jsonc   # fleet-tail first
wrangler deploy                                # then the producer that names it
```

**This is the deployment `@worker-protocol/cloudflare` waits on before it is published**:
`docs/roadmap.md` has the package published once this Worker has run on a real account — the two
Queues and the dead-letter queue, an alarm retrying an outbox, and a real sink.

**What is not established**, and is the first thing to check against a real deployment: whether a
tail invocation that throws is retried or dropped. Cloudflare does not document it, and a tail that
is dropped silently means `/logs` can miss a crash — which is the same honesty the window already
owes: what it holds, and no claim about what it did not.

## `subscriptions`, on a Durable Object and two Queues

`@worker-protocol/hono` leaves two things to the platform, and `@worker-protocol/cloudflare` is what
they are on Cloudflare.

**The store is the Durable Object**, for the reason ENDP-16's is: SUB-7 makes subscribing
idempotent, so two requests for the same thing must find one subscription, and `ensure` — find the
live one or store the candidate — is one method on a single-threaded object rather than a read and a
write that two isolates could interleave. This Worker has one object, so the subscriptions live in
it; a Worker with an object per vehicle keeps them in the one it has for the fleet.

**An event leaves the object through its outbox.** `ingest` enqueues what the readings raised in
the same transaction as the readings, and sends it to `fleet-events` before it returns. What that
Queue does not take stays, in order, and the object's alarm tries again — the cycle has nothing to
drain any more.

**Two Queues carry it to a sink.** The consumer of `fleet-events` reads the subscriptions once per
batch, leaves one delivery per matching subscription on `fleet-deliveries`, and then hands the event
to the broker: subscribers first, so a broker that is down costs them a repeat under the same id,
which they discard, and never a loss. The consumer of `fleet-deliveries` runs `deliver()` and hands
its decision back — `retry({ delaySeconds })` with the hub's backoff, or `ack()`. The hub bounds
every retry by EVT-8's window, so each Queue's `max_retries` is the platform's maximum: its default
of 3 would cut short a delivery the hub still wanted to make.

**What is given up stays visible.** A delivery refused for good or out of its window goes to
`fleet-dead` with the reason, as does an event of a type the Worker does not declare, and a record
of each to `/logs`, where an operator without access to the Cloudflare account reads it; a message
the platform drops after its last retry reaches `fleet-dead` too, because each consumer names it.
Nothing consumes `fleet-dead`: it is for somebody to inspect, and redriving an event past its window
is what EVT-8 forbids.

The typical subscriber is a backend that wants to hear when a Task of one type is raised:

```
curl -X POST -H 'authorization: Bearer f-token' -H 'content-type: application/json' \
  localhost:8787/subscriptions -d '{
    "types": ["tech.rowing.worker-protocol.task-raised"],
    "filters": [{ "exact": { "tasktype": "tech.rowing.fleet.inspect-quiet-vehicle" } }],
    "sink": "http://127.0.0.1:3211/events",
    "sinkCredential": "a-secret-the-sink-checks"
  }'
```

The sink answers the handshake before anything is stored; `sink()` in `@worker-protocol/client` is
that end, and its README has it as a Convex HTTP action.

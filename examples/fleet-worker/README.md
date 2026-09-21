# fleet-worker

A conformant Worker on Cloudflare, whose Facts live in a Durable Object.

`examples/minimal-worker` is the one to copy for shape: it is the same Worker with its Facts in
memory, written out and explained. This one exists for the question that file cannot answer, which
is **where a Worker keeps what a rule needs between two requests**.

Four things here have to outlive a request: the condition a Task is derived from (TASK-15), the
counters a metric is read from (MET-21), the outcome ENDP-16 promised to replay, and an outbox of
events that have not reached the broker. Every example in this repository kept all four in a `Map`
in a process, which is correct in one long-lived process and silently wrong across isolates — a
repeat under an idempotency key reaches a process that recorded nothing, the Action runs a second
time *while the caller believes it is protected*, and both calls answer `200` so nobody sees two.

[src/fleet.ts](src/fleet.ts) is the Durable Object all four live in. [src/worker.ts](src/worker.ts)
is the Worker over it, and is the file to read beside `minimal-worker` to see what changed: the
declarations are identical and the Facts come from somewhere else.

## The domain

A fleet, simplified from a telemetry worker that polls a GPS provider.

- A cron records what the source last said about each vehicle.
- A vehicle that has not reported inside the window is **quiet**.
- A quiet vehicle is a Task (`tech.rowing.fleet.inspect-quiet-vehicle`) for whoever can go and look.
- Performing `record-inspection` puts a verification on record, so the condition stops holding and
  the Task is gone the next time anybody reads — TASK-15, with nothing closing anything.
- Each *crossing* into quiet is an event. The crossing and not the state: republishing on every
  cycle a vehicle stayed quiet would be publishing a state under a name that says *changed*.

The GPS provider and the broker are both stubs. What is real is the shape: an outbox that survives a
publish that failed, because a Fact that was true does not stop being true because a broker was
down.

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

## Testing it

Two suites, and they answer different questions.

```
pnpm --filter @worker-protocol/fleet-worker test
```

Runs [test/](test/) on **workerd**, through `@cloudflare/vitest-pool-workers`: real Durable Objects,
real input gates, real isolate boundaries. [test/fleet.test.ts](test/fleet.test.ts) reaches the
object directly — the quiet condition, the outbox, the counters, the reservation ENDP-16 needs.
[test/protocol.test.ts](test/protocol.test.ts) goes through `SELF.fetch`, so the Facts it reads were
written from a *different isolate*, which is the claim the Durable Object is here to make and which
no test sharing a process with its Worker can make.

```
pnpm --filter @worker-protocol/conformance test
```

Runs the verifier. [that package's fleet-worker suite][verify] starts this Worker on workerd over a
real socket with `wrangler`'s `unstable_dev`, and points `verify()` at the port with nothing changed
— the same tool, the same rule universe, and the same 144 verdicts it produces against the two
Workers that run on Node. It fails one rule, DESC-3, because a loopback address serves `http` and
DESC-3 fixes `https`; that is the harness and not the Worker, and it is asserted rather than
excluded so that a second failure says which.

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

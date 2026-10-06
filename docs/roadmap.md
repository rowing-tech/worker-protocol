# Roadmap

What is decided and not yet built, listed so that whoever picks it up — on another machine, or
somebody else entirely — starts from the decision and its reasoning rather than from a
conversation nobody else was in. Each entry says what was decided, what was rejected and why, what
is still open, and which file of this repository absorbs it when it is built.

An entry leaves this list in one direction only: the repository holds the thing. Its reasoning
then moves into the file that implements it, where the argument sits beside what it argues for —
which is how [deliberately undecided](undecided.md) hands a question to `spec/`, one step later.
Nothing here is normative, and nothing here is a commitment about *when*.

## Per-language SDKs

**Decided 2026-09-18, and revised the same day.** Most of it is built and has left this entry; the
reasoning for each built piece now sits in the file that implements it, which is where an argument
belongs once there is something for it to argue about. The surface is declared as Hono routes in
`packages/hono/src/surfaces.ts`, `openapi/` is generated from them and compared in CI, that
directory is normative for the surface (`README.md` carries the layer table and
`spec/endpoints.md` says its code table is a reading aid), and `@worker-protocol/hono` is the
TypeScript SDK: the routes, an interface a Worker author implements, and `mount()` over it. Why the
routes are the source rather than data of this repository's own, and why TypeScript lives here
rather than in a repository of its own, are argued at the top of `surfaces.ts` and in
`packages/README.md`. What is below is the part that is not built: every other language.

**One repository per language, certified by conformance.** This repository publishes artifacts,
the verifier and the TypeScript SDK. Each other SDK is a repository — `worker-protocol-python`,
`worker-protocol-dotnet`, and so on — that generates its models and clients from `openapi/` pinned
to an edition, adds a thin hand-written layer (reading and resolving the Descriptor, the interface
a Worker author implements and its server adapter, the claim → action → outcome flow for a
consumer), ships its own reference Worker, and runs `@worker-protocol/conformance` against that
Worker in its CI. The conformance report is what ties the repositories together: an SDK is right
because its reference Worker passes, not because somebody read the prose carefully. What
`packages/hono` carries for TypeScript is the model for that layer in every other language.

**Rejected, and why:**

- *All SDKs inside this repository under `sdk/`.* One commit would move every SDK, at the cost of
  several toolchains in one checkout and a README that has to explain why `sdk/` carries behaviour
  when `packages/` may not. TypeScript is the exception because its routes are also the source of
  the normative artifact, which is an argument no other language has.
- *Generated code only, no idiomatic layer.* Resolving the Descriptor, the claim flow and the error
  envelope are exactly what an SDK exists to give, and every consumer would rewrite them.
- *A second generator turning a live Descriptor into a per-Worker OpenAPI.* Not needed: a Worker
  that mounts `@worker-protocol/hono` asks its own app for its document and gets its own Actions
  and Task payloads in it. Other languages get the same from their own frameworks or not at all,
  and that is a question for each of them.

**Still open:**

- Which languages first.

**Answered since, and the answer is the model for every other language.** The consumer flow is not
a second export of the server package: it is `@worker-protocol/client`, whose only dependencies are
`@worker-protocol/schemas` and `fetch`. A consumer is not a server — a Tower, a teams app or a
Worker on a platform that serves nothing runs no web framework — and the nine rules that oblige a
caller rather than a Worker live there, cited and tested by id, because until it existed they had
no subject anywhere. Each language's repository owes the same two halves.

**Lands in:** a repository per language, each pinned to an edition and each running the verifier
against its own reference Worker in CI.

## A Cloudflare package

**Decided 2026-10-06, and checked against a real Worker.** What a Worker on Cloudflare writes to put
the protocol's stores in Durable Objects becomes `@worker-protocol/cloudflare`. It is built now, in
`packages/cloudflare` with `private: true`, and `examples/fleet-worker` imports it; it is published
once `fleet-worker` has run on a real Cloudflare account — its two Queues, its dead-letter queue,
an alarm and a real sink — rather than only on workerd in tests.

The shape was decided against `soriana-trip-tracker-workers`, the first Worker on this protocol in
production, and that changed it. It does not keep one object: it keeps one `Asset` object per
vehicle, each with its own outbox, and one `Fleet` object for the whole fleet. A package that put
every store in one class would put subscription tables in thousands of objects, when SUB-7 needs
them in exactly one.

**What was decided:**

- **One mixin per piece**: `withOutcomes` (ENDP-16), `withSubscriptions` (SUB-7), `withOutbox` and
  `withLogs` (LOG-2, LOG-7, LOG-8, ENDP-33, and what a Tail Worker writes). Each adds its tables
  and its RPC methods to whatever class it wraps, so each object carries only what it holds — in
  Soriana, subscriptions in `Fleet` and an outbox in every `Asset`; in `fleet-worker`, all four in
  its one object — and a mixin composes over another base class, such as an agent's.
- **The outbox holds the whole event.** `enqueue(at, publishables)` writes each `Publishable` with
  its id in the same transaction as the change it reports, and the row goes once it is sent. The
  domain's own retention then need not wait for what is pending, which Soriana coordinates by hand
  today, and the copy lives for the seconds it takes to leave.
- **It drains when the call ends and retries by the one alarm.** The domain calls `flush()` at the
  end of a method; a failed send schedules the alarm. A Durable Object has one alarm, so the
  domain asks for its own through `wakeAt(at)`, which keeps the earliest, and calls `super.alarm()`
  from its `alarm()`, which drains first — what Soriana does by hand for its deletion and its
  outbox, made general. A retry from the Worker's cron was rejected: with an object per vehicle,
  the cron would need an index of which objects have something pending.
- **Fan-out happens in the consumer of an events Queue.** `flush()` sends events to an events Queue
  with `sendBatch`. Its consumer reads the subscriptions once per batch — up to a hundred events
  for one call to the object that holds them — and leaves one delivery per matching subscription on
  a deliveries Queue, whose consumer runs `deliver()`. The broker, where one is declared, is
  published to from the same consumer, after the subscribers. Publishing from each object was
  rejected: a run touching thousands of vehicles would be thousands of calls to one object, and an
  outage of that object would leave every outbox retrying.
- **What is given up stays visible.** A delivery abandoned — refused for good, outside EVT-8's
  window, or out of `max_retries` — goes to a dead-letter queue that is inspected and never
  redriven, as Soriana's is, which is the only thing that sees what the platform drops after the
  last retry. Where the object carries `withLogs`, a `warn` record also names the subscription, the
  event and the reason, so an operator without access to the Cloudflare account reads it through
  the protocol. `deliver()` answers *given up* rather than only *done*, which is a change to
  `DeliveryOutcome` in `@worker-protocol/hono`; `fleet-worker` gains the dead-letter queue its
  README now argues against.

**Rejected, and why:**

- *One base class holding every store.* Right for `fleet-worker` and wrong for any Worker that
  shards its state, which the one in production does.
- *Plain functions over `SqlStorage`, wrapped by hand.* No inheritance at all, at the cost of a
  dozen one-line RPC wrappers per Worker per piece — the boilerplate a package exists to remove.
- *An outbox of ids, with the Worker rendering events when they are sent.* Nothing duplicated, but
  retention would still have to wait on what is pending, and the API would carry one more piece.
- *Publishing a prerelease for Soriana to adopt first*, or installing it from git: both put an
  untried shape where a deploy depends on it, when deploying `fleet-worker` costs nothing.

**Lands in:** `packages/cloudflare`; `examples/fleet-worker`, rebuilt on it; `DeliveryOutcome` in
`packages/hono`; `publish.yml` and `packages/README.md` when it is published.

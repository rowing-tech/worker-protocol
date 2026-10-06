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

## Subscriptions: a Worker that pushes its own events

**Decided 2026-10-06.** A consumer subscribes to a Worker over the Worker API, and the Worker keeps
the subscription and pushes each matching event to the consumer's sink. It is a tenth Capability,
`subscriptions`, beside `events` and not instead of it: a Worker publishes through a broker,
through its subscriptions, or both.

**Why the transport refusal does not reach it.** `spec/events.md` names no broker and fixes no
binding because doing so would mean a registry of transports. HTTP is not one of those: it is the
Worker API's own, with the credential REG-3 already fixes and the agreement a Contract already is
(EVT-5). And the consumers this network actually has — Convex apps, Control Towers, automations —
hold no consumer group, so EVT-6's relay is a component each of them would have to build. What it
costs is what `spec/tasks.md` says a nudge avoids, a delivery guarantee and something the receiver
holds, and that is specified rather than avoided, because unlike a Task an event cannot be derived
again by reading. *The owner knows nobody* still holds where it matters: the Worker's domain logic
publishes facts and names no subscriber, and the list belongs to the delivery machinery, which is
what a broker is.

**What was decided:**

- **The surface.** The entry declares an address and `abandonAfterSeconds`. `POST /subscriptions`
  takes `types`, optional `filters`, a `sink` and a `sinkCredential`; `GET` lists the caller's own
  in the page envelope; `DELETE /subscriptions/{id}` removes one.
- **Types against two lists.** Each type is one the `events` entry publishes (otherwise `400
  invalid_parameter`) and one the caller's Contract allows (otherwise `403 forbidden`).
- **Subscribing is idempotent.** The same caller with the same sink, types and filters gets the
  subscription that exists, answered `200`, so an orchestrator ensures its subscription on every
  deploy without keeping ids.
- **A subscription is its caller's**, with the identity ENDP-34 uses: only that caller lists or
  deletes it.
- **Delivery is the CloudEvents webhook specification.** Before a sink is accepted, the Worker runs
  its abuse-protection handshake (`OPTIONS` with `WebHook-Request-Origin`, answered with
  `WebHook-Allowed-Origin`), which is what stops a credentialed caller pointing the Worker at
  somebody else's URL. Each delivery is a CloudEvent in the HTTP binding, carrying `Authorization:
  Bearer <sinkCredential>` — REG-3 in the other direction, a credential the sink chose.
- **At least once, within EVT-8's window.** A `2xx` is delivered. A network failure, a `5xx`, a
  `408` or a `429` is retried with backoff, honouring `Retry-After`, only within the window EVT-8
  already declares: every retry is a republication the consumer's deduplication covers, so no
  second window is invented. Any other `4xx` is final for that event. No order is promised.
- **No renewal.** A subscription ends when its subscriber deletes it, when its sink has failed
  continuously for `abandonAfterSeconds`, or when the Worker no longer accepts its caller; in the
  last two cases the Worker makes one best-effort delivery of a `subscription-ended` event. Each
  listed subscription carries `lastDeliveredAt`, and `failingSince` while it fails. None of the
  three endings is silent, which a lease an automation forgot to renew would have been.
- **Filters are the six dialects the CloudEvents Subscriptions API requires** — `exact`, `prefix`,
  `suffix`, `all`, `any`, `not` — with its JSON shape, over context attributes, all of the list
  holding. Their semantics are written out in our own text rather than cited, because that API is
  `0.1-wip`. `sql` is left out; it can arrive in a MINOR. No JavaScript library implements the
  dialects, and the six are a few dozen lines.
- **The broker becomes optional.** EVT-11 is withdrawn and reissued with the broker, the
  `protocolBinding` and the destination declared together or not at all, and a new rule has a
  Worker that declares `events` declare a broker, `subscriptions`, or both.
- **The specification names the lifecycle events of Tasks and Alerts**, which answers the second
  entry of *Still open here* in `spec/events.md`. The typical subscription is *a Task of type X was
  raised*, filters reach only context attributes, so the name and the attribute have to agree on
  every Worker. Publishing them is not required; a Worker that does uses these types:
  `tech.rowing.worker-protocol.task-raised` and `task-resolved`, with the Task type in `subject`,
  and `alert-raised` and `alert-cleared`. *Resolved* and *cleared*, because nobody closes a Task
  (TASK-15).
- **An incompatible change inside 0.x, made by rule rather than by exception.** An `events` entry
  without a broker is not something a 0.3 reader may ignore, so DESC-24 would ask for a MAJOR. The
  protocol is published and not yet in use, and 1.0 is not worth spending on this. DESC-24 and
  DESC-25 are withdrawn and reissued with SemVer's convention for `0.x`, which `packages/README.md`
  already applies to package versions: while the MAJOR is 0, a MINOR may change what a reader
  cannot ignore, and a verifier that does not hold the declared MINOR verifies nothing and says it
  is the one behind. This is edition 0.4.
- **The split of the implementation follows `OutcomeStore`.** `mount()` serves `/subscriptions` —
  validation, idempotence, types against `publishes` and the Contract, the caller scope, the
  handshake — and hands the Worker a `publish(event)` that matches filters and queues one delivery
  per subscription, and a `deliver()` holding the retry decisions. What depends on the platform is
  behind a `SubscriptionStore`, which has to be consistent for subscribing to stay idempotent, and
  a `DeliveryQueue`. On Cloudflare, subscriptions live in a Durable Object and deliveries on Queues,
  which already retry with a delay and keep a dead-letter queue. The first implementation goes in
  `examples/fleet-worker`, and moves to `@worker-protocol/cloudflare` once it has run.
- **`@worker-protocol/client` gains both halves**: subscribing, listing and unsubscribing, and a
  sink helper — the handshake, the bearer check, deduplication by `source` and `id` — which is what
  a Convex HTTP action needs to receive.

**Rejected, and why:**

- *An SDK feature with no specification.* Each Worker would manage subscriptions its own way, and
  neither the client nor a Tower could subscribe to an arbitrary Worker.
- *The CloudEvents Subscriptions API by reference.* It is `0.1-wip`, and its shape — protocols,
  per-protocol configuration, SQL — is broader than this network needs. Its required filter
  dialects are adopted, written out.
- *The Worker declared as its own broker, keeping EVT-11.* Compatible with 0.3 readers, at the cost
  of declaring the address twice. The `0.x` rule makes the clean form possible without 1.0.
- *Releasing it as 1.0.* Spends the MAJOR on a change nobody in practice is exposed to.
- *HMAC signatures* (Standard Webhooks). A secret to generate, return and rotate per subscription,
  and they do not stop flooding without the handshake as well.
- *A renewable lease.* A subscription would end silently when an automation forgot to renew it.
- *Best-effort delivery, like a nudge.* A lost event cannot be read back.
- *Filtering by type only.* It cannot say *a Task of type X*. And *`sql` now*: no JavaScript
  implementation, and nothing needs it yet.
- *Retries in a Durable Object with alarms.* One alarm per object means keeping a retry queue by
  hand, and every delivery through one single-threaded object.

**Settled while writing it down, and open to change before it is built:**

- Structured mode (`application/cloudevents+json`) for deliveries, the simplest for a Convex HTTP
  action to receive.
- The handshake runs when the subscription is created; a sink that refuses it is `422
  unprocessable_content`, and nothing is stored.
- Another caller's subscription is `404`, so nobody learns that it exists.
- An Alert event carries the Alert id in `subject`; `task-resolved` carries `{ id, type }` and
  `alert-cleared` carries `{ id }`; the final event is
  `tech.rowing.worker-protocol.subscription-ended`, with the reason.
- Revocation is an optional hook in which the Worker says whether it still accepts a caller;
  without it, a subscription ends only by deletion or abandonment.

**Lands in:** `spec/subscriptions.md`, a new file with a prefix of its own; `spec/events.md`,
`spec/descriptor.md`, `spec/tasks.md` and `docs/architecture.md`; `schemas/`; `packages/hono`,
`packages/client` and `packages/conformance`; `examples/fleet-worker`. Edition 0.4, packages 0.6.0.

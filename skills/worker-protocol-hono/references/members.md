# Every member of the `Worker` type

What `defineWorker` takes. A member left out is a Capability not declared and an address not served.
Each signature is the shape; `node_modules/@worker-protocol/hono/dist/worker.d.ts` carries the types
and the rule each one cites.

## Beside `id`, and not a Capability

- `id: string` — the Worker's own name, deployed with it, never the URL (DESC-6, DESC-27).
- `authenticate: (token) => "accepted" | "unauthenticated" | "forbidden" | "unavailable"`, or a
  promise of one. It may await: validating a token against an identity provider is a network call
  (REG-3). Accepting may answer `{ verdict: "accepted", principal, caller }` instead, both optional:
  `principal` reaches an Action's `run` and `tasks.covers(token, principal)`, so neither looks the
  holder up again, and `caller` is the stable string a header idempotency key is scoped to
  (ENDP-34). `"unavailable"` means the check could not run — the provider is down, rate limited or
  silent — and `mount()` answers `503`, `retry`; `{ verdict: "unavailable", retryAfter }`, whole
  seconds, adds `Retry-After`. A throw from it, or from the builder, is answered `500`
  `internal_error` in the envelope; an `onError` set on the app after `mount()` replaces that.
- `skills: { [type]: { payload?, produces?: { [action]: schema } } }` — the Task types this Worker
  answers: what it needs to receive, and what it hands back for each of the owner's answering
  Actions it can perform, by that Action's name (TASK-36). It sits at the root because a Skill is
  served at no address — it is what the Worker *is*, where a Capability is what it *serves*.
- `edition?: string` — only to pin the edition verified against. Otherwise the package's.

## The nine Capabilities

- `health: () => ({ status, checks })` — one status, named checks beneath it. Never better than its
  checks (HLTH-3).
- `metrics: { timeZone, publishes, read({ metric, granularity, buckets, fixed, by }) }` — answer
  `{ start, value }` per bucket there is a number for, omitting the rest (MET-15).
- `actions: { accepts, settings?, outcomes?, covers? }` — `covers(token, principal)` answers the
  Action names the credential covers, or `undefined` for all: `mount()` answers any other declared
  Action `403` before the body and the key, and leaves it out of `available` (ACT-22, TASK-44).
  Each entry of `accepts` is
  `action({ input, result?, idempotency?, completesWithinCall?, supersededBy?, refuses?, run })`.
  `refuses(input, call)` answers why the current state does not allow it, or `undefined`:
  `mount()` asks it after a repeat is replayed and before `run`, answering `409 conflict`, and asks
  it of every open Task the Action answers with that Task's `inputs`, leaving refused answers out
  of `available` (ACT-17, TASK-38). The input it gets may be partial.
  `run(input, call)` is told `call.name`, `call.token`, `call.idempotencyKey` — the key as the
  caller sent it — `call.principal`, `call.caller`, `call.trace` — the trace the call belongs to,
  continued from `traceparent` or begun by `mount()` (ENDP-42): record under `traceId` and `spanId`,
  send `traceparentOf(call.trace)` to any Worker this one calls — and `call.task`, the open Task a
  call named in `Worker-Protocol-Task`. `mount()` has already refused one that is not open (`404`,
  TASK-39), whose type does not list the Action (`400`, TASK-40) or that does not offer it now
  (`409`, TASK-41), after the key, so a repeat is replayed first (TASK-42), and a header key naming
  another Task is `409` (TASK-43). Publish `taskAnswered({ task: call.task, action: call.name,
  at })` from `run`, which a repeat never reaches (EVT-20, EVT-21). A Worker forwarding to another
  derives its downstream key from the key and the caller together. `idempotency` is
  `{ from: "header" }` or
  `{ from: "input", members: [...] }`, several members making one key in order (ENDP-38). An
  asynchronous Action's declared `result` is the body of its `202` (ACT-18). Mark a `configure`
  secret with `.meta({ writeOnly: true })`: `mount()` leaves it out of the reading address and
  keeps it when a form omits it (ACT-20, ACT-21). `supersededBy` names the Action in `accepts` that
  replaces this one, which is still answered as declared (NAME-10).
- `alerts: () => Alert[]` — `{ id, severity: "warning" | "critical", since, summary, actions,
  inputs? }`. `inputs` fills in, per offered Action and member, what the Alert already knows
  (ALRT-9).
  `since` is when the condition began (ALRT-3).
- `activity: () => Activity[]` — `{ id, state, since, summary }`, state being `scheduled`, `pending`
  or `running` (ACTV-4).
- `nudges: (type) => void` — note the type and read the work sooner. Optional, and what it buys is
  latency alone (TASK-19).
- `tasks: { raises: { [type]: { payload, answeredBy?: string[], supersededBy? } }, dimensions?:
  string[], current(), read?, covers?, pageSize? }` — `answeredBy` names every Action of the
  Worker's own that answers the type, and is absent or empty for a type no Action answers, whose
  condition clears on a Fact (TASK-35); `current()` derives the open Tasks on every read, because
  nobody closes one (TASK-15). Each may carry `inputs` — per answering Action and member, what the
  Task already knows (TASK-37) — `available`, the answers that apply now (TASK-38) — and
  `dimensions`, one string per declared dimension it is about (TASK-47). `dimensions` on the entry
  declares the names a read may fix (TASK-45, TASK-48).
  `read({ type?, dimensions, cursor?, limit })` answers `{ tasks, nextCursor? }` from the Worker's
  own index, where it has one; without it `mount()` filters and pages `current()`.
- `events: { broker, protocolBinding, destination, publishes: { [type]: { data, extensions?,
  supersededBy? } }, republishWindowSeconds? }` — a declaration only. No address is served
  (EVT-13). `extensions` is a Zod schema per extension attribute its events carry (EVT-17); the hub
  refuses an event carrying any other, and refuses at construction a name that is not lower-case
  letters and digits or is a CloudEvents context attribute (EVT-18, EVT-19). Spread
  `lifecycleEvents({ tasks, answers, alerts })` into `publishes` for the EVT-15 types and EVT-20's
  `task-answered`, with their data and extensions. `answers` is its own flag because it is published
  from `run` and not where Tasks are raised; declare it only where something publishes it. A Task
  type's or an event type's `supersededBy` names its replacement in the same map, as an Action's
  does.
- `subscriptions: { abandonAfterSeconds, store, queue, allows?, accepts?, insecureSinkOrigins?,
  attemptTimeoutMs? }` — `store` a consistent `SubscriptionStore` (a Durable Object, or
  `memorySubscriptions()` in one process), `queue` a `DeliveryQueue` whose consumer calls
  `eventHub(...).deliver`. `allows` is the Contract (SUB-4), `accepts` revocation (SUB-14),
  `insecureSinkOrigins` a development allowlist, `attemptTimeoutMs` how long one attempt at a sink
  may take (ten seconds). `events` may then declare no broker (EVT-13). The hub also offers
  `end(id, reason)` to end a subscription yourself — `withdrawn` or `revoked`, announced and kept
  (SUB-15) — `wanted(events)` to leave out of an outbox what no live subscription would receive
  (`wantedBy` does the same synchronously with no hub, and `withSubscriptions` answers
  `wantedHere` inside the Durable Object that holds them),
  and `route`, `deliverAll` and `later` for a carrier that makes the first attempt itself, as
  `consumeQueues` does.
- `grants: { store, applicants(caller, principal) }` — `store` a `GrantStore` (`memoryGrants()` in
  one process); `applicants` which callers may apply, required, and `mount()` refuses to build
  without it (GRANT-2). The applicant is the `caller` your `authenticate` names, and a caller it
  names nothing for is refused `403` without `applicants` being asked — a Worker holding one static
  secret names its one caller. Name a stable identity there, never the id of a key: rotating that
  key would orphan every grant it applied, and every series counted under them.
  `mount()` mints each credential, answers it once and keeps only its SHA-256; a presented
  credential is looked up by digest before `authenticate`, on every request that carries one, so
  index the digest and answer a miss cheaply. `put(grant, expected)` compares the serial it holds
  with `expected` (`null` for none) and writes only on a match — make that one atomic write, as
  `SubscriptionStore.ensure` is; a lost race is answered `503` and the applicant retries. What a
  grant's credential covers is bounded by its grant, and your own `tasks.covers`, `actions.covers`
  and `subscriptions.allows` are still asked and may only narrow inside it (GRANT-8). It is `403`
  on health, metrics, alerts, activity, logs and settings (GRANT-10). Hand `eventHub` the same
  store as `grants: { store }`, so a subscription a narrowed, rotated or revoked credential made
  ends as `revoked` before its next delivery (GRANT-9). `call.grant` is `{ applicant, id }` for a
  call a grant's credential made: hand it to `taskAnswered({ ..., grant: call.grant })` and the
  applicant's deliveries carry `contract` (EVT-22); record `contractKey(call.grant)` under a
  `contract` dimension and `mount()` turns a caller's `contract=<id>` into the same key, so nobody
  else's id ever matches (MET-23). The key is opaque: store it exactly as returned, and declare
  `contract: {}` with no values — `mount()` refuses a set, which would let anybody break it down.
  `grant` lives on the `Publishable` in memory only: a Worker that publishes from an outbox stores
  `call.grant` with the row and hands it back to `taskAnswered`, or the applicant's delivery loses
  `contract` without a word. What goes to a broker never carries it — `envelopeOf` leaves it out,
  and a Worker publishing to one by hand must too (EVT-22).
- `logs: { read({ levels, from, to, trace?, cursor, limit }), pageSize? }` — answer
  `{ records: [{ at, level, message, fields?, traceId?, spanId? }], nextCursor? }`, most recent
  first. `levels` arrives expanded and in order, lowest first, so the ladder never needs
  re-deriving; `trace` arrives validated, and a page asked for one carries only records of it
  (LOG-12). A record written in a call carries `call.trace.traceId` and `call.trace.spanId`
  (LOG-11); one written by a cron carries neither.

## Also exported

- `action()` — declares one Action and infers `run`'s parameter from the Zod object beside it.
- `memoryGrants()` — a grant store for one long-lived process, on `memoryOutcomes()`'s terms.
- `memoryOutcomes()` — an idempotency store for one long-lived process. Wrong anywhere that scales
  horizontally; back it with a durable object, KV or a table instead.
- `jsonSchema()` — the JSON Schema for a Zod object, for a case that needs it in hand.
- `eventHub({ id, events, subscriptions })` — the same objects the Worker hands `mount()`, so an
  event's `source` is the Worker's id and every retry is bound by its declared window.
  `publish(event)` from your own code when a Fact changes (a type `events` does not declare throws),
  and `deliver(delivery)` from the queue consumer, which answers whether to retry.
  `memorySubscriptions()` and `memoryDeliveries()` are the one-process pair.
- `taskRaised`, `taskEnded`, `alertRaised`, `alertEnded` — build lifecycle events with the names and
  shape EVT-15 fixes, and `taskAnswered({ task, action, at })` EVT-20's, with `at` as its `time`.
  `lifecycleChanges({ previous, current })` compares two snapshots by id, for a Worker that chooses
  to; nothing calls it on its own.
- `CODES` and `ErrorCode` — the closed refusal vocabulary, each code with its status and class.
- `bucketsIn`, `startOf`, `endOf`, `rfc3339` — metric boundaries and the instant format.
- `LEVELS`, `LogLevel`, `LogRecord`, `LogQuery`, `LogPage`, `LogFacts` — the `logs` vocabulary.
  `LEVELS` is the ladder in order, which is what a level floor is read off.
- The route objects `openapi/` is generated from: `readDescriptor`, `pollHealth`, `readMetric`,
  `performAction`, `readTasks`, `readAlerts`, `readActivity`, `readLogs`, `takeNudge`. Mounting them
  in an app means asking that app for its own OpenAPI document and getting one that describes *this*
  Worker, with its Actions and its Task payloads in it.

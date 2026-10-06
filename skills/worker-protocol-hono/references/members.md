# Every member of the `Worker` type

What `defineWorker` takes. A member left out is a Capability not declared and an address not served.
Each signature is the shape; `node_modules/@worker-protocol/hono/dist/worker.d.ts` carries the types
and the rule each one cites.

## Beside `id`, and not a Capability

- `id: string` — the Worker's own name, deployed with it, never the URL (DESC-6, DESC-27).
- `authenticate: (token) => "accepted" | "unauthenticated" | "forbidden"`, or a promise of one. It
  may await: validating a token against an identity provider is a network call (REG-3). Accepting
  may answer `{ verdict: "accepted", principal, caller }` instead, both optional: `principal`
  reaches an Action's `run` and `tasks.covers(token, principal)`, so neither looks the holder up
  again, and `caller` is the stable string a header idempotency key is scoped to (ENDP-34).
- `skills: { [type]: { payload?, produces? } }` — the Task types this Worker answers: what it needs
  to receive, and what it hands back (TASK-33). It sits at the root because a Skill is served at no
  address — it is what the Worker *is*, where a Capability is what it *serves*.
- `edition?: string` — only to pin the edition verified against. Otherwise the package's.

## The nine Capabilities

- `health: () => ({ status, checks })` — one status, named checks beneath it. Never better than its
  checks (HLTH-3).
- `metrics: { timeZone, publishes, read({ metric, granularity, buckets, fixed, by }) }` — answer
  `{ start, value }` per bucket there is a number for, omitting the rest (MET-15).
- `actions: { accepts, settings?, outcomes? }` — each entry of `accepts` is
  `action({ input, result?, idempotency?, completesWithinCall?, supersededBy?, run })`.
  `run(input, call)` is told `call.name`, `call.token`, `call.idempotencyKey` — the key as the
  caller sent it — `call.principal` and `call.caller`. A Worker forwarding to another derives its
  downstream key from the key and the caller together. `idempotency` is `{ from: "header" }` or
  `{ from: "input", members: [...] }`, several members making one key in order (ENDP-38). An
  asynchronous Action's declared `result` is the body of its `202` (ACT-18). Mark a `configure`
  secret with `.meta({ writeOnly: true })`: `mount()` leaves it out of the reading address and
  keeps it when a form omits it (ACT-20, ACT-21). `supersededBy` names the Action in `accepts` that
  replaces this one, which is still answered as declared (NAME-10).
- `alerts: () => Alert[]` — `{ id, severity: "warning" | "critical", since, summary, actions }`.
  `since` is when the condition began (ALRT-3).
- `activity: () => Activity[]` — `{ id, state, since, summary }`, state being `scheduled`, `pending`
  or `running` (ACTV-4).
- `nudges: (type) => void` — note the type and read the work sooner. Optional, and what it buys is
  latency alone (TASK-19).
- `tasks: { raises: { [type]: { payload, answeredBy?, supersededBy? } }, current(), covers?,
  pageSize? }` — `answeredBy` is absent for a type no Action answers, whose condition clears on a
  Fact (TASK-34); `current()` derives the open Tasks on every read, because nobody closes one
  (TASK-15).
- `events: { broker, protocolBinding, destination, publishes: { [type]: { data, supersededBy? } },
  republishWindowSeconds? }` — a declaration only. No address is served (EVT-13). A Task type's or
  an event type's `supersededBy` names its replacement in the same map, as an Action's does.
- `subscriptions: { abandonAfterSeconds, store, queue, allows?, accepts?, insecureSinkOrigins? }` —
  `store` a consistent `SubscriptionStore` (a Durable Object, or `memorySubscriptions()` in one
  process), `queue` a `DeliveryQueue` whose consumer calls `eventHub(...).deliver`. `allows` is the
  Contract (SUB-4), `accepts` revocation (SUB-14), `insecureSinkOrigins` a development allowlist.
  `events` may then declare no broker (EVT-13).
- `logs: { read({ levels, from, to, cursor, limit }), pageSize? }` — answer
  `{ records: [{ at, level, message, fields? }], nextCursor? }`, most recent first. `levels` arrives
  expanded and in order, lowest first, so the ladder never needs re-deriving.

## Also exported

- `action()` — declares one Action and infers `run`'s parameter from the Zod object beside it.
- `memoryOutcomes()` — an idempotency store for one long-lived process. Wrong anywhere that scales
  horizontally; back it with a durable object, KV or a table instead.
- `jsonSchema()` — the JSON Schema for a Zod object, for a case that needs it in hand.
- `eventHub({ id, events, subscriptions })` — the same objects the Worker hands `mount()`, so an
  event's `source` is the Worker's id and every retry is bound by its declared window.
  `publish(event)` from your own code when a Fact changes (a type `events` does not declare throws),
  and `deliver(delivery)` from the queue consumer, which answers whether to retry.
  `memorySubscriptions()` and `memoryDeliveries()` are the one-process pair.
- `taskRaised`, `taskEnded`, `alertRaised`, `alertEnded` — build lifecycle events with the names and
  shape EVT-15 fixes. `lifecycleChanges({ previous, current })` compares two snapshots by id, for a
  Worker that chooses to; nothing calls it on its own.
- `CODES` and `ErrorCode` — the closed refusal vocabulary, each code with its status and class.
- `bucketsIn`, `startOf`, `endOf`, `rfc3339` — metric boundaries and the instant format.
- `LEVELS`, `LogLevel`, `LogRecord`, `LogQuery`, `LogPage`, `LogFacts` — the `logs` vocabulary.
  `LEVELS` is the ladder in order, which is what a level floor is read off.
- The route objects `openapi/` is generated from: `readDescriptor`, `pollHealth`, `readMetric`,
  `performAction`, `readTasks`, `readAlerts`, `readActivity`, `readLogs`, `takeNudge`. Mounting them
  in an app means asking that app for its own OpenAPI document and getting one that describes *this*
  Worker, with its Actions and its Task payloads in it.

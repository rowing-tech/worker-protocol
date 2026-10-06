# Changelog

Every release of the four packages this repository publishes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), with one addition this repository needs.

**Each entry names the edition it encodes as well as its version, because the two are independent
and neither can be read off the other.** A package version is SemVer and describes what the package
exports; an **edition** is `MAJOR.MINOR` and describes the protocol. Most releases here move the
first and not the second. The rule that binds them is that an edition change never arrives in a
release a consumer's caret would take on its own — `pnpm release:check` holds it, and an entry that
carries one says so under a heading of its own, because it is the only change that can put a Worker
out of reach of tools built for the edition before.

What changed inside a rule is not written here. Each file in [`spec/`](spec/) ends with a
`Withdrawn` list carrying the id, what it required and what replaced it, beside the argument that
justifies it. This file says what a release carried; those say what a rule became.

## [Unreleased]

The packages encode **edition 0.4**, which breaks what a 0.3 reader assumed — an `events` entry may
now declare no broker — and is a MINOR anyway, under the rule this edition adopts: until 1.0, a
MINOR may break as a MAJOR does (DESC-32). A verifier on 0.3 meeting a 0.4 Worker now says it is
behind rather than judging it (DESC-33). The release that carries it is a MINOR of the packages,
which `^0.5.0` does not take.

### Edition 0.4

- **`subscriptions`, a tenth Capability** (`spec/subscriptions.md`, SUB-1 to SUB-16). A consumer
  subscribes to a Worker over the Worker API and the Worker pushes every matching event to the
  consumer's sink: validated first by the CloudEvents webhook handshake, delivered as a structured
  CloudEvent with the sink's own bearer, at least once within EVT-8's window. Subscribing is
  idempotent and nothing is renewed; a subscription ends when its subscriber ends it, when its sink
  has failed for `abandonAfterSeconds`, or when its caller is no longer accepted — and the last two
  are announced and left listed. Filters are the six dialects the CloudEvents Subscriptions API
  requires. Ending one is `DELETE ?subscription=<id>` on the declared address.
- **An audit of every prohibition against the argument written for it.** Where the argument earned
  less than the rule forbade, the rule was narrowed and reissued; where it earned the whole but the
  argument was missing, the argument was written. Reissued, with what each now allows:
  - DESC-35 and DESC-36 (were DESC-3 and DESC-12): `http` on a loopback host, where no network is
    crossed. A Worker on a developer's machine no longer fails the base-URL rule.
  - DESC-37 (DESC-11): only conditions that change what a caller sends, or whether it may repeat a
    call, are declared.
  - DESC-38 (DESC-30): a consumer does not retry an address that serves nothing, and may read the
    Descriptor again later.
  - ENDP-37 (ENDP-5): `Worker-Protocol-Capability-Version` only where a Capability answered; not on
    the Descriptor's route or a `404` for an undeclared address.
  - ENDP-38 and ACT-19 (ENDP-15, ACT-12): an input key may be several members, in order —
    `members` replaces `member` in the idempotency declaration.
  - ENDP-39 and ENDP-40 (ENDP-25, ENDP-29): the error envelope and the status table bind `4xx` and
    `5xx`. ENDP-41 is new: a `304` to a conditional read is allowed, and a redirect never is, since
    it would take a credential to an undeclared address.
  - ACT-17 (ACT-9): a refusal caused by the current state is `409 conflict`.
  - ACT-18 (ACT-11): a `202` carries the result the Action declares.
  - ACT-20 and ACT-21 (ACT-14, ACT-15): a `writeOnly` member is never read back, and a `configure`
    that omits it keeps it.
  - ALRT-8 and ACTV-7 (ALRT-5, ACTV-5): a Worker's own Action may change an Alert's condition or
    stop an activity; what stays forbidden is somebody declaring either ended.
  - REG-34 (REG-21): the recorded credential is accepted on the Descriptor and every reading
    address; a write may refuse it `403`.
  - REG-35 (REG-13): a Tower rebinds an enrollment only when a person directs it.
  - TASK-33 and TASK-34 (TASK-31, TASK-32): `skills` may be empty, and a Task type may name no
    answering Action.
  - MET-22 (MET-20): the declared zone cuts the buckets of a caller with no other agreement.
  - EVT-16 (EVT-9): only the declared destinations must carry nothing but declared events.
- **Arguments written where they were missing**, scope unchanged: REG-24, DESC-6, NAME-7, NDG-2,
  HLTH-2, HLTH-4, MET-3, MET-4, MET-7, MET-15, TASK-8, LOG-9 and ACTV-4. LOG-10, ALRT-6 and ACTV-6
  now say outright what REG-8 already meant: refusing a caller the surface with `403` is not varying
  it by caller.
- **DESC-2 is withdrawn for DESC-34**: Capabilities are still declared or left out freely and
  conformance requires none of them, but the clause that no Capability is a precondition of another
  is gone. It was never argued, and EVT-14 contradicted it.
- **EVT-1 binds the events a Worker publishes**, which is all it ever meant: `subscription-ended`
  is addressed to one subscriber and declared under no `publishes`.
- **ENDP-3 is withdrawn for ENDP-36**: an operation a Worker defines is still a POST, and where this
  protocol fixes an operation itself, that surface's file fixes its verb. The old rule's second
  sentence — this protocol defines no PUT, PATCH or DELETE — was never argued, and forbade the
  DELETE that ends a subscription.
- **The broker becomes optional.** EVT-11 is withdrawn: EVT-13 has the broker, the
  `protocolBinding` and the destination declared together or not at all, and EVT-14 has a Worker
  that declares `events` declare a broker, `subscriptions`, or both.
- **The lifecycle of Tasks and Alerts is named** (EVT-15): `task-raised`, `task-ended`,
  `alert-raised` and `alert-ended`, under `tech.rowing.worker-protocol`. `subject` is the resource's
  id and `tasktype` or `alertseverity` the extension a subscriber filters on. *Ended* says the
  condition stopped holding and nothing about why. Publishing them is optional; their names are not.
- **Until 1.0, a MINOR may break.** DESC-24 and DESC-25 are withdrawn for DESC-32, which adds
  SemVer's `0.x` clause, and DESC-33, which has a verifier behind on MINOR verify nothing while the
  MAJOR is 0. The withdrawn rules carry their class, reach and editions in their `Withdrawn`
  entries, and a Worker of 0.3 is still judged by them (DESC-31).
- **A declaration may name what replaces it** (NAME-10). An Action, a Task type or an event type
  carries an optional `supersededBy`: another member of the same map, and followed from anywhere it
  ends at one that names none. A breaking change to a payload already took a new name under NAME-2;
  now the Descriptor says which name replaces which, instead of a reader guessing from the spelling.
  It changes nothing on a call, carries no date and claims nothing about compatibility.
- **A Tower compares what changed under a kept name** (REG-36, recommended). Against the copy it
  held, it shows the operator every Action, Task type and event type whose schema now refuses a
  document the other side accepted, in NAME-6's direction. It reaches the half of NAME-5 a schema
  can show; a Tower that shows nothing has certified nothing. `naming.md` no longer says the
  discovery of a payload change is a `400` naming the version, which was only ever true of a
  Capability's own surface.

### Added

- **`@worker-protocol/schemas`**: `subscriptionsEntry`, `subscriptionRequest`, `subscriptionFilter`,
  `subscription`, `subscriptionPage`, `subscriptionReceipt`, `subscriptionEnded` and its reason,
  and `taskEnded` and `alertEnded`, the data of two lifecycle events. `subscriptions` is a reserved
  Capability name.
- **`@worker-protocol/hono`**: `mount()` serves `/subscriptions` — validation, the Contract hook
  `allows`, the sink rules with an `insecureSinkOrigins` list for development, the handshake,
  idempotence, the caller scope. `eventHub({ id, events, subscriptions })` — the Worker's own
  declaration, so an event's `source` and its retry window cannot drift from the Descriptor, and a
  type `events` does not declare is refused — publishes and delivers, behind a `SubscriptionStore`
  and a `DeliveryQueue`, with `memorySubscriptions()` and `memoryDeliveries()` for one process.
  `taskRaised`, `taskEnded`, `alertRaised` and `alertEnded` build lifecycle events, and
  `lifecycleChanges()` compares two snapshots for a Worker that chooses to; nothing detects them on
  its own.
- **`@worker-protocol/conformance`**: the `subscriptions` checks, with two new arrangements — a
  `sink` the Worker can reach and a `publishingAction` that makes it publish — and EVT-13 and
  EVT-14 judged off the Descriptor. NAME-10 is judged off the Descriptor too: a replacement the map
  does not hold, or a chain that returns to where it started, fails it.
- **`@worker-protocol/schemas`**: `supersededBy` on `actionDeclaration`, `taskTypeDeclaration` and
  `eventTypeDeclaration`, a qualified name on the last two.
- **`@worker-protocol/hono`**: `supersededBy` on an Action and on a Task type in `raises`, written
  into the Descriptor as declared; an event type carries it already, being the schema's own shape.
- **`@worker-protocol/client`**: `subscriptions` on `consume()` — `subscribe`, which says whether
  the subscription is new, `list` and `unsubscribe` — and `sink()`, the receiving end: the webhook
  handshake, the sink's own credential, structured CloudEvents only, and each event handed over
  once within its window, behind a `SeenStore` with `memorySeen()` for one process.
- **`@worker-protocol/client`**: `compare({ before, after })`, REG-36's comparison of two copies of
  one Descriptor, beside `canAnswer` and for the same reason. Each `Change` names the schema, the
  declaration, the member and why, and is `breaking` or `unjudged` — the second for a keyword it
  does not read, said rather than passed.

### Changed

- **`@worker-protocol/hono`**: `serve()` inside `mount()` takes its route as one named object, and
  one address may serve more than one operation behind a single guard. `Surface.route` in
  `surfaces.ts` is now `routes`, a list.
- **`@worker-protocol/conformance`**: `checkEvents` and `judgeTranscript` take one named object.
  `CHANGELOG.md` may cite a withdrawn id, since a release note names the rule a release carried.

### Upgrading

- An Action keyed by its input declares `members: ["…"]` where it declared `member: "…"`.
- A Worker that declares a broker needs no change. One that publishes only through `subscriptions`
  declares none of the three broker members.
- `@worker-protocol/conformance` on 0.5 judges a 0.4 Worker by nothing, and says it is behind.

## [0.5.0] - 2026-10-02 — edition 0.3

All four packages encode **edition 0.3**, a MINOR under DESC-24: a caller holding 0.2 retries
under its own key as it always did, and nothing it sends or reads changes on the wire. The release
that carries it is a MINOR of the packages, which `^0.4.0` does not take.

### Edition 0.3

- **ENDP-34: a key read from the `Idempotency-Key` header is scoped to the caller that presented
  it**, so the same key from two callers is two keys. **ENDP-35: a key read from a declared member
  of the input is scoped to the Action**, so any caller sending it names the same performance.
  ENDP-16, ENDP-17 and ENDP-32 hold within that scope and keep their ids: they never said what a
  key's scope was, so no verdict of theirs changes. The question leaves `docs/undecided.md`.
- **DESC-31: a verifier holding a later MINOR judges a Worker only by the rules the edition it
  declares contains**, including rules a later edition withdrew. A 0.2 Worker that deduplicates
  globally is correct in 0.2, and is reported `notExercised` for ENDP-34 rather than failed.
- `spec/tasks.md` and `docs/architecture.md` no longer say that *an Action that declares an
  idempotency key is performed once however many times it is posted*: with header keys from two
  consumers that was false under any scope, and it now holds for a key read from the input.

### Added

- **`@worker-protocol/hono`: `authenticate` may name the caller**, as
  `{ verdict: "accepted", principal, caller }`, both optional. `caller` is a stable string for
  whoever the Worker's lookup found — not the token, which changes on rotation — and it is the one
  thing `mount()` reads: a header key is reserved under it. It reaches `run` as `ActionCall.caller`.
  Without it, every caller shares one scope, as in 0.4.
- **`@worker-protocol/conformance`: ENDP-34 and ENDP-35 are checked**, by playing two callers. The
  arrangement gains `otherCallerCredential`, a credential the Worker attributes to another caller;
  `secondSafeAction`, a safe Action whose key comes from the origin `safeAction`'s does not; and
  `otherInput` on either, a second input its schema accepts.
- **`@worker-protocol/conformance`: every rule records the edition that introduced it** as
  `introducedIn` in `rules.json` and `universe()`, and a rule an edition published and a later one
  withdrew stays in the universe with `withdrawnIn`. A Worker declaring an earlier MINOR is judged
  by its own edition's rules (DESC-31), and each later one says which edition it belongs to.

### Changed

- **`@worker-protocol/hono`: the key an `OutcomeStore` receives is `JSON.stringify([name, caller,
  key])`**, where it was `${name}:${key}`. `caller` is `null` for an input key and for a header key
  whose verdict names no caller. A separator could be forged by any part: an Action name is any
  string and an input key is whatever the input carries, so `a` with `b:c` met `a:b` with `c`. The
  format was always private to the package, and no store has to change.

### Fixed

- **`@worker-protocol/conformance`: ENDP-17 no longer fails a Worker whose input schema admits no
  extra member.** Its second body added a member to the input, which such a schema refuses with
  `400` before the key is looked at. It now sends `otherInput` where one is named, and without one
  reports that `400` as `notExercised`.

### Upgrading

The reserved key changes twice, and each time a retry that spans the deployment can miss its record
and be performed a second time, at most within the window the Action declares:

- **On upgrading the package**, for every keyed Action: `${name}:${key}` becomes
  `[name, null, key]`.
- **On the deployment that first answers a `caller`**, for header keys only, since naming a caller
  is opt-in: `[name, null, key]` becomes `[name, caller, key]`.

`ActionCall.idempotencyKey` is still the key as the caller sent it, so a Worker that derives a
downstream key from it sees nothing move on upgrade. A forwarder that starts folding `caller` into
that derivation — which is what keeps two callers' header keys apart downstream — moves its
downstream key in the same deployment, with the same bounded exposure.

## [0.4.0] - 2026-09-28 — edition 0.2

Every change in `@worker-protocol/hono` below is additive: a Worker, a builder and a store written
for 0.3 compile and behave as they did. It is a MINOR because it adds to what the package exports,
and `^0.3.1` does not take it, so the fix to LOG-8 below arrives with an upgrade somebody chooses.
No rule changed, and the edition is still 0.2.

### Added

- **`@worker-protocol/hono`: an Action's `run` is told the idempotency key its call arrived
  under.** `ActionCall.idempotencyKey` is the key as the caller sent it, read from the header or
  from the declared member of the input, and absent where the Action takes no key or none was sent.
  It is for a Worker that performs by asking another: a repeat reaches `run` only after an earlier
  performance threw or refused and gave its key back, and the Worker downstream may already have
  acted, so the key sent there has to be made from this one for ENDP-16 to hold end to end.

  A consumer that wrapped its `OutcomeStore` to capture the key `begin()` received can drop the
  wrapper, which depended on the store's private `${name}:${key}` format. **Keep the downstream key
  the same across the upgrade:** if it was derived from what `begin()` saw, derive it from
  `` `${call.name}:${call.idempotencyKey}` `` now, or a repeat that spans the deployment reaches
  the other Worker under a new key and is performed there a second time. The key is not scoped to
  the caller that presented it — that is still open in `docs/undecided.md` — so a forwarder serving
  several callers keeps theirs apart in the derivation.

- **`@worker-protocol/hono`: `authenticate` may say whom it accepted.** It may answer
  `{ verdict: "accepted", principal }` as well as the bare string, and `principal` reaches the two
  callbacks that already receive the token: `ActionCall.principal` and the second argument of
  `tasks.covers`. What it is belongs to the Worker; `mount()` carries it and never reads it. The
  bare `"accepted"` still works and names nobody. The union is exported as `Verdict`.

### Fixed

- **`@worker-protocol/hono`: `mount()` asks a builder for the Worker once per request, not
  twice.** The guard that authenticates and the handler that serves each resolved it, so every read
  a `WorkerBuilder` made ran twice, and the Worker that accepted a credential was a different object
  from the one that answered. The guard now resolves it and the handler reads what it resolved, for
  the Descriptor, every Capability, the Actions and the settings alike. ENDP-16's checks for a
  missing or a per-request memory store still see each resolved Worker exactly once. A consumer that
  memoized its builder per environment to avoid the second build can drop that.

- **`@worker-protocol/conformance`: LOG-8 compares against the boundary it sent.** The check sends
  an instant sixty seconds back without milliseconds, and compared the records against the instant
  before that rounding. A record in the fraction between the two was correctly answered by `from`,
  since the bound is inclusive and earlier, and the check failed the Worker for it — at random,
  depending on the millisecond it started in. The same rounding let an inclusive `to` pass for a
  record exactly at the boundary. The instant is now rounded before it is sent, and both sides of
  the interval are judged against it.

## [0.3.1] - 2026-09-24 — edition 0.2

### Fixed

- **`@worker-protocol/conformance`'s `verify()` runs in any runtime with a `fetch`, not only in
  Node.** The library read its rule universe from `rules.json` through `node:fs` and
  `import.meta.dirname`, which was the one Node built-in on its path. A bundler that inlined the
  package left the file behind, and `import.meta.dirname` is undefined outside Node, so a Control
  Tower on Cloudflare, Vercel edge, Deno or a Convex action could not verify the Workers it enrolls
  from inside its own runtime without marking the package external and falling back to Node.

  `pnpm rules:generate` now also writes `src/rules.generated.ts`, the same universe as a module,
  and the library imports it statically. `universe()` keeps its signature and still hands each
  caller its own copy. `rules.json` still ships in the tarball for readers outside JavaScript, and
  `pnpm rules:check` fails when either file drifts from `spec/`. The command line is still Node's.
  No rule, verdict or check changed.

  Two tests hold it. One runs `verify()` on workerd with no Node compatibility, against the minimal
  Worker's `app.fetch` in the same isolate over `https`, and expects no rule to fail. The other
  walks everything `dist/index.js` imports and refuses a Node built-in, or a package the manifest
  does not declare.

## [0.3.0] - 2026-09-23 — edition 0.2

### Added

- **`examples/fleet-worker` gained a Tail Worker, for what the producer cannot record about
  itself.** `cycle()` records at the end of its work, so an invocation that threw without catching,
  ran out of CPU or was cancelled records nothing — and nothing else on the Descriptor covers it:
  `health` is a poll and answers truthfully once the process is back, an Alert is a condition that
  holds and a crash three minutes ago does not, and the metric was never incremented because the
  line that would have incremented it is the line that did not run. A hard failure was silence
  indistinguishable from calm.

  The consumer writes an uncaught exception and a non-`ok` outcome into the producer's Durable
  Object, bound across scripts with `script_name`, so `/logs` answers one feed and a Control Tower
  still asks the producer. It throws `event.logs` away — forwarding it would be the `console`
  capture `spec/logs.md` argues against, and it is also what stops the tail feeding itself, since a
  Durable Object call is traced too and comes back carrying `outcome: ok`.

  Nothing in `packages/` changed for it, and the example itself is `private: true`, so it
  publishes nothing.

- **`@worker-protocol/client` gained `page()` beside every list, for a caller that keeps its own
  cursor.** `alerts.page()`, `activity.page()`, `tasks.page({ type, cursor })` and
  `metrics.page(metric, options)` each answer one page and `nextCursor` where there is more, and
  `pages` and `collect` inside the package are now built on the same one-page read. `alerts` and
  `activity` are still the functions they were, with `page` attached, so nothing that called them
  changes. It is for work cut into invocations — a scheduled function, a serverless action — that
  holds the cursor in a table between them, which is how a Control Tower on a serverless platform
  has to run.

  What it is not is a way to read only what is new since the last poll, and the package README
  says so in as many words. `logs` walks from the most recent record towards the oldest (LOG-3), so
  a kept cursor reaches nothing written since; a record carries no identity (LOG-4); `tasks`,
  `alerts` and `activity` are derived on every read and a new item sorts anywhere; and no rule gives
  a cursor a lifetime. Reading from the head with `from` (LOG-8), or comparing whole reads by `id`,
  is the caller's, because `spec/` says nothing a package could carry. A cursor the Worker refuses
  throws `Refused` with `kind: "reject"`, as every refusal of that class already did.

  One behaviour moved with it: a `404` answered to a read that carries a cursor is now an ordinary
  refusal rather than DESC-30's *this address serves nothing*. A cursor names a position, so the
  address had already answered once, and marking it unserved for the rest of the consumer's life
  on that evidence was wrong.

### Fixed

- **`@worker-protocol/client` had no `logs` member, although edition 0.2 added the Capability.**
  Release 0.2.0 moved the client's version and its edition and changed nothing in its source, so a
  consumer of a Worker declaring `logs` was handed nothing for it and no sign of the omission. It is
  now `logs.read({ level, from, to })`, the whole window through `collect()`, and
  `logs.page({ level, from, to, cursor })`, validated against `log-page` and cited as LOG-2. The
  level travels as the floor LOG-7 names and the Worker expands, and the interval is spelled as
  `metrics.read` spells MET-11's.

## [0.2.0] - 2026-09-23 — edition 0.2

### The edition moves, and this is the first release that moves it

**Edition 0.1 → 0.2, which is a MINOR under DESC-24: it adds what a reader holding 0.1 may ignore
and still be correct.** A reader that meets `logs` in a Descriptor it does not know ignores the name
and reports what it ignored (DESC-25); a verifier on 0.1 checks what 0.1 defines and says so. Nobody
on the old edition is wrong, which is the whole test a MINOR has to pass.

The package version moves with it for the reason `packages/README.md` argues and
`pnpm release:check` enforces: **a release that changes which edition a package encodes is never one
a consumer's caret would take on its own.** `^0.1.3` does not take `0.2.0`, so upgrading is a thing
somebody does on purpose — which matters here more than usual, because `mount()` writes the edition
into the Descriptor, and a Worker that took this release by accident would start declaring a
specification nobody chose to every consumer, catalog and verifier that reads it.

**What publishing this costs, permanently: LOG-1 to LOG-10 and ENDP-33 are now fixed.**
`spec/README.md` makes an id immutable from the edition that publishes it, so from here a rewrite to
any of them that could change a verdict costs a withdrawal and a new number. Until this tag they
could be reworded, narrowed or renumbered freely, and `logs` used that right twice: the paging rule
was a `logs` rule of its own for a day before it became ENDP-33 in `endpoints.md`, and the rule
below it moved down into the number that left.

### Changed

- **`ENDP-33`: a page reached through a cursor carries no item the page that produced it already
  carried — and `collection()` pages by position rather than by offset.** The rule arrived while
  `logs` was being written and was a `logs` rule for a day, which was the wrong altitude: every
  collection in this protocol is derived on each read, so the list a caller is paging is never quite
  the list its cursor came from. Under the offset `@worker-protocol/hono` used, an Alert firing
  between two pages handed the caller an Alert it had already seen, and a Task's condition ceasing
  skipped one it never would — on `alerts`, `activity`, `tasks` and `metrics` alike, invisibly, with
  no rule stating it and no check looking.

  A cursor now names the last position a page carried, so the page after it is what sorts beyond
  that position and nothing arriving meanwhile can be inside it. It is base64 of a tagged payload
  rather than a number, which also closes the other half of ENDP-21: a cursor this Worker did not
  mint is refused instead of acted on, where before any integer was a valid position. **Cursors
  minted by an earlier build are refused** — which costs nothing, because ENDP-21 has never let a
  caller keep one beyond the paging it was in the middle of.

### Added

- **`logs`, a ninth Capability: what a Worker recorded while it was working.** Until it, **nothing
  in this protocol answered in the past tense.** Health is now; an activity is now and vanishes when
  the Worker stops holding it (ACTV-5); an Alert is now and ends when its condition stops (ALRT-5);
  a Task is now for the same reason (TASK-15); a metric is an aggregate that never says which
  occurrence it counted; an event is pushed to whoever contracted for it and is gone. A Worker could
  say what it was doing and how much it had managed, and nothing at all about anything finished.
  [`spec/logs.md`](spec/logs.md) carries ten rules and the argument for them;
  `@worker-protocol/hono` carries the decoding and `@worker-protocol/conformance` checks every one
  of them against a Worker over a socket, so the Capability arrives written, implemented and
  verified rather than in three releases.

  What it buys is also less than the other eight buy, and the file says so: every other surface
  carries a closed vocabulary a program acts on, and a record carries a level and then text nobody
  outside the Worker will parse. One console over Workers on three platforms here means one place to
  *read* rather than one place to *act*.

  Three things about it were settled against what was tempting. The record is
  OpenTelemetry's model — instant, severity, body, attributes — in this protocol's spelling, and
  **not** OTLP on the wire: a collector receives a push and does not page an HTTP surface with a
  cursor, so adopting `timeUnixNano` and boxed attribute values would have bought the appearance of
  interoperability, none of the substance, and the one surface here whose instants are spelled
  differently from every other. `fields` is a flat map of scalars, which is the payload
  [`spec/activity.md`](spec/activity.md) refused — admitted here because the reader is a person and
  a flat map is renderable by anything, where an activity payload would have been for a program and
  a program needs a declared schema. And the instant does **not** establish the order (LOG-6):
  records written inside one request share a millisecond, so a caller reads the order the page
  arrives in.

  The feed is a window rather than an archive, so the absence of a cursor means *the end of what the
  Worker still holds* and not *the end of what happened*. That is stated in the file rather than
  signalled in `page.json`, which six other surfaces share and none of them needs it for.

  **A record is written on purpose, and capturing a runtime's `console` into this surface is
  explicitly not the shape.** That was tried in `examples/fleet-worker` and taken back out: a
  global patch is one feed per process, blind to whose work produced each line, so what it serves
  belongs to whichever isolate was running rather than to the work. Written deliberately, a record
  lands wherever the Worker's store already separates one customer's things from another's. The
  surface is one feed and it is the operator's, so a Worker whose records belong to its customers
  serves them the way it serves the rest of that customer's data and does not declare this
  Capability — DESC-2 makes leaving one out free.

- **`examples/fleet-worker` serves `logs` from its Durable Object, and its README prices the
  Cloudflare routes that were rejected.** There is no API in the Workers runtime for reading a
  Worker's own `console` output back. Querying Workers Logs from inside the Worker needs a secret
  holding an account token with `Workers Observability Write` — there is no read-only scope, and it
  covers every Worker in the account. A Tail Worker costs a second deployment and is the only route
  that also sees uncaught exceptions and the invocation outcome; it is still open. What the example
  does instead is record on purpose, in one call per cycle, beside the metric it already counts.

  The Durable Object is the load-bearing part: a window kept in the isolate is one window per
  isolate, so a read can land somewhere that never saw the write — which passes every local test and
  is wrong in production. The records are in SQLite rather than the key-value API the rest of that
  object uses, because a read filters by a level floor and a half-open interval and a store that
  cannot filter would hand the Worker every row to throw away.

## [0.1.3] - 2026-09-22 — edition 0.1

### Added

- **`author` and `keywords` on all four manifests.** `author` is the field npm renders in a
  package's sidebar, and `keywords` is how its search finds a package somebody cannot already name;
  with neither, these were reachable by exact name or by arriving from GitHub and by nothing else.
  The authorship was never missing, only misplaced — the `NOTICE` has carried the copyright inside
  every tarball since 0.1.1, where Apache-2.0 §4(d) obliges a redistributor to keep it, and the
  provenance attestation since 0.1.2 says which repository and commit the bytes were built from.

  Three keywords were deliberately left out. `automation` is vague and crowded; `orchestration` and
  `service-discovery` would be false — this protocol has no orchestrator, since a Control Tower
  holds nobody's state and is in the path of no call, and no discovery, since enrolling is an
  operator pasting a URL and a credential. A keyword that misdescribes the model costs a
  specification more than an absent one.

- **This file, and a gate that keeps it honest.** `pnpm release:check` now refuses a release whose
  version has no section here, at the tag, which is the moment a changelog has to be true. A
  hand-maintained artifact nobody compares is the shape of claim this repository writes gates
  against everywhere else.

## [0.1.2] - 2026-09-22 — edition 0.1

### Added

- **Two Agent Skills, at [`skills/`](skills/).** `worker-protocol` is the protocol for an
  implementer in any language: which of the three artifacts is normative, the surface written by
  hand where no SDK exists — both headers, the error envelope and its eighteen codes, the page
  envelope and its cursor, version negotiation, the idempotency window — the gotchas that hold
  whatever the language, and the verification loop. `worker-protocol-hono` is the TypeScript layer
  over it and opens by pointing at the first. `npx skills add rowing-tech/worker-protocol` installs
  them.

  They are split the way [the roadmap](docs/roadmap.md) splits the SDKs: a repository in C#, Python
  or Go owes the same 153 rules and has no SDK at all, and an agent filters on a skill's description
  alone — so one skill announcing itself as TypeScript would never be loaded by the reader who needs
  the rules most.

- **`pnpm skill:lint`**, the thirteenth gate. Every rule id a skill cites must be one
  `packages/conformance/rules.json` holds — the verifier's own universe, regenerated from `spec/`
  one step earlier in the same workflow — so a withdrawn or renumbered id fails CI rather than going
  on being taught. A skill is prose an agent reads instead of `spec/`, and prose is worse than code
  for that fault, because nothing type-checks it.

### Changed

- `@worker-protocol/hono` and `@worker-protocol/conformance` point at the skills from their READMEs.

## [0.1.1] - 2026-09-22 — edition 0.1

### Added

- **A README in each package.** The four npm pages were blank: 0.1.0 was published before they were
  written. Every claim in them was checked against the code rather than read over — the export table
  in `@worker-protocol/schemas` names 48 objects and all 48 exist with none missing, and the Worker
  example in `@worker-protocol/hono`'s README was extracted and compiled.
- **A provenance attestation on every tarball.** For a repository whose product is a specification
  this is not a formality: `spec/` can be read by anyone, and provenance is what says the bytes on
  npm were built from it, at a commit somebody can look at. `--provenance` on the publish and
  `id-token: write` on the job. **0.1.0 carries none and cannot be given any**, since an attestation
  is made at publish time and a published version is never rewritten.

### Changed

- Each `homepage` points at its own package directory. Pointing all four at the root README was
  right while that was the only README there was.
- The workflows move to `actions/checkout@v7`, `actions/setup-node@v7` and `pnpm/action-setup@v6`,
  ahead of Node 20 being withdrawn from the runners.

## [0.1.0] - 2026-09-22 — edition 0.1

The first release. Edition 0.1 was already published when it was cut, which is why the package
version and the edition agree here and will not again.

### Added

- **The four packages on npm under `@worker-protocol`**: `schemas`, the Zod objects that generate
  the normative JSON Schemas; `hono`, the surface as Hono routes and `mount()` over them; `client`,
  `consume()` for the consumer half; `conformance`, the verifier.
- **A release is a tag and nothing else.** `pnpm bump` sets one version across the root and the four
  packages, `pnpm release` tags and pushes, and `.github/workflows/publish.yml` triggers on `v*` and
  on nothing else. `spec/README.md` argues that an edition is fixed by a release rather than by a
  commit — *a commit is not a release, a branch nobody pulled is not a publication* — and this is
  the mechanical half of that sentence.
- **`pnpm release:check`**, holding the one rule that binds a package version to an edition: an
  edition change never arrives in a release a consumer's caret would take on its own. Which release
  that is depends on where the packages sit in their own history, because npm reads a caret
  differently on either side of 1.0.0, and the check knows both floors.
- **An `edition-<edition>` dist-tag**, moved by each release, so that
  `npm i @worker-protocol/hono@edition-0.1`
  answers the question a consumer of a specification actually has and that a semver range cannot
  express: a range knows about versions, and the edition is a manifest field it cannot see.
- **`LICENSE` and `NOTICE` inside every tarball**, copied at pack time. npm ships only what sits
  inside a package directory, and the `NOTICE` is where the reservation lives that *worker-protocol*
  and any conformance claim made in its name are not granted by Apache-2.0.

### Changed

- **`zod` is a peer dependency of `schemas`, `hono` and `client`; `hono` is one of `hono`.**
  `mount()` takes the `z.object()` schemas a Worker author wrote and gives them to
  `@hono/zod-openapi` beside the ones `@worker-protocol/schemas` exports — with two copies of Zod in
  the tree those are not the same kind of object, and what the author reads is a type error about
  two declarations that look identical.

### Fixed

- **`@worker-protocol/client` declared `zod` only as a devDependency** while its published
  declarations import it, in `call.d.ts`, `index.d.ts` and `skills.d.ts`. A consumer never installs
  devDependencies, so it resolved by accident through npm's flat tree and not at all under pnpm's —
  a break that depends on the consumer's package manager.

[Unreleased]: https://github.com/rowing-tech/worker-protocol/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/rowing-tech/worker-protocol/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/rowing-tech/worker-protocol/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/rowing-tech/worker-protocol/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rowing-tech/worker-protocol/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rowing-tech/worker-protocol/releases/tag/v0.1.0

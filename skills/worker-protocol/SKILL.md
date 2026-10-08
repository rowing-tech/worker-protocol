---
name: worker-protocol
description: >-
  Build, change or debug a worker-protocol Worker in any language: the Descriptor served at
  /.well-known/worker-protocol, the nine Capabilities (health, metrics, actions, alerts, activity,
  nudges, tasks, events, logs), the credential, the error and page envelopes, cursors, idempotency,
  and verification with npx @worker-protocol/conformance. Use this skill whenever the work touches a
  Worker, a Descriptor, an Action, a Task type, a Skill, a metric, an Alert or a log record;
  whenever a conformance report or an error names a rule id such as DESC-35, ENDP-39 or LOG-7;
  whenever somebody is deciding which Capability a fact belongs on, or why a Worker is being refused
  400, 404 or 409; and whenever code is generated from openapi/ or validated against schemas/ —
  even when nobody says "worker-protocol" out loud. For TypeScript on Hono, also load
  worker-protocol-hono.
license: Apache-2.0
metadata:
  workerProtocolEdition: "0.4"
  version: "2.5.0"
---

# worker-protocol, in any language

A **Worker** is any process that does work on its own. It serves a **Descriptor** at
`/.well-known/worker-protocol` — the one address the protocol fixes — declaring its id, its edition
and which **Capabilities** it implements, each with an address. Every other address is read from
that document and assembled by nobody. A Worker that serves a Descriptor and nothing else is
already conformant (DESC-2).

It is HTTP and JSON Schema with no runtime. **In TypeScript, `@worker-protocol/hono`'s `mount()`
writes everything the protocol fixes** — load the `worker-protocol-hono` skill and stop here. In
every other language you write that layer yourself, which is what the rest of this is for.

## Start here

1. **Decide which Capability each fact belongs on**, using the table below. Getting this wrong is
   expensive later, because consoles and consumers are built against where you put it.
2. **Name everything another party will match on under a DNS name the team controls** (NAME-8):
   `tech.example.fleet.check-silent-vehicle`, never `check-silent-vehicle`. Two names match only
   when their bytes are identical (NAME-1).
3. **Generate models and a client from `openapi/`**, pinned to an edition, rather than hand-writing
   request and response types.
4. **Write the shared layer once**, behind whatever the language calls middleware — never in a
   handler. Read `references/hand-written-surface.md` for what goes in it.
5. **Write what only the Worker knows**: whether a credential is good, how it is doing, which
   conditions hold, how much of something happened, what an Action does.
6. **Verify and fix by rule id**, in CI. See *Verify* below.

Cite rule ids in the code too. A failure that names `ENDP-24` can be looked up; one that says
"invalid request" cannot.

## Choose the Capability

| The question it answers | Capability | What makes it that one |
|---|---|---|
| Can I rely on it right now? | `health` | One status, never better than its checks (HLTH-3) |
| What should I look at right now? | `alerts` | A condition that holds, and ends by itself (ALRT-8) |
| What is it working on right now? | `activity` | Undertaken and unfinished; gone when released (ACTV-7) |
| What does it need somebody else to do? | `tasks` | A condition only another party's Action resolves (TASK-15) |
| How much of something happened? | `metrics` | Accumulated over declared periods; never an occurrence |
| What happened, and is over? | `logs` | Written deliberately, past tense, acted on by nobody |
| What can I make it do? | `actions` | An operation with a declared input, performed on request |
| What does it tell others about? | `events` | Pushed to a broker, for whoever contracted for it |
| How do I say there is work? | `nudges` | Best effort, carries a Task type and nothing else (NDG-2) |

Three pairs get confused. Each has a one-sentence test:

- **`alerts` vs `logs`** — if it stops being true on its own, it is an Alert. They overlap only on
  failure: *twelve files compressed* is a record and is no kind of Alert, because an Alert is never
  good news. A record written whenever a condition starts holding is a worse Alert, since nothing
  clears it; an Alert raised for something already over is a condition nobody can make go away.
- **`activity` vs `tasks`** — whose work is it. An activity is what this Worker took on; a Task is
  what it needs from somebody else. Both are present tense, so the question is direction.
- **`metrics` vs `logs`** — what will be asked later. *Fourteen uploads failed last night* is a
  metric; *upload of `a.pdf` failed on the third attempt* is a record. Counting loses which one, so
  a Worker that will be asked *which* writes both.

## Rules hand-written implementations break

Each cites the rule a conformance report will name. The reason follows the rule, because a rule
whose reason is understood is one that survives a refactor.

### Identity and the Descriptor

- **The edition is `MAJOR.MINOR` and describes the protocol, not the package version** (DESC-23).
  Declare exactly one. A reader that does not hold the MAJOR — or, before 1.0, the MINOR — verifies
  nothing and says so (DESC-33);
  one holding a later MINOR judges the Worker only by the rules its declared edition contains
  (DESC-31), so declare the edition the Worker was built and verified against, not the newest.
- **The `id` is a constant the Worker is deployed with**, never the URL and never derived from it
  (DESC-6, DESC-27). Moving hosts must not make it another Worker, and no two share an id (NAME-9).
- **A relative address resolves against `<base>/.well-known/worker-protocol`**, not the base URL
  (DESC-36). A bare `health` lands under `.well-known/`; write `../health` or an absolute https URL.
- **Declare only what is served.** A Capability that answers nothing is a fault (DESC-18); leaving
  one out is always allowed (DESC-2).
- **Every caller that authenticates gets the same Descriptor** (REG-8). Configuration that changes
  over time is ordinary; a document that differs per reader is what this forbids.

### Refusals and paging

- **The `class` is carried by the code, never chosen beside it** (ENDP-26). Each of the 18 codes
  fixes one status and one class.
- **An unrecognized filter parameter is `400`, never ignored** (ENDP-24). This is the rule
  hand-written surfaces fail most: dropping a parameter silently makes a caller believe it applied.
- **A cursor is opaque and produced only by the Worker** (ENDP-21). `nextCursor` is absent at the
  end of a collection — absent, not `null` (ENDP-20).
- **A collection declares an order and holds it** (ENDP-23), or paging does not terminate.
- **Never page by an offset** (ENDP-33). Every collection here is derived on each read, so a count
  into it counts into a list that has changed: items appearing above the offset are handed to the
  caller twice, items disappearing are skipped, and neither is visible to the caller. Key the cursor
  on the last position the page carried, and encode it so a caller cannot construct one.

### Work: Tasks, Actions, Skills

- **Nobody closes a Task.** It exists while its condition holds over the Worker's own facts and is
  gone when that stops being true (TASK-15). Derive the open ones on every read; there is no "done"
  call and nothing can be left open by a consumer that crashed.
- **A Task type names every Action of the Worker's own that answers it** (TASK-35): approve and
  reject, resolve and escalate, postpone. An answer is whatever changes the facts the condition is
  derived from, so one that leaves the Task open is still an answer. Reuse the Actions the Worker
  already has; do not mint one umbrella Action per Task type.
- **Fill in what the Task or Alert already knows, per Action** (TASK-37, ALRT-9). `inputs` is keyed
  by Action name and then by member of its input: `{ "resume-source": { source: "portal" } }`.
  Never rely on a consumer copying payload fields of the same name. It binds nothing; the Action
  judges what arrives as always.
- **Say which answers apply now** (TASK-38) with `available` on the Task, derived on the same read.
  Absent means all of them. Still refuse what the state does not allow with `409` (ACT-17).
- **Skills sit at the Descriptor's root, not inside the `tasks` entry** (TASK-36). `skills` is what
  this Worker does for others; `tasks` is what it needs done. A Worker that only answers others'
  Tasks declares `skills` and no `tasks` at all. What it `produces` is keyed by the owner's
  answering Action name, one schema per answer it can give.
- **A header idempotency key is the caller's; an input key is the Action's** (ENDP-34, ENDP-35).
  Record a header key under whoever your authentication decided is calling — not under the token,
  which changes on rotation, and not globally, which hands one caller another's outcome or a `409`
  it did not cause. An input key names the same performance whoever sends it, which is what makes
  two consumers answering one Task count as one: key that Action's answer from its input.
- **`configure` is the one reserved Action name**, and it replaces the whole settings document. Pair
  it with a reading address for the same document (ACT-21), or a console shows an operator an empty
  form and every field they forget resets. Mark a secret `writeOnly` in its schema: the reading
  address leaves it out, and a `configure` that omits it keeps it (ACT-20).
- **A schema-valid input refused on its content is `422`; one refused because of current state is
  `409 conflict`** (ACT-17). A Worker that does not finish within the call answers `202`, with its
  declared `result` as the body if it declares one — a job id, say (ACT-18).
- **A payload that changes breakingly takes a new name; it never changes under the old one**
  (NAME-2). Judge it the way the document travels (NAME-6): a required member added to an Action's
  input breaks every caller, the same member added to an event's data breaks nobody. Declare the new
  name beside the old and keep answering the old one; mark it `supersededBy` the new (NAME-10) —
  another member of the same map, and a chain that ends. Removing the old name is the announcement.
  A Tower compares each Descriptor with the one it held and shows the operator a schema that broke
  under a kept name (REG-36); `compare` in `@worker-protocol/client` is that comparison.

### The state-bearing surfaces

- **`since` is when the condition began**, not now — on a Task (TASK-28), an Alert (ALRT-3) and an
  activity (ACTV-3). The current instant tells an operator nothing.
- **Health never reports better than its checks** (HLTH-3) and answers `200` whatever it reports
  (HLTH-5): the status is in the body, and the HTTP code says the poll succeeded. Before it has
  established its state it answers `unhealthy`, never `healthy` (HLTH-4).
- **A metric bucket with nothing accumulated is absent from the answer**; `null` means the Worker no
  longer holds it (MET-15). Do not zero-fill — a console renders the two differently. Buckets ascend
  by start (MET-14), cut in the time zone the entry declares.
- **A nudge carries one Task type and nothing else** (NDG-2), answers `204`, and a type with no
  declared Skill is `404` (NDG-3). Then go and read the work: whoever raised it is the only party
  who knows whether it still holds. Nudges are optional and buy latency alone (TASK-19).
- **`events` has no address** (EVT-13) — it declares the event types, and either a broker with its
  binding and destination, or none of the three and `subscriptions` beside it (EVT-14). Nothing
  crosses the broker but events.
- **`subscriptions` pushes events with no broker** (SUB-1 to SUB-16). One address: `GET` lists the
  caller's own, `POST` subscribes with `{ types, filters?, sink, sinkCredential }`, and
  `DELETE ?subscription=<id>` ends one (ENDP-36 lets the protocol fix that verb; an id is never a
  path, ENDP-1). Run the CloudEvents webhook handshake
  (`OPTIONS`, `WebHook-Request-Origin`, expect `WebHook-Allowed-Origin`) before storing; `422` if
  refused. Deliver structured CloudEvents with `Authorization: Bearer <sinkCredential>`, retrying
  only within EVT-8's window. Subscribing is idempotent by content and nothing is renewed: end a
  subscription only when its subscriber does, its sink fails for `abandonAfterSeconds`, or its
  caller is revoked, and announce and keep the last two. On the receiving side, answer the
  handshake, check the bearer, and deduplicate by `source` and `id` within EVT-8's window —
  `sink()` in `@worker-protocol/client` does all three. Back its `SeenStore` with something that
  outlives a request — on Convex, a table claimed in a mutation, never `memorySeen()`, which forgets
  between invocations and handles a repeated delivery twice.
- **The lifecycle of Tasks and Alerts has fixed names** (EVT-15): `task-raised`, `task-ended`,
  `alert-raised`, `alert-ended` under `tech.rowing.worker-protocol`, with the id in `subject` and
  `tasktype` or `alertseverity` as an extension. Publish them where your code knows the moment — a
  Task is derived on read, so no read sees one born.

### logs

- **Most recent first, and the instant does not establish the order** (LOG-3, LOG-6). Records
  written inside one request share a millisecond, so page order belongs to the Worker and a caller
  never sorts by `at`. `level=warn` answers `warn` and `error` (LOG-7); `fields` is one level deep
  with scalar values (LOG-9); the end of the collection is the end of what is still held.
- **Write records on purpose.** Patching a runtime's `console` into this surface produces one feed
  per process, blind to whose work produced each line. Write a record where the store already keeps
  the work it is about. LOG-10 answers one feed to every caller authenticated, so records belonging
  to customers want a surface of their own.
- **A Worker that died cannot record why**, so write those records from outside the invocation. An
  uncaught throw, a CPU limit, a cancellation: the code that would have recorded it did not run, and
  no other Capability covers it — health is a poll, an Alert is a condition that holds, the metric
  was never incremented. Use whatever runs outside the invocation (a tail consumer, a supervisor, a
  process-level handler), write into the same store `logs` reads, and record only the exception and
  the outcome. Forwarding that channel's whole log stream is the capture the rule above refuses.

## Verify

The verifier is published, needs only Node, speaks HTTP, and does not care what the Worker is
written in.

```
WORKER_PROTOCOL_CREDENTIAL=<token> npx @worker-protocol/conformance <base-url>
```

- Exit `0` — no rule failed.
- Exit `1` — a rule failed. The report names its id, its `spec/` file, its class and why.
- Exit `2` — no verdict: the verifier is older than the edition the Worker declares. Install a newer
  one rather than changing the Worker.

Read the counts, not only the failures. `notExercised` is not a failure — the Capability is not
declared, the rule was introduced after the edition the Worker declares (DESC-31), or the rule needs
the Worker *arranged* (an Action safe to perform, a second credential) and nobody arranged it.
`--may-perform` lets the verifier POST to Actions and is off by default. `unverified` and
`otherSubject` are rules no tool pointed at a Worker can judge.

An arrangement is handed to `verify()` as `arrangement`, or to the CLI as a JSON file with
`--arrangement <file>` — checked strictly, so a misspelt key stops the run rather than leaving its
rules `notExercised`. The `subscriptions` checks also need a sink: `--sink-port` serves one, and
`--sink-url` names the tunnel's public `https` address in front of it. The key scope rules need the
most of it: `otherCallerCredential`, a credential your authentication
attributes to somebody other than the recorded caller; an `otherInput` on the safe Action, a second
input its schema accepts; and `secondSafeAction` when one Action takes its key from the header and
another from the input. A Worker with a single caller has no such credential, and the report says
so rather than failing it.

Prefer the environment variable to `--credential`: argv is readable by every process on the machine.
`--json` writes the report for CI to keep.

`https` is required wherever a network is crossed, and a loopback host crosses none, so a run
against `http://127.0.0.1` is judged like a deployed one (DESC-35, DESC-36). Never accept `http` on
any other host.

## Reference

Load these when the task needs them, not before.

- `references/hand-written-surface.md` — the shared layer to write when there is no SDK for the
  language: the headers, the credential, both envelopes, version negotiation, idempotency, and the
  full code vocabulary with each code's class.
- **A rule by id** — `spec/` at https://github.com/rowing-tech/worker-protocol, one file per prefix:
  `DESC` `descriptor.md`, `ENDP` `endpoints.md`, `REG` `registration.md`, `NAME` `naming.md`,
  `HLTH` `health.md`, `MET` `metrics.md`, `ACT` `actions.md`, `ALRT` `alerts.md`, `ACTV`
  `activity.md`, `NDG` `nudges.md`, `TASK` `tasks.md`, `EVT` `events.md`, `LOG` `logs.md`. A rule is
  a bold line carrying an id and a class; everything else in those files binds nobody.
- **The shape of a document** — `schemas/`, 40 JSON Schemas named after the thing they describe.
  Normative: where prose and a schema disagree, the schema wins. Validate against them.
- **A verb, parameter, header or refusal on one address** — `openapi/`, one document per address.
  Normative for the surface. Generate from these rather than reading them by hand.
- **A Worker to model on** — `examples/minimal-worker/src/worker.ts` declares all nine Capabilities
  with a comment per line. It is TypeScript and the *declarations* are what to copy, not the syntax.
  Do not model on `conformance/reference-worker`: it is a test double, deliberately arranged wrong
  in places so the verifier can observe rules nothing else provokes.
- **What the model means** — `docs/architecture.md`: Workers, Tasks, Skills, Services, Contracts,
  the Control Tower, and why a Task has no assignee.

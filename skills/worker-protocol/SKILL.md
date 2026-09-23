---
name: worker-protocol
description: >-
  Build, change or debug a worker-protocol Worker in any language: the Descriptor served at
  /.well-known/worker-protocol, the nine Capabilities (health, metrics, actions, alerts, activity,
  nudges, tasks, events, logs), the credential, the error and page envelopes, cursors, idempotency,
  and verification with npx @worker-protocol/conformance. Use this skill whenever the work touches a
  Worker, a Descriptor, an Action, a Task type, a Skill, a metric, an Alert or a log record;
  whenever a conformance report or an error names a rule id such as DESC-3, ENDP-25 or LOG-7;
  whenever somebody is deciding which Capability a fact belongs on, or why a Worker is being refused
  400, 404 or 409; and whenever code is generated from openapi/ or validated against schemas/ —
  even when nobody says "worker-protocol" out loud. For TypeScript on Hono, also load
  worker-protocol-hono.
license: Apache-2.0
metadata:
  workerProtocolEdition: "0.2"
  version: "2.0.0"
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
| What should I look at right now? | `alerts` | A condition that holds, and ends by itself (ALRT-5) |
| What is it working on right now? | `activity` | Undertaken and unfinished; gone when released (ACTV-5) |
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
  Declare exactly one. A reader that does not hold the MAJOR verifies nothing and says so (DESC-25).
- **The `id` is a constant the Worker is deployed with**, never the URL and never derived from it
  (DESC-6, DESC-27). Moving hosts must not make it another Worker, and no two share an id (NAME-9).
- **A relative address resolves against `<base>/.well-known/worker-protocol`**, not the base URL
  (DESC-12). A bare `health` lands under `.well-known/`; write `../health` or an absolute https URL.
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
- **One Task type names one Action.** A Task with several endings makes them variants of that
  Action's input, told apart by a discriminator (TASK-32). One Action per ending leaves nobody able
  to say which ending they are reporting without a mapping agreed out of band.
- **Skills sit at the Descriptor's root, not inside the `tasks` entry** (TASK-31). `skills` is what
  this Worker does for others; `tasks` is what it needs done. A Worker that only answers others'
  Tasks declares `skills` and no `tasks` at all.
- **`configure` is the one reserved Action name**, and it replaces the whole settings document. Pair
  it with a reading address for the same document (ACT-15), or a console shows an operator an empty
  form and every field they forget resets. Keep secrets out of it by value.

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
- **`events` has no address** (EVT-11) — it declares a broker, a binding, a destination and the
  event types, and nothing crosses it but events.

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
declared, or the rule needs the Worker *arranged* (an Action safe to perform, a second credential)
and nobody arranged it. `--may-perform` lets the verifier POST to Actions and is off by default.
`unverified` and `otherSubject` are rules no tool pointed at a Worker can judge.

Prefer the environment variable to `--credential`: argv is readable by every process on the machine.
`--json` writes the report for CI to keep.

A run over loopback fails DESC-3, which fixes `https`, and that verdict is correct. Do not teach any
implementation an exception for localhost.

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

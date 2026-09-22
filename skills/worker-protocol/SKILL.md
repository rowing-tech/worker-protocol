---
name: worker-protocol
description: >-
  Implement worker-protocol in any language — the Descriptor a Worker serves at
  /.well-known/worker-protocol, the Capabilities it declares (health, metrics, actions, alerts,
  activity, nudges, tasks, events), the credential, the error and page envelopes, the cursor and
  the idempotency window — then verify it with npx @worker-protocol/conformance and fix by rule id.
  Use when building or changing a Worker, a Descriptor, a Skill, an Action, a Task type, a metric
  or an Alert in C#, Python, Go, Java, Rust or any language, when generating models from openapi/
  or validating against schemas/, or when a conformance report names an id such as DESC-3, ENDP-25
  or TASK-32. For TypeScript on Hono, load worker-protocol-hono as well.
license: Apache-2.0
metadata:
  workerProtocolEdition: "0.1"
  version: "1.0.0"
---

# Implementing worker-protocol

A **Worker** is any process that does work on its own. It describes itself in a **Descriptor**
served at `/.well-known/worker-protocol` — the one address this protocol fixes — and declares there
which **Capabilities** it implements and at which addresses. Everything else is read from that
document. A Worker that serves a Descriptor and nothing else is already conformant, enrolled and
catalogued (DESC-2).

This is HTTP and JSON Schema with no runtime, so it is implementable in any language. What differs
is how much you write yourself.

**There is a TypeScript SDK and, as of edition 0.1, nothing else.** `@worker-protocol/hono`'s
`mount()` carries every envelope, refusal, header, cursor and boundary below. In any other language
you write that layer from `spec/` and `openapi/` — which is what this skill is for. Generate your
models and client from `openapi/` pinned to an edition, hand-write the thin layer (resolving the
Descriptor, the interface your Worker author implements, the server adapter), and run the verifier
against it in CI. That is the shape every language's SDK is meant to take.

Rule ids (`DESC-3`, `ENDP-25`, …) are the specification's; a conformance report cites them and
`spec/` has one file per prefix. Cite them in your own code too: it is what lets a failure be looked
up rather than guessed at.

## The three artifacts, and which is normative

| | |
|---|---|
| `schemas/` | **Normative.** 36 JSON Schemas — the Descriptor, the error envelope, a page, a Task, an Alert. Prose defers to these. Validate against them. |
| `openapi/` | **Normative for the surface.** One document per declared address: verbs, parameters, headers, refusals. Generate models and clients from these. |
| `spec/` | The prose and the reasoning. An obligation is a **bold line carrying an id and a class**; everything else binds nobody. |

All three are at https://github.com/rowing-tech/worker-protocol and travel with an edition.

## Gotchas — read before writing a line

- **The edition is `MAJOR.MINOR` and describes the protocol, never your package version** (DESC-23).
  Declare exactly one. A reader that does not hold your MAJOR verifies nothing and says so
  (DESC-25) — so moving a MAJOR takes you out of reach of every tool built for the old one.
- **The Worker's `id` is a constant it is deployed with, never the URL and never derived from it**
  (DESC-6, DESC-27). Moving the Worker to another host must not make it another Worker, and no two
  Workers share an id (NAME-9).
- **A relative address in the Descriptor resolves against `<base>/.well-known/worker-protocol`, not
  against the base URL** (DESC-12). A bare `health` therefore lands under `.well-known/`. Write
  `../health`, or an absolute `https` URL.
- **Declare only what you serve.** A Capability in the Descriptor that answers nothing is a fault
  (DESC-18); leaving one out entirely is always allowed (DESC-2).
- **`class` is carried by the code, never chosen beside it** (ENDP-26). Each of the 18 codes fixes
  one status and one class. Emitting `not_found` with `class: retry`, or with a status other than
  its own, is a conformance failure.
- **An unrecognized filter parameter is `400`, never ignored** (ENDP-24). This is the rule
  hand-written surfaces fail most: silently dropping a parameter you do not know makes a caller
  believe it was applied.
- **A cursor is opaque and only you produce it** (ENDP-21). It is a string a caller sends back
  verbatim. `nextCursor` is **absent** at the end of a collection — absent, not `null` (ENDP-20).
- **A collection declares an order and holds it** (ENDP-23). Paging over an unordered collection
  does not terminate.
- **`configure` is the one reserved Action name**, and it replaces the WHOLE settings document. Pair
  it with a reading address for the same document (ACT-15) — without the read, a console shows an
  operator an empty form and every field they forget resets. Never put a secret in it by value.
- **One Task type names ONE Action, and a Task with several endings has them as variants of that
  Action's input**, told apart by a discriminator (TASK-32). Do not declare one Action per ending:
  then nobody can tell which ending they are reporting without agreeing a mapping out of band.
- **Skills sit at the Descriptor's root, not inside the `tasks` entry** (TASK-31). `skills` is what
  your Worker can do for others; the `tasks` entry is what it needs done. A Worker that only answers
  other Workers' Tasks declares `skills` and no `tasks` Capability at all.
- **Nobody closes a Task.** It exists while its condition holds over your own facts and is gone when
  that stops being true (TASK-15). There is no "done" call, and nothing can be left open by a
  consumer that crashed. Derive the open ones on every read.
- **`since` is when the condition BEGAN, not now.** On a Task (TASK-28), an Alert (ALRT-3) and an
  Activity (ACTV-3). Answering the current instant tells an operator nothing.
- **Health never reports better than its checks** (HLTH-3), and answers `200` whatever it reports
  (HLTH-5). The status is in the body; the HTTP code says the poll succeeded. A Worker that has not
  established its state answers `unhealthy`, never `healthy` (HLTH-4).
- **A metric bucket you accumulated nothing in is ABSENT from the answer; `null` means you no longer
  hold it** (MET-15). Do not zero-fill — the two facts are different and a console renders them
  differently. Buckets ascend by start (MET-14) and are cut in the time zone the entry declares.
- **The same Descriptor goes to every caller you authenticate** (REG-8). Configuration that changes
  over time is ordinary; a Descriptor that differs per caller is what this forbids.
- **A nudge carries one Task type and nothing else** (NDG-2), is answered `204`, and a type you
  declare no Skill for is `404` (NDG-3). Go and read the work — whoever raised it is the only party
  that knows whether it still holds. Implementing nudges is optional and buys latency alone
  (TASK-19).
- **Names another party matches on are namespaced under a DNS name your team controls** (NAME-8):
  `tech.example.fleet.check-silent-vehicle`, not `check-silent-vehicle`. Two names are the same name
  only when their bytes are identical (NAME-1).
- **`events` has no address** (EVT-11). It is a declaration of broker, binding, destination and
  event types; this protocol fixes no broker and nothing crosses it but events.
- **A loopback run fails DESC-3 and that is correct** — DESC-3 fixes `https`. Do not teach anything
  an exception for localhost; read the other verdicts.

## The surface you write when there is no SDK for your language

Everything here is fixed by a rule and is identical in every Worker. Write it once, behind whatever
your language calls a middleware, and never in a handler.

1. **Serve the Descriptor** at `/.well-known/worker-protocol`, validated against
   `schemas/descriptor.json`: your `id`, your `edition`, `capabilities` with an address each, and
   `skills` at the root if you answer Tasks. Every other address is declared there and assembled by
   nobody (ENDP-1).
2. **Two headers on every protocol response** (ENDP-5): `Worker-Protocol-Edition` and
   `Worker-Protocol-Capability-Version`. On refusals too.
3. **The credential**: `Authorization: Bearer <token>` (REG-3), accepted on every address this
   protocol defines (REG-21). `401` when unreadable, `403` when understood and unentitled (ENDP-29).
4. **The error envelope** (ENDP-25), `schemas/error.json`: `{ code, message, class }`.
   - `class: "reject"` — `malformed_request`, `schema_mismatch`, `invalid_parameter`,
     `unknown_filter`, `unsupported_version`, `idempotency_key_required`, `unauthenticated`,
     `forbidden`, `not_found`, `conflict`, `idempotency_key_reused`, `unprocessable_content`.
   - `class: "retry"` — `request_timeout`, `rate_limited`, `internal_error`, `unavailable`,
     `upstream_error`, `upstream_timeout`.
5. **The page envelope** (ENDP-20), `schemas/page.json`: `{ items, nextCursor? }`, with your own
   declared cap (ENDP-19) and order (ENDP-23).
6. **Version negotiation** (ENDP-6): a caller may send `Worker-Protocol-Capability-Version`; a
   version you cannot answer is `unsupported_version`.
7. **Idempotency** where an Action declares it (ENDP-15): a required key that is absent is `400`
   (ENDP-18), a key reused with a different body is `409` (ENDP-17), and a repeat inside the window
   replays the recorded outcome rather than performing again (ENDP-16). **Record outcomes where they
   outlive one process** — a map in memory is right in one long-lived process and silently wrong
   anywhere that scales horizontally, where the repeat reaches an instance that recorded nothing and
   both calls answer `200`.
8. **Input validation** against the JSON Schema you published for that Action (ACT-2); a body that
   parses and does not match is `schema_mismatch`, and one that matches and your own rules refuse is
   `unprocessable_content` (ACT-9).

Then write what only your Worker knows: whether a credential is good, how it is doing, which
conditions hold, how much of something happened, what an Action does.

## Verify, then fix by rule id

The verifier is published and needs only Node in your CI. It speaks HTTP to your Worker and does not
care what it is written in.

```
WORKER_PROTOCOL_CREDENTIAL=<token> npx @worker-protocol/conformance <base-url>
```

Exit `0`: no rule failed. Exit `1`: a rule failed — the report names its id, its `spec/` file, its
class and one line saying why. Exit `2`: no verdict was reached, which is the verifier being older
than the edition your Worker declares; install a newer one.

Read the counts, not only the failures. `notExercised` is not a failure: you declare no such
Capability, or the rule needs the Worker *arranged* — an Action safe to perform, a second credential
— and nobody arranged it. `--may-perform` lets the verifier POST to Actions and is off by default.
`unverified` and `otherSubject` are rules no tool pointed at a Worker can judge.

`--json` writes the report for CI to keep. Prefer the environment variable over `--credential`:
argv is readable by every process on the machine.

## Where the detail is

Load these when you need them, not before. Everything is under
https://github.com/rowing-tech/worker-protocol.

- **A rule by id** — `spec/`, one file per prefix: `DESC` `descriptor.md`, `ENDP` `endpoints.md`,
  `REG` `registration.md`, `NAME` `naming.md`, `HLTH` `health.md`, `MET` `metrics.md`, `ACT`
  `actions.md`, `ALRT` `alerts.md`, `ACTV` `activity.md`, `NDG` `nudges.md`, `TASK` `tasks.md`,
  `EVT` `events.md`. Rules are the bold lines carrying an id and a class.
- **The shape of a document you must send or accept** — `schemas/`, named after the thing
  (`descriptor.json`, `error.json`, `page.json`, `task.json`, `alert.json`, `health.json`).
- **A verb, a parameter, a header, a refusal on one address** — `openapi/`, one document per
  address. Generate from these rather than reading them by hand.
- **A Worker to read as a model** — `examples/minimal-worker/src/worker.ts` declares all eight
  Capabilities with a comment per line explaining what the protocol requires and why. It is
  TypeScript, and the *declarations* are what to copy, not the syntax. Never model on
  `conformance/reference-worker`: it is a test double arranged so the verifier can observe rules
  nothing else provokes.
- **What the model means** — `docs/architecture.md`: Workers, Tasks, Skills, Services, Contracts and
  the Control Tower, and why a Task has no assignee.
- **Writing it in TypeScript on Hono** — load the `worker-protocol-hono` skill, which carries the
  package that writes all of the above for you.

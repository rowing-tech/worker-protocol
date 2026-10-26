# Neighbours: what this protocol is taken for, and what it is not

> Somebody who hears of this protocol places it next to something they already know — open
> observability most often, then a tool protocol for models, a work queue, a service catalog — and
> the placement is usually half right. This document says, for each neighbour, which half. It binds
> nobody. The argument behind every row was had in `spec/` when the rule was written, and the row
> links to it rather than repeating it; where a row and the file it links disagree, the file is
> right and this one is stale.

## One reader, and what follows from it

Every standard in the table below was written for a reader, and the reader is what tells them
apart. OpenTelemetry and Prometheus are written for the people who built a process and run the
backend that watches it. A work queue is written for whoever owns the work and controls the workers
that take it. MCP is written for a host that puts a model in front of tools. This protocol is
written for one reader its first line names: someone who must *see, operate and give work to
Workers they did not build* — an operator at a console, or a system that delegates work and will
never see the backend behind the Worker that takes it.

So the test for a neighbour is not whether this protocol does the same thing better. It never does;
each neighbour is the better answer to its own reader's question, and this text was shaped to avoid
competing with any of them. **A neighbour is adopted where its answer is the one this reader
needs, named where it answers a different reader, and never re-implemented.** CloudEvents is adopted
because this reader needs an event envelope and inventing one would have been *this protocol
writing CloudEvents badly* ([events](../spec/events.md), EVT-1). OTLP is not, because nothing this
reader runs would consume it ([logs](../spec/logs.md)).

What one reader buys is one shape. A Worker serves one Descriptor and declares every Capability in
it ([descriptor](../spec/descriptor.md)); every Capability answers at a declared address with the
same credential, the same refusals, the same page envelope and the same cursor
([endpoints](../spec/endpoints.md)). That is why *the operator's console is written once*
([architecture](architecture.md#the-payoff-the-operators-ui-is-written-once)), and why a Worker
author writes it once: `mount()` carries everything the specification fixes and `pnpm dx:check`
counts what is left to write ([packages](../packages/README.md)). The cheapness is a property of
the shape, and the SDK only carries it — [spec/README.md](../spec/README.md) says in its non-goals
that no rule may be satisfied only by a library, and that is the sentence that stops `packages/`
from becoming the standard.

What this replaces is nothing. A Worker that already instruments with OpenTelemetry, serves a
Prometheus scrape, answers a liveness probe or runs a queue inside itself keeps every one of them:
what a Worker does inside is a named non-goal, and anything it serves undeclared is invisible here.
Those tell its builders what happens inside it. This tells somebody else how it is doing and lets
them act. A Worker serves both, and the two never meet.

## The table

*Adopted* means the neighbour's text is normative here, by citation or copied out. *Beside* means
a Worker may run both and nothing here speaks to the other. *Not this* means the neighbour answers
a question this protocol refuses, and the refusal is argued. *Same word* means only the vocabulary
is shared.

| Neighbour | Written for | Relation | The line |
|---|---|---|---|
| OpenTelemetry — logs, metrics, traces, OTLP, the collector | Whoever built the process, and the backend they run | Adopted in part; the wire format is not | `logs` takes the log data model and the level names and *does not invent a fifth thing* (LOG-4, LOG-5); OTLP is not taken because *an OpenTelemetry collector receives a push; it does not page an HTTP surface with a cursor*. A deployment that wants these records in an OpenTelemetry backend sends them there from wherever the Worker already writes them. Traces are not recognised yet, and that is listed as open. [logs.md](../spec/logs.md#what-this-takes-from-opentelemetry-and-what-it-does-not) |
| Prometheus, and the OpenMetrics exposition format folded back into it in 2024 | A monitoring system reading time series | Beside | *A Prometheus-style `/metrics` endpoint is not this Capability.* `metrics` is a few named quantities over five closed periods (MET-3), read by a console and an operator; a scrape is a time series over whatever window the reader chooses. *The period is the distinction.* A Worker serves both. [metrics.md](../spec/metrics.md) |
| Infrastructure probes — a load balancer, a platform's liveness and readiness checks — and the IETF health-check draft (`draft-inadarei-api-health-check`, expired 2022) | A probe that reads a status code and nothing else | Beside; same shape, different reader | The shape is the one the draft and the platforms converge on, one status and a map of named checks, with `healthy`, `degraded`, `unhealthy` where the draft says `pass`, `warn`, `fail`. All three answer `200` (HLTH-5), because this reader reads the body and ENDP-40 classes `503` as *retry* — which would make a Worker that is unwell look like one that is unreachable, the one distinction health exists to draw. *A Worker that needs the infrastructure behaviour serves that probe outside the protocol.* [health.md](../spec/health.md), [architecture.md](architecture.md) |
| CloudEvents 1.0 — the envelope, the webhook handshake, the Subscriptions API | Anyone putting an event on a wire | Adopted, in three places | An event is a CloudEvents 1.0 event and `source` with `id` is that standard's uniqueness rule (EVT-1). A sink is validated with its abuse-protection handshake before a subscription is stored (SUB-10), and a delivery is the HTTP binding's structured mode (SUB-11). The six filter dialects every Subscriptions API implementation must support are written out rather than cited, because that API is version `0.1-wip` and may move; `sql` is left out, and *the six are the whole language, and not a floor* (SUB-13). Not taken: a protocol binding (EVT-13, because fixing one names a broker), and the lease a subscriber renews (SUB-14). [events.md](../spec/events.md), [subscriptions.md](../spec/subscriptions.md) |
| AsyncAPI | Whoever integrates with a broker, as OpenAPI is for whoever calls an HTTP API | Beside | It describes channels and operations on a transport. This protocol names no broker and no binding (EVT-13) — *a registry under another name* — so there is nothing here for an AsyncAPI document to describe. A deployment that documents the broker it chose in AsyncAPI loses nothing and is told nothing. [events.md](../spec/events.md) |
| Standard Webhooks | A receiver verifying who sent a callback | Not this, and the reason is written | It standardises delivery: three signed headers and a replay window. Here a delivery carries a Bearer the subscriber chose, presented by the Worker — REG-3 in the other direction — and a signature *would need a secret generated, returned and rotated per subscription, and would not stop the flooding the handshake stops*. [subscriptions.md](../spec/subscriptions.md) |
| OpenAPI 3.1 and JSON Schema 2020-12 | Whoever reads or generates against an HTTP surface | Adopted, as two of the three normative layers | `schemas/` is normative for shape, `openapi/` for the surface, one document per declared address, and either wins over a sentence in `spec/`. The one thing a per-Worker generator was asked to produce and refused is on the roadmap. [README.md](../README.md#normative-and-explanatory), [roadmap.md](roadmap.md) |
| MCP — the Model Context Protocol | A host application putting a model in front of tools, resources and prompts, over JSON-RPC | Same word; not this | *Capabilities* is used here in the sense LSP, MCP and WebDriver already give it: a closed list of parts a peer declares it implements. The caller is different. An Action is an operation with a declared input schema, performed on request by an operator or a delegating system (ACT-2, ACT-3); nothing here is shaped for a model to choose it. A Worker that wants its Actions reachable from a model wraps them in an MCP server outside the protocol, and the schemas are already there to wrap. [architecture.md](architecture.md#the-descriptor-a-worker-says-what-it-implements), [actions.md](../spec/actions.md) |
| A2A — the Agent2Agent protocol | A client agent handing work to a remote agent it can call | Same words; not this | The closest vocabulary of any row: an Agent Card is served at a well-known path and declares skills, and a *Task* is the unit of work. Both words mean something else here. An A2A task is created by the server when a client sends it a message, and ends in a terminal state the server reaches — `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`. A Task here is a condition the owner observes and only another party's Action resolves; nobody raises it by request, nobody is assigned it, and nobody declares it done — *it closes when its condition stops holding, and no party declares that* (TASK-15). The Descriptor declares Capabilities to whoever will operate the Worker; an Agent Card declares skills to whoever will call the agent. [tasks.md](../spec/tasks.md), [descriptor.md](../spec/descriptor.md) |
| Work queues and workflow engines — SQS, BullMQ, Celery; Temporal, Step Functions, Airflow | Whoever owns the work and controls the workers that take it | Not this, by a decision this text records | Orchestration is a named non-goal: *no workflow, no routing, no scheduling, no retry policy beyond the class an answer carries*. This protocol once had a Claim — a lease over a Task, with counts and a cap — and withdrew it, because *a lease over a unit of work is the primitive of a work queue* and the counts *were a retry policy under another name*. Two consumers may answer one Task, bounded by idempotency (ENDP-35), not by a lock. A Worker may run a queue inside itself; what it does inside is its own. [tasks.md](../spec/tasks.md#withdrawn), [activity.md](../spec/activity.md), [spec/README.md](../spec/README.md) |
| Service catalogs and discovery — Backstage, Consul | A platform team maintaining a catalog, or a service finding another at runtime | Beside | The Worker serves its own Descriptor at `.well-known/worker-protocol` (DESC-35); the Tower keeps a dated copy and *the Worker's own Descriptor wins wherever the two differ*. Enrolment starts with a person who writes a base URL down, and *no Worker enrolls itself, and nothing a Worker serves puts it in a registry* (REG-26); *every Worker reaches its Tower by configuration, never by discovery*. A catalog entry may point at a Descriptor. Nothing here replaces the catalog. [registration.md](../spec/registration.md), [architecture.md](architecture.md#the-descriptor-a-worker-says-what-it-implements) |

## The association that prompted this file

*Open observability* is the one people reach for first, and it deserves its own paragraph because
four Capabilities share a name with it — `health`, `metrics`, `logs`, `alerts` — and none of them is
instrumentation. Observability, in the sense OpenTelemetry gives the word, is the people who built
a process learning what happened inside it, from signals the process emits to a backend they chose.
Every one of those four here is the opposite direction: a surface the Worker *serves*, read by
somebody who did not build it and will never see that backend, holding a derived state — one
status, a few accumulated quantities, the records written on purpose, the conditions that hold now
— rather than the stream the state was derived from. The pull is the design, not a transport
choice: *a dead worker is detected because the poll fails*
([architecture](architecture.md#why-pulled-and-not-pushed)), and a pushed signal cannot say that.
So a Worker that is fully instrumented with OpenTelemetry has done nothing toward this protocol,
and a Worker that implements this protocol has emitted no telemetry; the two are adjacent, and
`logs` borrowing OpenTelemetry's level names is the whole of the overlap.

## Adding a row

A neighbour enters this table when somebody has actually placed the protocol next to it, or when it
shares a word with something here — *Task*, *capabilities*, *health*, *subscription* — closely
enough that a reader would carry the other meaning in. It does not enter because it *could* be
associated: a table of everything a protocol is not is never finished, goes stale on the day it is
written, and ends up defining the protocol by what other people built. The non-goals in
[spec/README.md](../spec/README.md) are the standing answer to the question this table only
illustrates, and a row that cannot point at one of them, or at a rule, is not ready to be a row.

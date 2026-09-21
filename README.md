# worker-protocol

An open specification for workers that can be seen, operated and given work by people who did not
build them. HTTP and JSON Schema, no runtime.

**Start with [the architecture](docs/architecture.md)** — the model and the reasoning behind it.
What is open on purpose is in [deliberately undecided](docs/undecided.md); what is decided and not
yet built is in [the roadmap](docs/roadmap.md).

## What it is

A **Worker** is any process that does work on its own — a Cloudflare Worker, an Azure Function, a
Convex app, a cron job in Python over Postgres. This specification says how one describes itself,
reports how it is doing, accepts actions, and takes work that somebody else raised, so that whoever
operates it or hands it work never has to know how it was built. A worker declares which parts of
this it implements, and in which version, in a descriptor it serves — so nobody finds out by
trying.

Two halves, and a worker may implement one or both:

- **Operate.** A worker exposes its health and its metrics, raises alerts, and declares the
  actions it accepts, each with the schema of its input. An operator acts on it from a console
  without knowing what is inside.
- **Delegate.** A worker reads tasks it did not create and answers one. Whoever raised the task
  never names who will do it, and nobody declares it done: it closes when its condition stops.

A worker may also implement neither and still be one. The descriptor is the whole floor: everything
above it is declared or left out freely, and a worker that serves a descriptor and nothing else is
already known, catalogued and reachable. What it adds afterwards, it adds at its own pace.

## Normative and explanatory

Four layers, and only the first three bind:

- **`schemas/`** is normative for *shape* — what a request and a response carry.
- **`openapi/`** is normative for *the surface* — which verb answers at which declared address,
  which parameters and headers travel, and which code answers which refusal. Where a sentence in
  `spec/` and a document here disagree, the document wins, on the same reasoning that has the
  schema win over prose.
- **`spec/`** is normative for *behavior* that neither can state — the lifecycles, the ordering,
  what closes a Task, when a Worker may answer at all.
- **`docs/`** explains why the other three look the way they do, and binds nobody.

`openapi/` holds one document per declared address rather than per Capability, because an address
is a *server* to every generator and a path appended to one is an address somebody assembled —
which ENDP-1 says no reader does. `events` has none: it travels over a broker this protocol
declines to name, so there is no call to describe.

Every section of `spec/` carries a maturity marker, so that implementing this in parts is a fact
you can read rather than a negotiation:

| Marker | Meaning |
|---|---|
| `stable` | Implement it. A change is breaking and gets a version. |
| `draft` | Shaped and implementable, still moving. |
| `open` | A question with no answer yet. |

A worker states which sections it implements, and the conformance tool reports the same thing.

## Layout

```
spec/            the normative prose: endpoints, lifecycles, envelopes — one file per subject
schemas/         the JSON Schemas, generated and versioned here — the normative artifact
openapi/         one document per declared address, generated from the surface declaration
conformance/     fixtures independent of any language, and the register of what a check can reach
packages/
  schemas/       the Zod objects that generate schemas/
  hono/          the surface as Hono routes, which generate openapi/, and mount() over them
  client/        consume(): read a Worker and take work from it — the consumer half
  conformance/   the verifier: point it at a worker, get a report of what it complies with
examples/
  minimal-worker/    a conformant Worker in under 150 lines. Copy this one
  fleet-worker/      the same shape on Cloudflare: a Durable Object, an outbox, tested on workerd
  reference-worker/  a worker arranged so the verifier can observe the rules that need arranging
docs/            the architecture narrative, what is deliberately undecided, and the roadmap
```

**Nothing in `packages/` may carry behavior of its *own*, and the word is load-bearing in the
opposite direction to the one it is usually read in.** What is forbidden is a package doing
something the specification does not say — that is how a package becomes the standard and the text
starts to rot. What is *wanted* is a package carrying everything the specification does say, because
the alternative is every Worker author deriving the same rules again and the ones who get a detail
wrong being non-conformant in a way only a verifier ever finds.

So `mount()` in `packages/hono` carries the whole of what this protocol fixes — the addresses, the
headers, the envelope, the refusals, the page envelope and its cursor, the bucket boundaries — and
nothing the specification leaves to a Worker. Its standing is the verifier's: it is derived
from the surface declaration beside it, and `@worker-protocol/conformance` running against a Worker
built on it is what vouches for it.

**How much a Worker author writes is a number this repository gates**, because it is the one that
decides whether any of the rest gets used. `examples/minimal-worker` is a conformant Worker in
under 150 lines, `pnpm dx:check` fails when it grows, and everything above that line is a rule
`mount()` should have carried.

**`examples/fleet-worker` is the same Worker with its `Map`s taken away.** Every piece of state a
rule here needs to outlive a request — the Tasks whose conditions hold, the counters a metric is
read from, the outcome ENDP-16 promised to replay — lived in process memory in every example this
repository had, which is right in one deployment shape and wrong in the one its own architecture
names first. That one keeps all of it in a Durable Object and runs its tests on workerd rather than
on Node, so the claim is made where it can fail. It failed on the first run, which is the point. The
verifier reaches it over a real socket like any other Worker, and
[its README](examples/fleet-worker/README.md) says how to run both.

## Status

**Edition 0.1.** Every rule carries an id, and from this edition on those ids are fixed: a rewrite
that could change a verdict takes a new one and withdraws the old, so a conformance report stays
true however long after it was produced somebody reads it.

Every file in `spec/` is `draft` rather than `stable`, and that is a statement about shape and not
about trust. Each still carries a `Still open here` section, which is what `stable` would have to
be empty of. What `draft` means here is what the table above says: shaped and implementable, still
moving — and moving now costs a withdrawal rather than a silent edit.

What stands behind that: 150 rules, every one classified in
[conformance/verifiability.md](conformance/verifiability.md) by what a check would observe when it
is broken, and every one of the 86 a tool can observe against an ordinary Worker checked by
[`@worker-protocol/conformance`](packages/conformance) over a real socket. Seventeen more need a
Worker *arranged* to be observed — a second credential, a boot window, an Action safe to perform —
and pass when that arrangement is handed to the verifier out of band, as the base URL and the
credential already are.

The remaining 47 are reported rather than passed, and the two kinds are not the same: 25 bind a
party who is not a Worker, so this tool never contacted whoever they oblige, and 22 have no witness
anywhere.

**Fifty rules are withdrawn, and sixteen of them went at once.** A Claim was an exclusive lease
a consumer took on a Task, and [spec/tasks.md](spec/tasks.md) says why it is gone: a lease over a
unit of work is the primitive of a work queue, orchestration is a declared non-goal, and the cost
fell on the owner while the consumer's half of it was optional all along.

A report that counted `other subject` or `unverified` as compliance would be vouching for something
nobody checked, which is why neither is a pass.

## License and name

Apache-2.0, patent grant included — implement it in any product, commercial or not, without asking
anyone. The name is not part of that grant (Apache-2.0 §6): a claim that something *speaks
worker-protocol* is one this project vouches for, and the conformance tool is how it is earned.

The consoles and services that consume conformant workers are separate products. A worker that
implements this must be legible to any console, not to one.

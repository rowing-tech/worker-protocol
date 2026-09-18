# worker-protocol

An open specification for workers that can be seen, operated and given work by people who did not
build them. HTTP and JSON Schema, no runtime.

**Start with [the architecture](docs/architecture.md)** — the model and the reasoning behind it.
What is open on purpose is in [deliberately undecided](docs/undecided.md).

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
- **Delegate.** A worker takes tasks it did not create, claims one under a lease, and answers.
  Whoever raised the task never names who will do it.

## Normative and explanatory

Three layers, and only the first two bind:

- **`schemas/`** is normative for *shape* — what a request and a response carry.
- **`spec/`** is normative for *behavior* — the endpoints, the lifecycles, the status codes, which
  no schema can state. Where a sentence there and a schema disagree, the schema wins.
- **`docs/`** explains why the other two look the way they do, and binds nobody.

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
conformance/     request/response fixtures, independent of any language
packages/
  schemas/       the Zod objects that generate schemas/
  conformance/   the verifier: point it at a worker, get a report of what it complies with
docs/            the architecture narrative, and what is deliberately undecided
```

Nothing in `packages/` may carry behavior of its own: everything there is derivable from the
schemas and verifiable against the fixtures. The day a package does something the specification
does not say, the package has become the standard and the text has started to rot.

## Status

Draft. Nothing is frozen and no version is published. Until the first version is tagged, read no
section as `stable` whatever its marker says.

## License and name

Apache-2.0, patent grant included — implement it in any product, commercial or not, without asking
anyone. The name is not part of that grant (Apache-2.0 §6): a claim that something *speaks
worker-protocol* is one this project vouches for, and the conformance tool is how it is earned.

The consoles and services that consume conformant workers are separate products. A worker that
implements this must be legible to any console, not to one.

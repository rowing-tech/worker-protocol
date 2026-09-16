# spec

Normative for **behavior**: the endpoints, the lifecycles and the status codes that no schema can
state. What a request and a response carry is normative in `schemas/`, and where a sentence here
disagrees with a schema, the schema wins.

One file per subject, each opening with its maturity marker — `stable`, `draft` or `open`. A file
marked `open` lists what it will answer. Where one of those questions is one of meaning and has an
entry in [deliberately undecided](../docs/undecided.md), the bullet links there and the entry
links back, so that when the answer lands both places know; the rest is mechanics, merely
unwritten.

Cross-cutting — every Worker meets these, whatever else it implements:

| File | Subject |
|---|---|
| [descriptor.md](descriptor.md) | What a Worker says it implements: its id, its Capabilities, its versions |
| [endpoints.md](endpoints.md) | Paths, verbs, versioning, errors, idempotency, paging |
| [registration.md](registration.md) | How a Worker is enrolled, and how both sides authenticate |
| [naming.md](naming.md) | Identity, namespaces, and what a schema change breaks |

Capabilities — each a part of the protocol a Worker declares in its Descriptor or leaves out, with
a version of its own:

| Capability | File | Subject |
|---|---|---|
| `health` | [health.md](health.md) | The answer to a poll: one status, named checks |
| `indicators` | [indicators.md](indicators.md) | Named quantities over a declared period |
| `actions` | [actions.md](actions.md) | Declaring and performing an operation, `configure` and settings included |
| `alerts` | [alerts.md](alerts.md) | Conditions an operator should see |
| `tasks` | [tasks-and-claims.md](tasks-and-claims.md) | Exposing Tasks, claiming under a lease, answering |
| `events` | [events.md](events.md) | The envelope, the broker, deduplication |

Every file is `open` today: the subjects are settled, the answers are not.

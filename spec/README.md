# spec

Normative for **behavior**: the endpoints, the lifecycles and the status codes that no schema can
state. What a request and a response carry is normative in `schemas/`, and where a sentence here
disagrees with a schema, the schema wins.

One file per subject, each opening with its maturity marker — `stable`, `draft` or `open`. A
section marked `open` links to its entry in [deliberately undecided](../docs/undecided.md) when
the question is one of meaning; a file that is merely unwritten says so and lists what it will
answer.

| File | Subject |
|---|---|
| [endpoints.md](endpoints.md) | Paths, verbs, versioning, errors, idempotency, paging |
| [registration.md](registration.md) | How a Worker becomes known, and how both sides authenticate |
| [health.md](health.md) | The answer to a poll: one status, named checks |
| [indicators.md](indicators.md) | Named quantities over a declared period |
| [actions.md](actions.md) | Declaring and performing an operation, `configure` included |
| [alerts.md](alerts.md) | Conditions an operator should see |
| [tasks-and-claims.md](tasks-and-claims.md) | Exposing Tasks, claiming under a lease, answering |
| [events.md](events.md) | The envelope, the broker, deduplication |
| [naming.md](naming.md) | Identity, namespaces, and what a schema change breaks |

Every file is `open` today: the subjects are settled, the answers are not.

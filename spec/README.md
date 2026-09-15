# spec

Normative for **behavior**: the endpoints, the lifecycles and the status codes that no schema can
state. What a request and a response carry is normative in `schemas/`, and where a sentence here
disagrees with a schema, the schema wins.

One file per subject, each opening with its maturity marker — `stable`, `draft` or `open`. A
section marked `open` links to its entry in [deliberately undecided](../docs/undecided.md), so
that a question is recorded in one place and not two.

Planned subjects: the worker's endpoints, health, indicators, actions, alerts, tasks and claims,
events.

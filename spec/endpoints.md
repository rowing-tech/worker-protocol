# Endpoints

`open`

The shape of the Worker API itself, before any one surface: which paths a Worker serves, which
verbs, which content types, and how a Worker says which version of this protocol it speaks.

To answer here:

- The paths of each surface — the Descriptor, then health, indicators, settings, actions, tasks,
  alerts — and whether they sit under a fixed prefix a Worker may not move.
- How a version is negotiated on a call — in the path, in a header — given that the
  [Descriptor](descriptor.md) already states which ones a Worker speaks.
- The error envelope every surface shares, and which status codes mean what.
- Whether posting an Action must be idempotent, how a caller retries, and how it says "this is the
  same call again".
- Paging and filtering, which every collection surface needs before a Worker with a thousand open
  Tasks is answerable.

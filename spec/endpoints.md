# Endpoints

`open`

The shape of the Worker API itself, before any one surface: which paths a Worker serves, which
verbs, which content types, and how a Worker says which version of this protocol it speaks.

To answer here:

- The paths of each surface — health, indicators, settings, actions, tasks, alerts — and whether
  they sit under a fixed prefix a Worker may not move.
- How a version is negotiated: in the path, in a header, or in the document a Worker serves about
  itself.
- The error envelope every surface shares, and which status codes mean what.
- Whether posting an Action must be idempotent, how a caller retries, and how it says "this is the
  same call again".
- Paging and filtering, which every collection surface needs before a Worker with a thousand open
  Tasks is answerable.

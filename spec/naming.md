# Naming and evolution

`open`

How the things this protocol talks about are identified, and what happens when one of them changes
shape.

To answer here:

- How a Worker's id — its own, distinct from its URL — a Skill, a Task type, an Action and an event
  type are named, and whether names are namespaced so two teams can use the same word for
  different things. A Capability of a Worker's own is named under a prefix the
  [Descriptor](descriptor.md) reserves, and is answered there.
- How a schema changes: what counts as compatible, how a version is expressed, and how long an old
  one is answered.
- What a schema change does to Contracts already granted over it, and who is told.
- Whether a name may ever be reused once retired.
- That an **Alarm** — a Worker waking itself at a future time to re-evaluate — is neither a Task
  nor an Alert, and that neither word is used for one. The distinction is argued in
  [the architecture](../docs/architecture.md), which binds nobody; it is a fence only a normative
  sentence can hold, and runtimes exist whose own `Alarm` is exactly the thing a reader will
  confuse it with.

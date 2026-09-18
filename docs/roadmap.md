# Roadmap

What is decided and not yet built, listed so that whoever picks it up — on another machine, or
somebody else entirely — starts from the decision and its reasoning rather than from a
conversation nobody else was in. Each entry says what was decided, what was rejected and why, what
is still open, and which file of this repository absorbs it when it is built.

An entry leaves this list in one direction only: the repository holds the thing. Its reasoning
then moves into the file that implements it, where the argument sits beside what it argues for —
which is how [deliberately undecided](undecided.md) hands a question to `spec/`, one step later.
Nothing here is normative, and nothing here is a commitment about *when*.

## Per-language SDKs

**Decided 2026-09-18. Three of its four decisions are built and have left this entry; what is
below is the fourth.** The surface is declared in `packages/schemas/src/surfaces.ts`, `openapi/`
is generated from it and compared in CI, and that directory is normative for the surface — the
reasoning for each now sits in the file that implements it, which is where an argument belongs
once there is something for it to argue about. `README.md` carries the layer table,
`spec/endpoints.md` says its code table is a reading aid, and `packages/conformance` reads the
code-to-status mapping from `surfaces.ts` rather than scraping prose.

**One repository per language, certified by conformance.** This repository publishes artifacts and
the verifier, and `packages/` keeps carrying no behaviour of its own. Each SDK is a repository —
`worker-protocol-python`, `worker-protocol-dotnet`, and so on — that generates its models and
clients from `openapi/` pinned to an edition, adds a thin hand-written layer (reading and resolving
the Descriptor, the interface a Worker author implements and its server adapter, the claim → action
→ outcome flow for a consumer), ships its own reference Worker, and runs
`@worker-protocol/conformance` against that Worker in its CI. The conformance report is what ties
the repositories together: an SDK is right because its reference Worker passes, not because
somebody read the prose carefully.

**Rejected, and why:**

- *All SDKs inside this repository under `sdk/`.* One commit would move every SDK, at the cost of
  several toolchains in one checkout and a README that has to explain why `sdk/` carries behaviour
  when `packages/` may not.
- *Generated code only, no idiomatic layer.* Resolving the Descriptor, the claim flow and the error
  envelope are exactly what an SDK exists to give, and every consumer would rewrite them.

**Still open:**

- Which languages first.
- Whether a second generator turns a *live* Descriptor into a per-Worker OpenAPI for its own Action
  inputs and Task payloads, which `openapi/` cannot describe because they are the Worker's.
- Whether `examples/reference-worker` moves to a TypeScript SDK repository once one exists, or
  stays here as the fixture `packages/conformance` tests against.

**Lands in:** a repository per language, each pinned to an edition and each running the verifier
against its own reference Worker in CI.

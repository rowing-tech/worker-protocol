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

**Decided 2026-09-18, and revised the same day.** Most of it is built and has left this entry; the
reasoning for each built piece now sits in the file that implements it, which is where an argument
belongs once there is something for it to argue about. The surface is declared as Hono routes in
`packages/hono/src/surfaces.ts`, `openapi/` is generated from them and compared in CI, that
directory is normative for the surface (`README.md` carries the layer table and
`spec/endpoints.md` says its code table is a reading aid), and `@worker-protocol/hono` is the
TypeScript SDK: the routes, an interface a Worker author implements, and `mount()` over it. Why the
routes are the source rather than data of this repository's own, and why TypeScript lives here
rather than in a repository of its own, are argued at the top of `surfaces.ts` and in
`packages/README.md`. What is below is the part that is not built: every other language.

**One repository per language, certified by conformance.** This repository publishes artifacts,
the verifier and the TypeScript SDK. Each other SDK is a repository — `worker-protocol-python`,
`worker-protocol-dotnet`, and so on — that generates its models and clients from `openapi/` pinned
to an edition, adds a thin hand-written layer (reading and resolving the Descriptor, the interface
a Worker author implements and its server adapter, the claim → action → outcome flow for a
consumer), ships its own reference Worker, and runs `@worker-protocol/conformance` against that
Worker in its CI. The conformance report is what ties the repositories together: an SDK is right
because its reference Worker passes, not because somebody read the prose carefully. What
`packages/hono` carries for TypeScript is the model for that layer in every other language.

**Rejected, and why:**

- *All SDKs inside this repository under `sdk/`.* One commit would move every SDK, at the cost of
  several toolchains in one checkout and a README that has to explain why `sdk/` carries behaviour
  when `packages/` may not. TypeScript is the exception because its routes are also the source of
  the normative artifact, which is an argument no other language has.
- *Generated code only, no idiomatic layer.* Resolving the Descriptor, the claim flow and the error
  envelope are exactly what an SDK exists to give, and every consumer would rewrite them.
- *A second generator turning a live Descriptor into a per-Worker OpenAPI.* Not needed: a Worker
  that mounts `@worker-protocol/hono` asks its own app for its document and gets its own Actions
  and Task payloads in it. Other languages get the same from their own frameworks or not at all,
  and that is a question for each of them.

**Still open:**

- Which languages first.

**Answered since, and the answer is the model for every other language.** The consumer flow is not
a second export of the server package: it is `@worker-protocol/client`, whose only dependencies are
`@worker-protocol/schemas` and `fetch`. A consumer is not a server — a Tower, a teams app or a
Worker on a platform that serves nothing runs no web framework — and the nine rules that oblige a
caller rather than a Worker live there, cited and tested by id, because until it existed they had
no subject anywhere. Each language's repository owes the same two halves.

**Lands in:** a repository per language, each pinned to an edition and each running the verifier
against its own reference Worker in CI.

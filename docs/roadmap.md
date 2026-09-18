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

**Decided 2026-09-18.** The protocol exists so that a Worker in any language can be operated by a
console that never heard of it, and the specification is meant to produce several SDKs rather than
stay prose. Today two artifacts are machine-readable — `schemas/` fixes what a document carries
and `rules.json` fixes which obligations exist — and one thing is not: the *surface*. Which verb a
Capability answers, which query parameters a read takes, which headers travel, which code answers
which refusal, all of it lives in tables in `spec/`. An SDK generated from what exists today gets
the shapes and has to read English for everything else, and two SDKs that each read it correctly
can still expose two different APIs for the same call. Four decisions, taken one at a time:

1. **Source: a surface declaration beside the Zod objects.** `packages/schemas/src/surfaces.ts`
   states, for each operation of each Capability, the verb, the query parameters, the headers, the
   codes it refuses with and the schema it answers. Every item cites its rule id, exactly as each
   Zod node's `description` does today, so that the attribution `rules.json` carries reaches the
   surface too.

2. **Shape: one OpenAPI 3.1 document per Capability, plus one for the Descriptor.** Generated from
   `surfaces.ts` into `openapi/`, committed, and compared byte for byte in CI — the reason and the
   mechanism are the ones `schemas/` and `rules.json` already have. Each document has a single path
   (`tasks` has two, for the reading address and the claim address) and
   `servers: [{ url: "{address}" }]`, because this protocol fixes one route and declares every
   other address in the Descriptor (ENDP-1). Its `components` are `$ref`s into `schemas/*.json`,
   so nothing is retyped. Seven documents rather than one because OpenAPI assumes fixed paths
   under a server, and a Capability's address is a server as far as the tooling is concerned; a
   generated client is constructed with the address read from the Descriptor, resolved per
   DESC-12, and needs no interceptor and no vendor extension to find it.

3. **Status: `openapi/` is normative for the surface.** A third layer, between `schemas/` (shape)
   and `spec/` (behaviour that neither can state: lifecycles, ordering, when). Where a sentence in
   `spec/` and `openapi/` disagree, `openapi/` wins, on the same reasoning that has the schema win
   over prose today. The tables in [endpoints.md](../spec/endpoints.md) become reading aids, and
   `packages/conformance/src/generate-rules.ts` reads the code-to-status mapping from
   `surfaces.ts` rather than parsing a Markdown table with a regular expression.

4. **Where: one repository per language, certified by conformance.** This repository publishes
   artifacts and the verifier, and `packages/` keeps carrying no behaviour of its own. Each SDK is a
   repository — `worker-protocol-python`, `worker-protocol-dotnet`, and so on — that generates its
   models and clients from `openapi/` pinned to an edition, adds a thin hand-written layer
   (reading and resolving the Descriptor, the interface a Worker author implements and its server
   adapter, the claim → action → outcome flow for a consumer), ships its own reference Worker, and
   runs `@worker-protocol/conformance` against that Worker in its CI. The conformance report is
   what ties the repositories together: an SDK is right because its reference Worker passes, not
   because somebody read the prose carefully.

**Rejected, and why:**

- *Types only, generated from `schemas/`.* Cheapest, and it leaves every SDK reading `spec/` for
  addresses, verbs, parameters and codes — which is the thing this entry exists to stop.
- *One OpenAPI document with symbolic paths and an `x-worker-protocol-address` extension.*
  One client per Worker instead of one per Capability, at the price of a hand-written interceptor
  in every language; and a generator that ignores the extension produces a client that calls
  `/metrics` for real, which is the assembled address ENDP-1 says nobody constructs.
- *The address as a path parameter of every operation.* A path parameter cannot carry `/` or a
  different origin, and DESC-12 permits both; most generators percent-encode it and the call
  fails.
- *`openapi/` as a derived, non-normative convenience.* An SDK could then be faithful to the
  artifact and unfaithful to the specification with no document saying which of the two misread.
- *`openapi/` normative and the prose tables deleted.* Loses the argument beneath each code — why
  `502` and `504` are two codes, why `schema_mismatch` is not `malformed_request` — and a reader
  without a toolchain, whom `schemas/` exists to serve, could no longer read the codes at all.
- *All SDKs inside this repository under `sdk/`.* One commit would move every SDK, at the cost of
  several toolchains in one checkout and a README that has to explain why `sdk/` carries
  behaviour when `packages/` may not.
- *Generated code only, no idiomatic layer.* Resolving the Descriptor, the claim flow and the error
  envelope are exactly what an SDK exists to give, and every consumer would rewrite them.

**Still open:**

- Which languages first.
- Whether a second generator turns a *live* Descriptor into a per-Worker OpenAPI for its own
  Action inputs and Task payloads, which `openapi/` cannot describe because they are the Worker's.
- Whether `examples/reference-worker` moves to a TypeScript SDK repository once one exists, or
  stays here as the fixture `packages/conformance` tests against.

**Lands in:** `packages/schemas/src/surfaces.ts`; `openapi/` with `pnpm openapi:generate` and
`pnpm openapi:check` as an eleventh CI step in `.github/workflows/ci.yml`; the layer table in
[README.md](../README.md) and the sentence beneath it; `packages/conformance/src/generate-rules.ts`;
the code tables in [spec/endpoints.md](../spec/endpoints.md), which stay and are marked as reading
aids. The `Run the checks` list in `CLAUDE.md` gains the two new commands.

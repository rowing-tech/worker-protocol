# Working in this repository

## Run the checks without asking

The commands below may be run at any time, unprompted, and do not need to be offered first. They
only read the tree or rewrite a generated artifact from its source; none of them deploys, publishes
or touches anything outside this checkout.

```
pnpm check                write formatting and lint, from biome.jsonc
pnpm schemas:check        compare schemas/ against the Zod source, byte for byte
pnpm spec:lint            check the rule-id convention spec/README.md states
pnpm verifiability:lint   check every rule is classified in conformance/verifiability.md
pnpm prose:lint           check hand-wrapped Markdown holds the line width biome.jsonc states
pnpm skill:lint           check every rule id skills/ cites is one rules.json holds
pnpm dx:check             check examples/minimal-worker stays under its line budget
pnpm rules:check          compare packages/conformance/rules.json against spec/
pnpm typecheck            type-check scripts/
pnpm -r build             compile what each package publishes
pnpm openapi:check        compare openapi/ against the routes in packages/hono, byte for byte
pnpm -r typecheck         type-check every workspace project, generators and tests included
pnpm test                 all three suites: the fixtures, openapi/, and the verifier against the
                          reference worker
```

Those thirteen are what `.github/workflows/ci.yml` runs, in that order. A change is not finished
until they pass, so run them rather than reporting work as done and leaving them to somebody else.

**`pnpm dx:check` counts the domain lines in `examples/minimal-worker/src/worker.ts`**, because
`packages/` claims that complying is cheap and a claim nobody counts is a claim nobody verifies.
Comments are free, so explaining the example costs it nothing, and the ceiling sits far above where
the file is: a limit tight enough to bind would be met by showing less of the protocol, which is the
one thing that example must not do. If it ever fails, ask which rule `mount()` failed to carry
before moving the number — and never answer it by making the example worse.

**`pnpm -r build` comes before `pnpm openapi:check` and `pnpm -r typecheck`, and the order is not a
preference.** `@worker-protocol/conformance` and `@worker-protocol/hono` both import
`@worker-protocol/schemas`, whose code and types live in a `dist/` that does not exist on a clean
checkout until the build runs. The other way round either fails with `Cannot find module` — and
fails only in CI, because a working tree already holds a `dist/` from an earlier build. If you are
chasing a failure that will not reproduce locally, delete every `dist/` directory first.

Three more rewrite a generated artifact from its source and are equally free to run:

```
pnpm schemas:generate     write schemas/ from the Zod objects in packages/schemas
pnpm openapi:generate     write openapi/ from the routes in packages/hono/src/surfaces.ts
pnpm rules:generate       write packages/conformance/rules.json from spec/
pnpm check:fix            apply biome's formatting and its safe fixes
```

**`pnpm check:fix` is the only one of these that edits a file somebody wrote by hand**, so read what
it changed rather than committing it unseen. Biome does not touch `schemas/`, whose bytes belong to
the generator above, and does not touch any `.md`, because the prose in `spec/` and `docs/` is the
artifact this repository publishes and its line breaks were chosen. Both exclusions are in
`biome.jsonc` with the reason attached; widening them is how a formatter comes to fight the
generator, or to reflow a paragraph somebody argued over.

Git commands are a separate question and this file does not widen them: stage and commit only when
asked, as the user's own instructions say.

## Releasing is not on that list, and `pnpm release` least of all

```
pnpm bump <patch|minor|major|x.y.z>   rewrites the version in five manifests
pnpm release                          tags the commit and pushes the tag
```

Neither is ever run unprompted. `pnpm bump` edits files somebody has to read before committing, and
`pnpm release` pushes a tag that starts `.github/workflows/publish.yml`, which publishes four
packages to the public npm registry — where a version cannot be replaced, only superseded. That is
the most irreversible thing this repository can do, and it is the user's to do. `--dry-run` on
either is safe and is how to show what a release would be.

`pnpm release:check` only reads git and is free to run. `packages/README.md` holds the whole
procedure and the reasoning behind it.

## A generated artifact belongs in the same commit as the source that produces it

Three things here are generated **and** committed, and CI regenerates each in memory and fails when
what is in the tree differs.

| Artifact | Produced from | Regenerate with |
|---|---|---|
| `schemas/` | the Zod objects in `packages/schemas` | `pnpm schemas:generate` |
| `openapi/` | the Hono routes in `packages/hono/src/surfaces.ts` | `pnpm openapi:generate` |
| `packages/conformance/rules.json` | `spec/`, `conformance/verifiability.md` and `packages/hono/src/codes.ts` | `pnpm rules:generate` |

Editing a Zod object without regenerating leaves a commit that cannot pass, and the two files then
disagree about what a Worker must send — with prose deferring to a schema that no longer says what
anybody wrote. Writing a rule without regenerating leaves a verifier whose universe is missing it,
which is a report that is silent about an obligation rather than wrong about one, and therefore
worse.

Both are committed rather than built on demand for the same reason: `schemas/` is the normative
artifact and has to be readable by somebody who will never run this toolchain, and `rules.json`
travels inside a published npm package where `spec/` does not follow it.

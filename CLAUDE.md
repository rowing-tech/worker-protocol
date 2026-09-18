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
pnpm rules:check          compare packages/conformance/rules.json against spec/
pnpm typecheck            type-check scripts/
pnpm -r build             compile what each package publishes
pnpm -r typecheck         type-check every workspace project, generators and tests included
pnpm test                 both suites: the fixtures, and the verifier against the reference worker
```

Those ten are what `.github/workflows/ci.yml` runs, in that order. A change is not finished until
they pass, so run them rather than reporting work as done and leaving them to somebody else.

**`pnpm -r build` comes before `pnpm -r typecheck` and the order is not a preference.**
`@worker-protocol/conformance` imports `@worker-protocol/schemas`, whose types live in a `dist/`
that does not exist on a clean checkout until the build runs. The other way round it fails with
`Cannot find module` — and it fails only in CI, because a working tree already holds a `dist/` from
an earlier build. If you are chasing a failure that will not reproduce locally, delete both `dist/`
directories first.

Three more rewrite a generated artifact from its source and are equally free to run:

```
pnpm schemas:generate     write schemas/ from the Zod objects in packages/schemas
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

## A generated artifact belongs in the same commit as the source that produces it

Two things here are generated **and** committed, and CI regenerates each in memory and fails when
what is in the tree differs.

| Artifact | Produced from | Regenerate with |
|---|---|---|
| `schemas/` | the Zod objects in `packages/schemas` | `pnpm schemas:generate` |
| `packages/conformance/rules.json` | `spec/` and `conformance/verifiability.md` | `pnpm rules:generate` |

Editing a Zod object without regenerating leaves a commit that cannot pass, and the two files then
disagree about what a Worker must send — with prose deferring to a schema that no longer says what
anybody wrote. Writing a rule without regenerating leaves a verifier whose universe is missing it,
which is a report that is silent about an obligation rather than wrong about one, and therefore
worse.

Both are committed rather than built on demand for the same reason: `schemas/` is the normative
artifact and has to be readable by somebody who will never run this toolchain, and `rules.json`
travels inside a published npm package where `spec/` does not follow it.

# Working in this repository

## Run the checks without asking

The commands below may be run at any time, unprompted, and do not need to be offered first. They
only read the tree or rewrite a generated artifact from its source; none of them deploys, publishes
or touches anything outside this checkout.

```
pnpm schemas:generate           write schemas/ from the Zod objects in packages/schemas
pnpm schemas:check              compare schemas/ against the Zod source, byte for byte
pnpm spec:lint                  check the rule-id convention spec/README.md states
pnpm typecheck                  type-check scripts/ and packages/schemas
pnpm -C packages/schemas build  compile what the package publishes
```

Those five are what `.github/workflows/ci.yml` runs, in that order. A change is not finished until
they pass, so run them rather than reporting work as done and leaving them to somebody else.

Git commands are a separate question and this file does not widen them: stage and commit only when
asked, as the user's own instructions say.

## A change under `packages/schemas` is not finished until `schemas/` is regenerated

`schemas/` is the normative artifact and it is generated **and** committed, so CI regenerates it in
memory and fails when what is in the tree differs. Editing a Zod object without running
`pnpm schemas:generate` leaves a commit that cannot pass, and the two files then disagree about
what a Worker must send — with prose deferring to a schema that no longer says what anybody wrote.
The generated files belong in the same commit as the source that produces them.

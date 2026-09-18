# Working in this repository

## Run the checks without asking

The commands below may be run at any time, unprompted, and do not need to be offered first. They
only read the tree or rewrite a generated artifact from its source; none of them deploys, publishes
or touches anything outside this checkout.

```
pnpm check                          biome: formatting and lint
pnpm schemas:check                  compare schemas/ against the Zod source, byte for byte
pnpm spec:lint                      check the rule-id convention spec/README.md states
pnpm verifiability:lint             check every rule is classified in conformance/verifiability.md
pnpm typecheck                      type-check scripts/
pnpm -C packages/schemas typecheck  type-check every file under packages/schemas/src
pnpm -C packages/schemas build      compile what the package publishes
pnpm test                           run conformance/fixtures/ against the Zod objects
```

Those eight are what `.github/workflows/ci.yml` runs, in that order. A change is not finished until
they pass, so run them rather than reporting work as done and leaving them to somebody else.

Two more rewrite a generated artifact from its source and are equally free to run:

```
pnpm schemas:generate           write schemas/ from the Zod objects in packages/schemas
pnpm check:fix                  apply biome's formatting and its safe fixes
```

**`pnpm check:fix` is the only one of these that edits a file somebody wrote by hand**, so read what
it changed rather than committing it unseen. Biome does not touch `schemas/`, whose bytes belong to
the generator above, and does not touch any `.md`, because the prose in `spec/` and `docs/` is the
artifact this repository publishes and its line breaks were chosen. Both exclusions are in
`biome.jsonc` with the reason attached; widening them is how a formatter comes to fight the
generator, or to reflow a paragraph somebody argued over.

Git commands are a separate question and this file does not widen them: stage and commit only when
asked, as the user's own instructions say.

## A change under `packages/schemas` is not finished until `schemas/` is regenerated

`schemas/` is the normative artifact and it is generated **and** committed, so CI regenerates it in
memory and fails when what is in the tree differs. Editing a Zod object without running
`pnpm schemas:generate` leaves a commit that cannot pass, and the two files then disagree about
what a Worker must send — with prose deferring to a schema that no longer says what anybody wrote.
The generated files belong in the same commit as the source that produces them.

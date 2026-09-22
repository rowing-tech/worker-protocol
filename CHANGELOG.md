# Changelog

Every release of the four packages this repository publishes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), with one addition this repository needs.

**Each entry names the edition it encodes as well as its version, because the two are independent
and neither can be read off the other.** A package version is SemVer and describes what the package
exports; an **edition** is `MAJOR.MINOR` and describes the protocol. Most releases here move the
first and not the second. The rule that binds them is that an edition change never arrives in a
release a consumer's caret would take on its own — `pnpm release:check` holds it, and an entry that
carries one says so under a heading of its own, because it is the only change that can put a Worker
out of reach of tools built for the edition before.

What changed inside a rule is not written here. Each file in [`spec/`](spec/) ends with a
`Withdrawn` list carrying the id, what it required and what replaced it, beside the argument that
justifies it. This file says what a release carried; those say what a rule became.

## [Unreleased]

## [0.1.3] - 2026-09-22 — edition 0.1

### Added

- **`author` and `keywords` on all four manifests.** `author` is the field npm renders in a
  package's sidebar, and `keywords` is how its search finds a package somebody cannot already name;
  with neither, these were reachable by exact name or by arriving from GitHub and by nothing else.
  The authorship was never missing, only misplaced — the `NOTICE` has carried the copyright inside
  every tarball since 0.1.1, where Apache-2.0 §4(d) obliges a redistributor to keep it, and the
  provenance attestation since 0.1.2 says which repository and commit the bytes were built from.

  Three keywords were deliberately left out. `automation` is vague and crowded; `orchestration` and
  `service-discovery` would be false — this protocol has no orchestrator, since a Control Tower
  holds nobody's state and is in the path of no call, and no discovery, since enrolling is an
  operator pasting a URL and a credential. A keyword that misdescribes the model costs a
  specification more than an absent one.

- **This file, and a gate that keeps it honest.** `pnpm release:check` now refuses a release whose
  version has no section here, at the tag, which is the moment a changelog has to be true. A
  hand-maintained artifact nobody compares is the shape of claim this repository writes gates
  against everywhere else.

## [0.1.2] - 2026-09-22 — edition 0.1

### Added

- **Two Agent Skills, at [`skills/`](skills/).** `worker-protocol` is the protocol for an
  implementer in any language: which of the three artifacts is normative, the surface written by
  hand where no SDK exists — both headers, the error envelope and its eighteen codes, the page
  envelope and its cursor, version negotiation, the idempotency window — the gotchas that hold
  whatever the language, and the verification loop. `worker-protocol-hono` is the TypeScript layer
  over it and opens by pointing at the first. `npx skills add rowing-tech/worker-protocol` installs
  them.

  They are split the way [the roadmap](docs/roadmap.md) splits the SDKs: a repository in C#, Python
  or Go owes the same 153 rules and has no SDK at all, and an agent filters on a skill's description
  alone — so one skill announcing itself as TypeScript would never be loaded by the reader who needs
  the rules most.

- **`pnpm skill:lint`**, the thirteenth gate. Every rule id a skill cites must be one
  `packages/conformance/rules.json` holds — the verifier's own universe, regenerated from `spec/`
  one step earlier in the same workflow — so a withdrawn or renumbered id fails CI rather than going
  on being taught. A skill is prose an agent reads instead of `spec/`, and prose is worse than code
  for that fault, because nothing type-checks it.

### Changed

- `@worker-protocol/hono` and `@worker-protocol/conformance` point at the skills from their READMEs.

## [0.1.1] - 2026-09-22 — edition 0.1

### Added

- **A README in each package.** The four npm pages were blank: 0.1.0 was published before they were
  written. Every claim in them was checked against the code rather than read over — the export table
  in `@worker-protocol/schemas` names 48 objects and all 48 exist with none missing, and the Worker
  example in `@worker-protocol/hono`'s README was extracted and compiled.
- **A provenance attestation on every tarball.** For a repository whose product is a specification
  this is not a formality: `spec/` can be read by anyone, and provenance is what says the bytes on
  npm were built from it, at a commit somebody can look at. `--provenance` on the publish and
  `id-token: write` on the job. **0.1.0 carries none and cannot be given any**, since an attestation
  is made at publish time and a published version is never rewritten.

### Changed

- Each `homepage` points at its own package directory. Pointing all four at the root README was
  right while that was the only README there was.
- The workflows move to `actions/checkout@v7`, `actions/setup-node@v7` and `pnpm/action-setup@v6`,
  ahead of Node 20 being withdrawn from the runners.

## [0.1.0] - 2026-09-22 — edition 0.1

The first release. Edition 0.1 was already published when it was cut, which is why the package
version and the edition agree here and will not again.

### Added

- **The four packages on npm under `@worker-protocol`**: `schemas`, the Zod objects that generate
  the normative JSON Schemas; `hono`, the surface as Hono routes and `mount()` over them; `client`,
  `consume()` for the consumer half; `conformance`, the verifier.
- **A release is a tag and nothing else.** `pnpm bump` sets one version across the root and the four
  packages, `pnpm release` tags and pushes, and `.github/workflows/publish.yml` triggers on `v*` and
  on nothing else. `spec/README.md` argues that an edition is fixed by a release rather than by a
  commit — *a commit is not a release, a branch nobody pulled is not a publication* — and this is
  the mechanical half of that sentence.
- **`pnpm release:check`**, holding the one rule that binds a package version to an edition: an
  edition change never arrives in a release a consumer's caret would take on its own. Which release
  that is depends on where the packages sit in their own history, because npm reads a caret
  differently on either side of 1.0.0, and the check knows both floors.
- **An `edition-<edition>` dist-tag**, moved by each release, so that
  `npm i @worker-protocol/hono@edition-0.1`
  answers the question a consumer of a specification actually has and that a semver range cannot
  express: a range knows about versions, and the edition is a manifest field it cannot see.
- **`LICENSE` and `NOTICE` inside every tarball**, copied at pack time. npm ships only what sits
  inside a package directory, and the `NOTICE` is where the reservation lives that *worker-protocol*
  and any conformance claim made in its name are not granted by Apache-2.0.

### Changed

- **`zod` is a peer dependency of `schemas`, `hono` and `client`; `hono` is one of `hono`.**
  `mount()` takes the `z.object()` schemas a Worker author wrote and gives them to
  `@hono/zod-openapi` beside the ones `@worker-protocol/schemas` exports — with two copies of Zod in
  the tree those are not the same kind of object, and what the author reads is a type error about
  two declarations that look identical.

### Fixed

- **`@worker-protocol/client` declared `zod` only as a devDependency** while its published
  declarations import it, in `call.d.ts`, `index.d.ts` and `skills.d.ts`. A consumer never installs
  devDependencies, so it resolved by accident through npm's flat tree and not at all under pnpm's —
  a break that depends on the consumer's package manager.

[Unreleased]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rowing-tech/worker-protocol/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rowing-tech/worker-protocol/releases/tag/v0.1.0

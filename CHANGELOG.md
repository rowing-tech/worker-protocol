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

### Added

- **`examples/fleet-worker` gained a Tail Worker, for what the producer cannot record about
  itself.** `cycle()` records at the end of its work, so an invocation that threw without catching,
  ran out of CPU or was cancelled records nothing — and nothing else on the Descriptor covers it:
  `health` is a poll and answers truthfully once the process is back, an Alert is a condition that
  holds and a crash three minutes ago does not, and the metric was never incremented because the
  line that would have incremented it is the line that did not run. A hard failure was silence
  indistinguishable from calm.

  The consumer writes an uncaught exception and a non-`ok` outcome into the producer's Durable
  Object, bound across scripts with `script_name`, so `/logs` answers one feed and a Control Tower
  still asks the producer. It throws `event.logs` away — forwarding it would be the `console`
  capture `spec/logs.md` argues against, and it is also what stops the tail feeding itself, since a
  Durable Object call is traced too and comes back carrying `outcome: ok`.

  Nothing in `packages/` changed, so nothing here is published: the example is `private: true` and
  the version stands at 0.2.0.

## [0.2.0] - 2026-09-23 — edition 0.2

### The edition moves, and this is the first release that moves it

**Edition 0.1 → 0.2, which is a MINOR under DESC-24: it adds what a reader holding 0.1 may ignore
and still be correct.** A reader that meets `logs` in a Descriptor it does not know ignores the name
and reports what it ignored (DESC-25); a verifier on 0.1 checks what 0.1 defines and says so. Nobody
on the old edition is wrong, which is the whole test a MINOR has to pass.

The package version moves with it for the reason `packages/README.md` argues and
`pnpm release:check` enforces: **a release that changes which edition a package encodes is never one
a consumer's caret would take on its own.** `^0.1.3` does not take `0.2.0`, so upgrading is a thing
somebody does on purpose — which matters here more than usual, because `mount()` writes the edition
into the Descriptor, and a Worker that took this release by accident would start declaring a
specification nobody chose to every consumer, catalog and verifier that reads it.

**What publishing this costs, permanently: LOG-1 to LOG-10 and ENDP-33 are now fixed.**
`spec/README.md` makes an id immutable from the edition that publishes it, so from here a rewrite to
any of them that could change a verdict costs a withdrawal and a new number. Until this tag they
could be reworded, narrowed or renumbered freely, and `logs` used that right twice: the paging rule
was a `logs` rule of its own for a day before it became ENDP-33 in `endpoints.md`, and the rule
below it moved down into the number that left.

### Changed

- **`ENDP-33`: a page reached through a cursor carries no item the page that produced it already
  carried — and `collection()` pages by position rather than by offset.** The rule arrived while
  `logs` was being written and was a `logs` rule for a day, which was the wrong altitude: every
  collection in this protocol is derived on each read, so the list a caller is paging is never quite
  the list its cursor came from. Under the offset `@worker-protocol/hono` used, an Alert firing
  between two pages handed the caller an Alert it had already seen, and a Task's condition ceasing
  skipped one it never would — on `alerts`, `activity`, `tasks` and `metrics` alike, invisibly, with
  no rule stating it and no check looking.

  A cursor now names the last position a page carried, so the page after it is what sorts beyond
  that position and nothing arriving meanwhile can be inside it. It is base64 of a tagged payload
  rather than a number, which also closes the other half of ENDP-21: a cursor this Worker did not
  mint is refused instead of acted on, where before any integer was a valid position. **Cursors
  minted by an earlier build are refused** — which costs nothing, because ENDP-21 has never let a
  caller keep one beyond the paging it was in the middle of.

### Added

- **`logs`, a ninth Capability: what a Worker recorded while it was working.** Until it, **nothing
  in this protocol answered in the past tense.** Health is now; an activity is now and vanishes when
  the Worker stops holding it (ACTV-5); an Alert is now and ends when its condition stops (ALRT-5);
  a Task is now for the same reason (TASK-15); a metric is an aggregate that never says which
  occurrence it counted; an event is pushed to whoever contracted for it and is gone. A Worker could
  say what it was doing and how much it had managed, and nothing at all about anything finished.
  [`spec/logs.md`](spec/logs.md) carries ten rules and the argument for them;
  `@worker-protocol/hono` carries the decoding and `@worker-protocol/conformance` checks every one
  of them against a Worker over a socket, so the Capability arrives written, implemented and
  verified rather than in three releases.

  What it buys is also less than the other eight buy, and the file says so: every other surface
  carries a closed vocabulary a program acts on, and a record carries a level and then text nobody
  outside the Worker will parse. One console over Workers on three platforms here means one place to
  *read* rather than one place to *act*.

  Three things about it were settled against what was tempting. The record is
  OpenTelemetry's model — instant, severity, body, attributes — in this protocol's spelling, and
  **not** OTLP on the wire: a collector receives a push and does not page an HTTP surface with a
  cursor, so adopting `timeUnixNano` and boxed attribute values would have bought the appearance of
  interoperability, none of the substance, and the one surface here whose instants are spelled
  differently from every other. `fields` is a flat map of scalars, which is the payload
  [`spec/activity.md`](spec/activity.md) refused — admitted here because the reader is a person and
  a flat map is renderable by anything, where an activity payload would have been for a program and
  a program needs a declared schema. And the instant does **not** establish the order (LOG-6):
  records written inside one request share a millisecond, so a caller reads the order the page
  arrives in.

  The feed is a window rather than an archive, so the absence of a cursor means *the end of what the
  Worker still holds* and not *the end of what happened*. That is stated in the file rather than
  signalled in `page.json`, which six other surfaces share and none of them needs it for.

  **A record is written on purpose, and capturing a runtime's `console` into this surface is
  explicitly not the shape.** That was tried in `examples/fleet-worker` and taken back out: a
  global patch is one feed per process, blind to whose work produced each line, so what it serves
  belongs to whichever isolate was running rather than to the work. Written deliberately, a record
  lands wherever the Worker's store already separates one customer's things from another's. The
  surface is one feed and it is the operator's, so a Worker whose records belong to its customers
  serves them the way it serves the rest of that customer's data and does not declare this
  Capability — DESC-2 makes leaving one out free.

- **`examples/fleet-worker` serves `logs` from its Durable Object, and its README prices the
  Cloudflare routes that were rejected.** There is no API in the Workers runtime for reading a
  Worker's own `console` output back. Querying Workers Logs from inside the Worker needs a secret
  holding an account token with `Workers Observability Write` — there is no read-only scope, and it
  covers every Worker in the account. A Tail Worker costs a second deployment and is the only route
  that also sees uncaught exceptions and the invocation outcome; it is still open. What the example
  does instead is record on purpose, in one call per cycle, beside the metric it already counts.

  The Durable Object is the load-bearing part: a window kept in the isolate is one window per
  isolate, so a read can land somewhere that never saw the write — which passes every local test and
  is wrong in production. The records are in SQLite rather than the key-value API the rest of that
  object uses, because a read filters by a level floor and a half-open interval and a store that
  cannot filter would hand the Worker every row to throw away.

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

# packages

To be published under the npm scope `@worker-protocol`. They exist to make two things cheap:
complying, and proving that you comply.

| Package | What it is |
|---|---|
| `schemas` | `@worker-protocol/schemas` — the Zod objects that generate `schemas/`, so an implementer never retypes the specification |
| `hono` | `@worker-protocol/hono` — the surface as Hono routes, which generate `openapi/`; and `mount()`, which a Worker on Hono mounts to get every address, header and refusal the protocol fixes |
| `client` | `@worker-protocol/client` — `consume()`: read a Worker, and take work from it. The consumer half, and what a Tower or a teams app is built on |
| `conformance` | `@worker-protocol/conformance` — point it at a worker's base URL, get a report of what it complies with; `verify()` from TypeScript, or `npx @worker-protocol/conformance <url>` from anywhere |

`client` is its own package and not a second export of `hono`, because a consumer is not a server:
a Tower, a teams app or a Convex Worker that answers another Worker's Tasks runs no web
framework, and making one install Hono and an OpenAPI generator in order to make HTTP requests is
the same mistake as the one below, in the other direction. It depends on `schemas` and on `fetch`.

All four are derivable from the specification and verifiable against the fixtures or the
verifier. `hono` is the one TypeScript SDK and lives here rather than in a repository of its own,
because the routes it exports are also the source `openapi/` is generated from, and the declaration
that generates the normative artifact does not leave the repository that publishes it.

## What "carries no behavior of its own" forbids, and what it asks for

The constraint is about **whose** behavior, not how much. A package may not do something `spec/`
does not say: that is a package making the standard, and it rots the text the moment the two
disagree. A package carrying what `spec/` *does* say is the opposite — it is the specification
compiled once instead of re-derived by everyone.

That sentence was read the narrow way for a while and it cost something measurable. `mount()`
handed a Worker author a raw `URLSearchParams` and took back a page, so every Worker that declared
`tasks` wrote its own paging, its own cursor, its own unknown-filter refusal and its own ordering —
several hundred lines of rules, identical in every Worker, in a repository whose whole argument is
that a rule written twice is a rule that will disagree with itself. The reference Worker was a
thousand lines and said of itself that it was not a starting point to copy, which left a developer
with no starting point at all.

**The test is whether a rule id can be cited for the line.** If `mount()` does something and no
rule in `spec/` requires it, that is the forbidden case and the honest response is to argue for the
rule. If a rule requires it and a Worker author is writing it, the package is the one in the wrong.
Everything `mount()` carries cites the rules it carries; what it leaves alone — what a Task's
condition is, what an Action does, what a number means — is what `spec/` deliberately never says.

## The measure

`examples/minimal-worker` declares every Capability this protocol defines, and `pnpm dx:check`
counts the domain lines it takes to do it. It exists because complying being cheap is a claim like
any other here, and a claim nobody counts is a claim nobody verifies. When it grows, the question is
which rule `mount()` failed to carry.

**The ceiling that script enforces is deliberately slack**, and the reason is worth having in
writing: a limit tight enough to bind is one that can be met by showing less of the protocol or by
explaining it worse, and on the day that happens the gate has spent exactly what it was protecting.
The count is evidence, not a budget to spend.

`conformance/reference-worker` is a different thing and is not a template: it is arranged so that
the rules `conformance/verifiability.md` marks `H` have something to be observed against. It sits
under `conformance/` rather than `examples/` because it is evidence, not a starting point.

**`consume()` is not the whole of that package.** TASK-30 has an answerer declare what it needs to
receive and TASK-2 has an owner declare what it sends, and deciding whether the two agree is an
algorithm `spec/tasks.md` states rather than a policy anybody chooses — so `canAnswer` is exported
beside `consume`. A Control Tower product is a non-goal and this is not one: it is the question an
operator asks when enrolling a Worker, answered from two Descriptors and calling nobody. Left
unpublished, every Tower, teams app and proxy would derive it again and disagree about the edges —
which is what this package exists to stop.

## The rules that bind the other side

`mount()` carries what a Worker owes; `consume()` carries what a *consumer* owes, and that list is
not short. Nine rules in `spec/` oblige a caller rather than a Worker — DESC-13, DESC-30, ENDP-13,
ENDP-14, ENDP-21, ENDP-27, ENDP-28, ENDP-30, ENDP-31 — and every one is required. Until this
package existed they had no subject anywhere: `conformance/verifiability.md` classes them `P` and a
report says *other subject*, correctly, because a tool pointed at a Worker never contacted whoever
they bind.

They are obeyed in `client/src/call.ts`, each cited on the line that obeys it, and
`client/src/__tests__/consumer-rules.test.ts` holds one test per id against a Worker made to
misbehave on purpose. That does not change what a conformance report says about a Worker. It means
the consumer in this repository is one somebody can read the rules off, which is the same standing
`mount()` has and is the only standing anything here gets.

## A package version is not an edition

**These packages are versioned independently of the protocol, and neither number can be read off
the other.** A package version is SemVer and describes the package. An **edition** is DESC-23,
written `MAJOR.MINOR`, and describes the protocol. `@worker-protocol/schemas@2.4.1` says nothing
about which edition it encodes, and edition 1.3 says nothing about which package version to
install.

They are independent because they move for different reasons. A package needs a release when Zod
changes major, when a type is made more precise, when a build is fixed — none of which is a change
to the protocol, and all of which would otherwise force an edition nobody meant. In the other
direction, an edition can turn on a sentence in `spec/` that no schema expresses, and that release
would be a package version with nothing in it.

So **a package states which edition it encodes**, and that declaration is the only link between the
two numbers. Reading the package version instead is the mistake this section exists to prevent: it
is the kind that survives review and surfaces later, in a consumer's lockfile, as a schema that
does not mean what the code around it assumed.

The package's PATCH component keeps its ordinary SemVer meaning — a change with no effect on what
the package exports. It has no protocol meaning at all, which is the clearest illustration of the
two numbers being independent: the edition has no PATCH, because
[descriptor.md](../spec/descriptor.md) argues a specification has no use for a component that by
construction changes no verdict. One rule keeps the two honest: **a release that changes which
edition a package encodes is never one a consumer's caret would take on its own.**

Which release that is depends on where these packages are in their own history, and the reason is
npm's rather than this specification's. `^0.1.0` means `>=0.1.0 <0.2.0`, so while the packages sit
on a zero MAJOR a MINOR is already a wall nobody crosses without editing their own manifest, and
forbidding a PATCH is the whole of what the rule needs to say. `^1.0.0` takes every MINOR there is,
so **from 1.0.0 an edition change is a MAJOR.** `scripts/lint-release.ts` knows both and picks
between them; the day the second one starts to matter is not a day anybody will remember this
paragraph.

All four packages declare `"workerProtocolEdition": "0.1"`, and `@worker-protocol/schemas`
exports it as `EDITION` so a consumer can read it without parsing a manifest.

**The two `0.1`s in that sentence are unrelated, and the coincidence is worth naming rather than
leaving to be noticed.** The package version moved from `0.0.0` to `0.1.0` because the rule above
says a release that changes which edition a package encodes is never a PATCH here, and `0.1.0` is
the smallest number that obeys it. The edition is `0.1` because it is the first. They agree today
and will diverge at the next release of either — a Zod major, a type made more precise, a build
fixed, none of which is a change to the protocol. Reading one off the other is the mistake this
section exists to prevent, and it is never more tempting than on the day they happen to match.

## A Worker declares the edition its package encodes, and upgrading is how that changes

Nothing in `examples/minimal-worker` mentions an edition, and the Descriptor it serves declares
`0.1`. `mount()` writes it: both that Descriptor and the `worker-protocol-edition` header on every
response come from the `EDITION` constant `@worker-protocol/schemas` exports. A Worker author never
types the number, and there is no copy of it to keep in step with anything.

**So upgrading `@worker-protocol/hono` changes what your Worker asserts to everyone who reads it,
with no line of your own code changing.** That is intended rather than overlooked. The edition is a
fact about which specification the code now running implements, and after an upgrade that is a
different one; a Worker that went on declaring the old number would be the failure this arrangement
exists to prevent — a claim maintained by hand, drifting away from the code that has to honour it.

Within a MAJOR that is safe by construction, and DESC-24 is why: a MINOR only adds what a reader
holding an earlier MINOR of the same MAJOR may ignore and still be correct. Declaring `0.2` while
implementing nothing `0.2` introduced costs nothing, because everything it introduced is ignorable
and everything already implemented still means what it meant.

A MAJOR is the one that is not safe, and the protocol makes it visible rather than quiet. DESC-25
has a verifier compare the edition it holds against the one a Worker declares and report *itself*
older, judging nothing — so a Worker that moves a MAJOR ahead of the tooling around it stops being
verifiable until that tooling follows. That is the cost of an edition change, and it is why the
release rule above will not let one arrive in a release somebody's caret would take on its own.

**`Worker.edition` is the way out, and there is one good reason to reach for it**: you want the
Descriptor to keep asserting the edition you actually verified against, rather than whatever the
next install brings. Set it and the number stops moving by itself — and becomes a line somebody has
to remember, which is the whole of the trade. Leaving it out is right for almost every Worker.

## The verifier is a command, because the promise was made to repositories that run no Node

`docs/roadmap.md` says each language's repository ships its own reference Worker and runs
`@worker-protocol/conformance` against it in CI, and that the report is what ties those
repositories together: an SDK is right because its Worker passes, not because somebody read the
prose carefully. What that offered a repository in Python, C# or Go was a TypeScript function — a
toolchain to acquire and a program to write before it could learn anything about itself.

```
npx @worker-protocol/conformance https://worker.example.com
```

`--credential` presents the bearer token REG-3 fixes, though `WORKER_PROTOCOL_CREDENTIAL` is the
better place for it in CI: argv is readable by every other process on the machine, and a log often
keeps it. `--may-perform` allows POSTs to Actions and is off by default, because an Action is an
operation somebody's operators chose to expose and a tool pointed at a Worker to inspect it does
not perform work on it uninvited. `--json` writes the report instead of rendering it.

**The exit code is the part a CI reads, and it has three values rather than two.** Zero when no
rule failed, 1 when one did, and 2 when no verdict was reached at all — which is this verifier
being older than the edition the Worker declares (DESC-25), and almost nothing else. A Worker that
cannot be reached is not that case and exits 1: it fails DESC-1, because a Worker is not conformant
at an address that does not answer.

`notExercised` never fails a run, which is the distinction `conformance/README.md` spends a
paragraph on. The Worker declares no such Capability, or nobody arranged what the check needs in
order to be observed; both are gaps somebody can close, and neither is an obligation broken.

## What a consumer installs, and what it has to bring

`zod` is a **peer dependency** of `schemas`, `hono` and `client`, and `hono` is one of `hono`. What
stands behind that is not tidiness: it is that these packages and the code using them have to be
holding the *same* Zod, and the same Hono.

`mount()` takes the `z.object()` schemas a Worker author wrote and hands them to
`@hono/zod-openapi` beside the ones `@worker-protocol/schemas` exports. With two copies of Zod in
the tree those are not the same kind of object — a schema built by one is not an instance of the
other's `ZodType`, the OpenAPI registry does not recognise it, and what the author reads is a type
error about two declarations that look identical. Declaring `zod` as an ordinary dependency pinned
to an exact version is what *causes* that: everyone whose own app is on a different 4.x gets both.

**`@hono/zod-openapi` stays an ordinary dependency, and the asymmetry is deliberate.** Its own peers
are `hono` and `zod`, which the consumer now provides, so there is one Hono and one Zod however many
copies of it exist — and it is a package a Worker author never imports by name, since `mount()`
returns its `OpenAPIHono` and that is the whole of the contact. Making it a peer would put a line in
every Worker's manifest for a name nobody in that repository types, against the one claim that
`packages/` makes about itself.

**`@worker-protocol/conformance` carries `zod` as an ordinary dependency although it never imports
it, and that line is not dead weight.** It is the leaf: it is installed in order to be *run*, by the
CI of a repository in another language that has no opinion about Zod and should not have to acquire
one. Satisfying the peer that `schemas` declares, on its consumer's behalf, is the difference
between installing the verifier and installing the verifier plus a warning whose consequence is a
module that will not load.

**A peer carries a range where the rest of this repository pins exactly, and the two state different
things.** A pinned `4.5.4` in `devDependencies` is what this repository builds and tests against,
which is a fact about CI. `^4.5.4` in `peerDependencies` is what it tolerates in somebody else's
tree — and an exact peer would be the duplication problem again by another route, since it refuses
every consumer who is not on that one patch. The floor is the version CI actually runs and not a
lower one: a range claiming Zod 4.0 works would be a claim nothing here has ever checked.

## Releasing

Three commands, and the middle one is not a command:

```
pnpm bump <patch|minor|major|x.y.z>   set the root and the four packages to one version
<commit the manifests>
pnpm release                          tag that commit v<version> and push the tag
```

`pnpm bump --dry-run` prints what would change and writes nothing. `pnpm release --dry-run` prints
the git commands and runs none of them.

**The four packages carry one version, and it is the root's.** They are built together, tested
together and released together; three of them exist only so the fourth is not re-derived by every
consumer. A reader who found `client` at 0.4.0 beside `schemas` at 0.2.7 would learn nothing from
the difference except that they now have to work out which pairs were ever released together.
`workspace:*` does the rest — pnpm rewrites each internal dependency to the version being published
as it packs, so no manifest here ever pins a sibling.

**Nothing publishes from `main`.** `.github/workflows/publish.yml` triggers on a `v*` tag and on
nothing else, which is the mechanical half of the argument `spec/README.md` makes for fixing a rule
id at an edition rather than at a commit: *a commit is not a release, a branch nobody pulled is not
a publication*, and nobody should reach a published number by accident. The tag is the deliberate
act, and `pnpm release` is the only thing that makes one.

Before it publishes, that workflow checks the tag against the version in the tree, re-runs the
three generated-artifact comparisons, the build, the type-check and the full conformance suite, and
runs `pnpm release:check` — which holds the rule above: **a release that changes which edition a
package encodes is never one a consumer's caret would take on its own.** It compares this release
against the previous tag, because an edition change is not something that happens in a commit.
Until that check existed the rule was a sentence with nothing behind it, and the failure it catches
is the quiet one: a consumer takes whatever their range allows without reading anything, exactly as
they should, and would have silently taken a different specification with it.

**A prerelease publishes under the `next` dist-tag, and the workflow works that out from the
version rather than being told.** `pnpm bump 0.1.0-rc.1` produces a version no `^` range will ever
resolve to, which is what makes a release candidate safe to publish — but `latest` is not a range.
It is what a bare `npm i @worker-protocol/schemas` returns, and npm points it at whatever was
published last unless told otherwise. A candidate that took `latest` would be served to everybody
who asked for no version in particular, which is the opposite of what publishing a candidate was
for.

**Each release also points an `edition-<edition>` dist-tag at itself, which is how a consumer asks
the question a range cannot express.**

```
npm i @worker-protocol/hono@edition-0.1
```

The section above argues that the package version and the edition are independent and that reading
one off the other is a mistake. That is right, and on its own it strands somebody: a repository in
another language pins itself to an edition, and a semver range knows about versions and nothing
else — the edition is a manifest field it cannot see. Asking the registry instead keeps the
numbering free to mean what SemVer says it means while still answering *give me the newest
implementation of edition 0.1*.

It also survives what a range does not. When edition 0.2 ships, `edition-0.1` goes on pointing at
the last packages that encode 0.1, which is what a consumer anchored there needs and precisely what
`latest` stops being. A prerelease moves no edition tag, for the reason it does not take `latest`.

**What reaches npm is `packages/*` and nothing else.** The examples and
`conformance/reference-worker` are workspace members, so the filter excludes them by path and their
own `private: true` excludes them again. Each tarball carries a copy of the repository's `LICENSE`
and `NOTICE`, written at pack time by `scripts/pack-legal.ts` rather than committed four times over
— npm ships only what sits inside a package directory, and the `NOTICE` is where the reservation
lives that "worker-protocol" and any conformance claim made in its name are *not* granted by
Apache-2.0.

Publishing needs one secret, `NPM_TOKEN`: a granular access token for the `@worker-protocol` npm
organization, with read and write on those four packages and nothing else.

**Every tarball carries a provenance attestation**, which for a repository whose product is a
specification is not a formality: `spec/` can be read by anyone, and provenance is what says the
bytes on npm were built from it, here, at a commit somebody can go and look at. It is signed with a
short-lived OIDC token describing this workflow — hence `id-token: write` in `publish.yml` — and
npm records it beside the package.

`0.1.0` carries none and cannot be given any. npm attests provenance only from a public repository,
this one became public after that release, and an attestation is made at publish time: a published
version is never rewritten. From the next release on, every version has one.

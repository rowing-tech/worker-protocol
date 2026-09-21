# packages

To be published under the npm scope `@worker-protocol`. They exist to make two things cheap:
complying, and proving that you comply.

| Package | What it is |
|---|---|
| `schemas` | `@worker-protocol/schemas` — the Zod objects that generate `schemas/`, so an implementer never retypes the specification |
| `hono` | `@worker-protocol/hono` — the surface as Hono routes, which generate `openapi/`; and `mount()`, which a Worker on Hono mounts to get every address, header and refusal the protocol fixes |
| `client` | `@worker-protocol/client` — `consume()`: read a Worker, and take work from it. The consumer half, and what a Tower or a teams app is built on |
| `conformance` | `@worker-protocol/conformance` — point it at a worker's base URL, get a report of what it complies with |

`client` is its own package and not a second export of `hono`, because a consumer is not a server:
a Tower, a teams app or a Convex Worker that answers another Worker's Tasks runs no web
framework, and making one install Hono and an OpenAPI generator in order to make HTTP requests is
the same mistake as the one below, in the other direction. It depends on `schemas` and on `fetch`.

All three are derivable from the specification and verifiable against the fixtures or the
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
edition a package encodes is never a PATCH.**

All three packages declare `"workerProtocolEdition": "0.1"`, and `@worker-protocol/schemas`
exports it as `EDITION` so a consumer can read it without parsing a manifest.

**The two `0.1`s in that sentence are unrelated, and the coincidence is worth naming rather than
leaving to be noticed.** The package version moved from `0.0.0` to `0.1.0` because the rule above
says a release that changes which edition a package encodes is never a PATCH, and `0.1.0` is the
smallest number that obeys it. The edition is `0.1` because it is the first. They agree today and
will diverge at the next release of either — a Zod major, a type made more precise, a build fixed,
none of which is a change to the protocol. Reading one off the other is the mistake this section
exists to prevent, and it is never more tempting than on the day they happen to match.

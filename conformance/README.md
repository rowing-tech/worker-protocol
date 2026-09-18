# conformance

The evidence behind every claim of compliance, and the record of what evidence can exist at all.

| File | What it holds |
|---|---|
| [verifiability.md](verifiability.md) | Every rule in the `draft` files, classified by what a check would observe — the audit [spec/README.md](../spec/README.md) demands of itself, and what `packages/conformance` implements |
| [fixtures/](fixtures/) | Documents this protocol accepts or refuses, each one evidence for a named rule |

The fixtures are kept here rather than inside a package so that a verifier in any language can use
them. They judge a **document** against a schema, which is the half of conformance that needs
nothing answering over HTTP; `packages/conformance` is the one that runs the other half against a
live Worker. `pnpm test` runs them from TypeScript today.

## What a report says about a rule

A run produces a verdict for **every** rule in the specification, never only for the ones it
exercised. That is the whole design of this vocabulary, and the reason is the one this repository
applies everywhere else: something is produced and a party reads it. A report listing the checks
that ran, all green, over a specification of 152 rules tells an operator that a Worker was checked
against the protocol. Today that would be 105 of them, and nothing on the page would say which — so
the reader concludes more than was established, which is the same fault as a generated artifact
nobody compares.

| Verdict | What it means |
|---|---|
| `passes` | The check ran and the Worker satisfied it |
| `fails` | The check ran and the Worker did not satisfy it. For a `recommended` rule the report says *does not follow X (recommended)* instead, which is a sentence an operator can act on without it being a verdict — [spec/README.md](../spec/README.md) fixes that wording |
| `not exercised` | A check exists and this run did not reach it: the Worker declares no such Capability, or the check needs a Worker that cooperates and this one does not |
| `unverified` | The rule's subject is the Worker and no party outside it can observe a violation. Reported rather than passed silently |
| `other subject` | The rule binds a verifier, a Control Tower, a consumer, an issuer or this specification. This tool's subject is a Worker, so it establishes nothing either way |

**`not exercised` and `unverified` are separate on purpose, and collapsing them is the mistake this
table exists to prevent.** They read almost identically on a page — neither produced a result — and
they are opposite facts. `not exercised` says a check exists and could have run: point the tool at a
Worker that declares the Capability, or build the fixture that drives this one into the state, and
there is a verdict waiting. `unverified` says no arrangement of any tool ever produces one. A report
that showed both as *not checked* would hide the first behind the second, and the work of closing
the gap would look permanent when almost all of it is a Tuesday afternoon.

`other subject` is the verdict for the twenty-six rules that bind somebody who is not a Worker.
[spec/README.md](../spec/README.md) already says the subject of a rule is whoever the sentence names
and that a report says which of these it was checking; this is that sentence with a place to land.
Those rules are not defects and not exemptions — DESC-20 obliges a Tower and ENDP-28 obliges a
caller, and both are load-bearing. They are simply not claims about the Worker in front of the tool,
and a report that quietly counted them as passed would be vouching for a party it never contacted.

## What the verifier is not allowed to become

**A check reports against a rule id or it does not ship.** A verifier that observes something the
specification does not require has found an opinion, and the honest response is to argue for the
rule in `spec/` — not to fail a Worker over a sentence nobody wrote. The same reasoning
[packages/README.md](../packages/README.md) applies to a package carrying behavior applies here with
more force: a package that does something the text does not say has become the standard, and a
*verifier* that does it has become the standard with a report to enforce it.

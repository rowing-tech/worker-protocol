# spec

Normative for **behavior**: the endpoints, the lifecycles and the status codes that no schema can
state. What a request and a response carry is normative in `schemas/`, and where a sentence here
disagrees with a schema, the schema wins.

One file per subject, each opening with its maturity marker — `stable`, `draft` or `open`. A file
marked `open` lists what it will answer. Where one of those questions is one of meaning and has an
entry in [deliberately undecided](../docs/undecided.md), the bullet links there and the entry
links back, so that when the answer lands both places know; the rest is mechanics, merely
unwritten.

Cross-cutting — every Worker meets these, whatever else it implements:

| File | Subject |
|---|---|
| [descriptor.md](descriptor.md) | What a Worker says it implements: its id, its Capabilities, its versions |
| [endpoints.md](endpoints.md) | Paths, verbs, versioning, errors, idempotency, paging |
| [registration.md](registration.md) | How a Worker is enrolled, and how both sides authenticate |
| [naming.md](naming.md) | Identity, namespaces, and what a schema change breaks |

Capabilities — each a part of the protocol a Worker declares in its Descriptor or leaves out, with
a version of its own:

| Capability | File | Subject |
|---|---|---|
| `health` | [health.md](health.md) | The answer to a poll: one status, named checks |
| `metrics` | [metrics.md](metrics.md) | Named quantities accumulated over declared periods |
| `actions` | [actions.md](actions.md) | Declaring and performing an operation, `configure` and settings included |
| `alerts` | [alerts.md](alerts.md) | Conditions an operator should see |
| `tasks` | [tasks-and-claims.md](tasks-and-claims.md) | Exposing Tasks, claiming under a lease, answering |
| `events` | [events.md](events.md) | The envelope, the broker, deduplication |

The Capability names in that table are a reading aid. The normative list is
[schemas/capability-name.json](../schemas/capability-name.json), and where the two differ the
schema wins — see [descriptor.md](descriptor.md).

The four cross-cutting files are `draft`: they were answered first because every other file leans
on them — the Descriptor route, the addresses, the versioning rule, the error envelope, how either
side of a call proves who it is, and how a name is compared and what a schema change breaks.
[health.md](health.md), [metrics.md](metrics.md), [actions.md](actions.md),
[tasks-and-claims.md](tasks-and-claims.md) and [alerts.md](alerts.md) are `draft` too — the whole
of *operate*, the whole of *delegate*, and the conditions an operator should see.
[events.md](events.md) is the last `open` file: its subject is settled, its answers are not.

## What this specification does not define

**This specification fixes what two parties must agree on in order to talk about work, and stops
there.** Everything a Worker does that no other party can see is the Worker's business, and a
sentence about it in this directory is a sentence that will one day be quoted at somebody who was
right.

**A rule earns its place only if you can name what a conformance check would observe when it is
broken.** Not *how* the check reaches it — what it would see. A rule whose violation looks exactly
like compliance from every vantage point outside the implementation is not an obligation; it is an
opinion with an id, and it will condition somebody's code for no return.

That test admits one exception on purpose. Some rules have a violation that is real and nameable
but that nothing outside can reach: DESC-26, where a second differing Descriptor at some address
nobody enumerated is exactly the fault, and DESC-20, where what a Tower dropped from its catalog is
a fact inside the Tower. Those two are named here because they are the clearest shape of it — the
fault is precise, and the only party who could observe it is the one committing it. Rules in this
class are legal, and `conformance/` reports them as **unverified** rather than passing them
silently, because a check that quietly counts them as passed is the same false claim a generated
artifact nobody compares would be. A rule in this class has to say what would be seen if anyone
could see it. A rule that cannot even do that has failed the test outright and does not belong
here.

**How many there are is a fact rather than an impression, and it is kept in one place.**
[conformance/verifiability.md](../conformance/verifiability.md) classifies every rule in this
directory by what a check would observe; `pnpm verifiability:lint` fails when a rule is added
without a row, and the rules in this class are the ones it marks `N`. This paragraph used to say
the exception *had to stay small* and named two. The register, the first time anybody put the
question to every rule in turn, found sixteen. Whether that is too many is worth arguing about, and
the argument is now possible — which is the point of the count living somewhere gated rather than
in a sentence here that would drift the moment a rule was written.

Named non-goals, each settled by work already done rather than asserted in advance:

- **What a Worker does inside itself.** Its storage, its concurrency, its language, its hosting,
  how it derives its facts, how it schedules itself. [The architecture](../docs/architecture.md)
  makes each Worker authoritative over its own state; this directory never looks in.
- **Credential lifecycle.** How a credential is *presented* binds. What it is made of, who issued
  it, how long it lives, how it is rotated and when a revocation takes effect belong to whatever
  identity provider a deployment already runs — fought out in [registration](registration.md),
  which carries the argument.
- **A security model.** A deployment's exposure, its threat model and how much an error message
  gives away are its own; this protocol has standing to advise and none to enforce.
- **A permission model.** `403` is the entire vocabulary here for a right a caller lacks. A scope,
  a role, a Contract's list — everything behind that status is the Worker's.
- **Style.** Beyond the one-convention-per-kind consistency NAME-3 *recommends* for the names this
  specification itself mints, how anything is spelled is not this protocol's business —
  [naming](naming.md) opens by saying so at length.
- **A data model.** Nothing here says what a Worker's facts, payloads or domain objects look like.
  Every schema a Worker declares is the Worker's own.
- **Orchestration.** No workflow, no routing, no scheduling, no retry policy beyond the class an
  answer carries.
- **A runtime, an SDK or a deployment story.** `packages/` is convenience and carries no behaviour;
  the day a package does something this text does not say, the package has become the standard.
- **A Control Tower product.** The Tower is a role this protocol names and requires little of.

The cost of getting this wrong is not an untidy document. It is thousands of rules that condition
an implementation in ways that buy nobody anything, written by people who will not maintain the
code that obeys them.

## Rule ids

Every obligation in this directory carries an id, so that a conformance report can say *fails
ENDP-11* rather than *fails endpoints*, and so that the same sentence is written once and cited
everywhere else.

**A rule is a bold statement that carries an id and its class. Bold without an id is emphasis, not
obligation, and no obligation is stated outside a bold, id-carrying statement.** That is the whole
boundary, and it is deliberately mechanical: everything else in a file — the argument, the worked
example, the reason a rule is shaped the way it is — binds nobody and can be rewritten freely. A
writer who wants to add an obligation adds an id, and a reader extracting what a Worker must do
reads the bold lines and nothing else.

**Every rule states its class in the rule itself, written `(required)` or `(recommended)` after its
id.** A `required` rule is a contract: a client and a Worker must agree on it for a call to work at
all, or one party will read what the other sent and act on the wrong meaning. A `recommended` rule
is advice this protocol has standing to give and no standing to enforce: breaking it makes one
deployment worse while every call still succeeds and nobody misreads anything. A conformance report
fails a Worker for the first and says *does not follow REG-28 (recommended)* for the second, which
is a sentence an operator can act on without it being a verdict.

The class goes in the rule because there is no safe default. A reader extracting the bold lines has
only what the line says, and an author who meant *recommended* and wrote nothing would have
published an obligation — the one direction this must never fail in. `scripts/lint-spec.ts` refuses
a rule that states neither.

Where a rule turns out to be neither a contract nor advice this specification has standing to give,
it is withdrawn rather than demoted. A recommendation nobody had a reason to make is still
something a reader has to carry.

**A prohibition carries the argument that earns its scope.** Where the argument defends less than
the rule forbids, the rule is wrong — not the implementation that trips over it, and not the reader
who reads the bold line as written. A rule is extracted alone and applied by someone who never saw
the paragraph beneath it, so a prohibition that reaches further than its reason is a reason nobody
can find and a ban everybody obeys. The remedy is the same either way: narrow the rule to what the
argument earns, or write the argument that earns it. If neither can be done, the prohibition was
not wanted.

An id is `PREFIX-N`. Every file has a prefix from the day it exists, whatever its maturity marker,
so that two files never race for the same one:

| File | Prefix | File | Prefix |
|---|---|---|---|
| [descriptor.md](descriptor.md) | `DESC` | [health.md](health.md) | `HLTH` |
| [endpoints.md](endpoints.md) | `ENDP` | [metrics.md](metrics.md) | `MET` |
| [registration.md](registration.md) | `REG` | [actions.md](actions.md) | `ACT` |
| [naming.md](naming.md) | `NAME` | [alerts.md](alerts.md) | `ALRT` |
| | | [tasks-and-claims.md](tasks-and-claims.md) | `TASK` |
| | | [events.md](events.md) | `EVT` |

Numbers are issued in the order rules are written, not in the order they appear, so a file's ids
need not read in sequence. **The number never restarts, and an id is never reused and never
renumbered.** A conformance report is read long after it was produced, and often against a Worker
built to an older edition; an id that silently changed meaning between editions is worse than no id
at all, because it turns a report that was true into a report that is false without either side
noticing.

**An id is fixed by the edition that publishes it. Before that, a rule is edited in place —
reworded, narrowed, widened, reclassified — and neither retires nor reissues.** The protection
above exists for a conformance report that outlives the text it cites, and a report cites what it
was run against, which is an edition (DESC-23). An id that has never appeared in one cannot have
been cited by anything, anywhere, by anyone; retiring it protects a reader who does not exist, and
charges every later reader an entry to scroll past.

The boundary is the edition and not the commit. A commit is not a release, a branch nobody pulled
is not a publication, and a rule that turned on git state would be one a rebase could silently
break — an author would have to know what had been pushed where in order to know whether they were
allowed to fix a typo. An edition is a deliberate act with a number on it, it is already the thing
a Worker declares and a report names, and nobody reaches it by accident.

Today no edition is published: the repository README says to read no section as `stable` whatever
its marker says, so every id in this directory is still editable in place. The `Withdrawn` lists
these files already carry are not obligations under this rule — they record changes that *stand*,
and the reasoning behind them is worth a reader's time. A change that is reverted before
publication leaves no trace at all, because there is nothing left to record: an entry saying a rule
was replaced by one that says the same thing is not history, it is a reader wondering what they
missed.

So, once an edition has published an id:

- **A rule that is deleted keeps its id, withdrawn.** Its number is never issued again. Each file
  ends with a `Withdrawn` list — the id, what it required, and what replaced it if anything — and
  that list is the only place a withdrawn id is written.
- **A rule that is rewritten keeps its id if no verdict could change, and takes a new one if any
  could.** That is the test, and it is about implementations rather than words: rewording, a
  clearer example, a correction of grammar, all keep the id; narrowing what is allowed, widening
  it, or changing a status code all retire the old id and issue a new one.
- **A rule that moves to another file takes a new id in the new file** and leaves the old one
  withdrawn, pointing at it.

An id belongs to one independently checkable obligation. Where a paragraph states three things a
verifier would check separately, it carries three ids, because a report naming one of them is the
point of having them at all.

The subject of a rule is whoever the sentence names — most are obligations on a Worker, and some
are on a verifier, a Control Tower or a consumer, which is why a report says which of these it was
checking. And not every id is checkable from outside: a rule about what a Worker serves *nowhere
else*, or about what a Tower must not forget, has no black-box witness. `conformance/` reports
those as unverified rather than passing them silently, on the same reasoning that makes a generated
artifact nobody compares a claim nobody verifies.

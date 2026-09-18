# Naming and evolution

`draft`

How the things this protocol talks about are identified, and what happens when one of them changes
shape. Rules carry ids and a class; the convention is in [spec/README.md](README.md).

**Almost nothing about how a name is spelled belongs in this file, and saying so first is the point
of it.** Every name this protocol carries is *declared and then echoed*: a Worker publishes its id,
its Capabilities, its Actions and its Task types in a Descriptor, and every other party copies the
bytes back. Nobody types one, nobody assembles one, nobody guesses one. So the questions a naming
section usually answers — which characters are allowed, how long a name may be, which case it is
written in — are questions no party's correctness turns on, and a specification that answered them
would be enforcing its own taste on implementers under the appearance of a contract.

Three things do turn on names, and this file is about those. **When two parties disagree about
whether two names are the same name**, one of them is refusing work it can do. **When two teams
mint the same name for different things**, a reader merges them. And **when a name changes what it
means underneath a party still using it**, nothing anywhere says so. Each of those is a party
misreading something another party produced, which is the only reason a rule here binds.

## When two names are the same name

**NAME-1 (required). Two names are the same name when their bytes are identical. Comparison applies
no case folding, no Unicode normalization, and no trimming of surrounding space.**

This is the one naming rule that is unambiguously a contract, and it is the one most often left
unwritten. A Worker declares that it answers a Task type; a consumer reads the name, holds it, and
sends it back to ask for work. If the Worker lowercases before comparing and the consumer does not,
the two agree about every name that happens to be lowercase already — which is to say the
implementation passes every test anybody writes, until the day somebody declares a name with a
capital in it and a consumer is told there is no such Task type. The same is true of Unicode
normalization, where two byte sequences that render identically on both screens compare unequal,
and no amount of looking at the two strings shows why.

Exact comparison is chosen over a normalizing one because normalization has to be *agreed*, and
agreement is what this protocol cannot assume. A rule that said *compare case-insensitively* would
oblige every implementer to case-fold, which is not one operation — it is a Unicode algorithm with
options, and a Worker that folds with one and a consumer that folds with another are back where
they started, with the added cost that both believe they followed the specification. Byte equality
has exactly one implementation in every language, including the ones nobody has thought of yet.

What this costs is real: a Worker cannot accept `verify-vehicle` from a consumer that typed
`Verify-Vehicle`. It should not, and the declaration is why. The consumer did not type it; it read
it, and if what it read does not match what it sends, something between them altered a name, which
is a fault worth failing on rather than papering over.

## A name is not reused

**NAME-2 (required). A name this protocol carries is never reused for a different thing.**

The names in this protocol are held by parties that hold nothing else. A Contract names Task types,
Actions and events; a consumer's code names the Task types it answers; a conformance report names
what it checked. None of those holds the *document* the name pointed at, and none of them is
re-derived when the Worker changes. So a name reused for a different thing silently re-points every
one of them at once, and the parties holding it are given no signal of any kind: the name still
resolves, the Worker still answers, and what comes back is something else.

That is the same failure REG-13 refuses at the level of a Worker's identity, one level down in the
vocabulary. It is worth noticing that this protocol has no mechanism that would catch it. The Tower
keeps a dated copy of each Descriptor and could in principle see a name disappear and return, but
it is authority over none of it and no rule asks it to look; a consumer sees nothing at all,
because its next call succeeds.

The rule says *for a different thing*, which is narrower than it may read. Retiring a name and
bringing it back for the same thing is not reuse and is not forbidden — a Worker that withdrew an
Action and restored it has done nothing to anybody. What is forbidden is the second life: the name
that meant one thing to whoever holds it and now means another.

There is no time after which this lapses, and that is not an oversight. A bound would have to be
stated against something that expires, and nothing here does: a Contract carries no lifetime in
this protocol, a consumer's source code carries none, and a conformance report is read years after
it was produced. If a Contract ever gains an expiry, this rule can be narrowed against it; today
there is nothing to narrow it against.

## Names that cross between Workers

**NAME-7 (required). A name this protocol expects one party to match against a name that came from
somewhere else is namespaced: a prefix of at least two labels, being a DNS name written in reverse
label order, followed by a local part.
[schemas/qualified-name.json](../schemas/qualified-name.json) carries the form.**

**NAME-8 (recommended). The DNS name a namespace is taken from is one the minting team controls.**

**NAME-9 (required). No two Workers share an id.**

Three names cross today: a **Task type**, a **Skill**, and an **event type**. Each exists to be
recognized by a party that did not mint it — [the architecture](../docs/architecture.md) makes
Skill the unit of discovery, where an owner names a Task type and never an actor, and the Tower
answers who answers it; an event type is matched by a subscriber against what it has decided to
consume. Nothing else crosses today, and the test rather than the list is what decides a fourth:
*does some party match this name against a name that reached it from elsewhere?*

Collision is what NAME-7 buys, and the cost of not having it is specific. Two teams that never
spoke both raise `verify-vehicle`, meaning different things; NAME-1 compares the bytes and they
match; the Tower answers *who answers this Task type* with a consumer that answers the other one.
That consumer claims work it cannot possibly do, and the failure surfaces as a `422` at best and as
a wrong answer at worst — from a party that did everything right. Nobody wrote a bug; two people
used a short English phrase.

DNS is the namespace because it is the only global one every team already holds, and holds
exclusively, without asking anybody for it. There is no registry to run, no authority to appoint,
and nothing for this protocol to operate. Reverse order is the part that is convention rather than
necessity: it puts the organization at the front, so that a prefix comparison answers *are these
two names from the same team* and a sort groups them. Forward order would collide with nothing, but
it would mean one organization had two spellings of its own namespace and nothing could tell.

**NAME-8 is where the guarantee turns out to be social, and it is worth being plain about it.**
Nothing in this protocol verifies that a team owns the domain it mints under, and nothing could
without an authority this design has spent five files refusing to create. A Worker declaring
`tech.rowing.whatever` while owning no such domain is undetectable by any party. So it recommends:
breaking it does not *produce* a misreading, it raises the probability of one, and no verifier can
report it. NAME-7 binds because an unnamespaced name produces the collision directly and a verifier
can see the missing prefix. This is the same social contract Java packages have run on for twenty-
five years, and the sky has stayed up.

The form is lowercase, which matters more than it looks. DNS is case-insensitive, so `Example.com`
and `example.com` are one domain — but NAME-1 compares names byte for byte, so `com.Example.x` and
`com.example.x` would be two names for one thing, minted inside one team, with nothing to say they
were the same. Requiring one spelling closes a trap the two rules would otherwise open between
them.

NAME-9 is a different requirement and deliberately not the same rule. A Worker's id must be
*distinct*; it need not be *recognizable*, because no party ever has to arrive at one independently
— the Tower reads an id from a Descriptor and matches it against the id it recorded for that
enrollment, which is comparison for identity and not agreement on a vocabulary. So the mechanism is
free: a name under NAME-7's namespace satisfies NAME-9, and so does a random identifier with no
structure at all, and this protocol has no reason to prefer either. What it cannot survive is two
Workers sharing one, because DESC-27 makes the id the thing Contracts hang off and REG-13 makes it
the thing a Tower refuses to rebind — both undone at once if the id names two things. Forcing
reverse-DNS here instead would have forbidden a UUID, which solves the only problem there is.

## What this file deliberately does not fix

**A Capability a Worker defines itself needs no syntax beyond the dot, and this file adds none —
and the contrast with NAME-7 is the point rather than an inconsistency.** The two rules are the
same reasoning reaching opposite verdicts, because the names are read in different places. A Task
type is matched across Workers, so a collision between two teams is a merge somebody acts on. A
vendor Capability is never read outside the Descriptor that declared it, and DESC-15 is why: a
verifier *ignores* a dotted name it does not know. Two Workers that both declare `acme.billing`
have collided in no way anything can observe, because nothing ever puts the two documents side by
side. The reasoning that requires a namespace on the one excuses it on the other, and a reader who
takes either rule as a general preference about names has read both wrongly.

So DESC-14 stands exactly as it is. It makes a name containing a `.` the Worker's own and a name
without one reserved to the edition, and
[schemas/capability-name.json](../schemas/capability-name.json) and the vendor pattern beside it
already assert exactly that much — at least one dot, no empty segment, no whitespace. That is the
whole of what any reader needs, and requiring reverse-DNS there would be ceremony bought with
nothing, imposed on the one kind of name in this protocol that is genuinely private to the document
it appears in.

**How a Worker's id is spelled is not fixed either**, and NAME-9 is the whole of what this file
asks of it. DESC-6, DESC-27 and DESC-28 fix what matters — not the URL, not derived from it,
surviving a move, opaque, stable, unambiguous without ambient context — and every one of those is a
property of the id's *behaviour*, not of its characters. DESC-28's *unambiguous without ambient
context* is answered by NAME-9 and by nothing narrower: the scope may come from a namespace, from
randomness, or from anywhere else that makes two Workers' ids differ.

**An Action's name is local to the Worker that declares it**, and NAME-7 does not reach it. A
consumer learns which Action answers a Task from the Task itself, and posts it to an address that
same Descriptor gave; both the name and its meaning are resolved inside one document, and two
Workers declaring `record-verification` are never placed side by side. The same holds for a
metric. Whether *health check* names are shared across Workers is open in
[undecided](../docs/undecided.md), and if they come to be shared they become a fourth crossing name
and NAME-7 will reach them — by the test, without this file changing.

Nothing on the wire carries a name for the holder of a credential, so there is no such name for
this file to spell. [registration](registration.md) says what identifies a caller, and it is the
credential itself.

## The conventions this specification uses for the names it mints

**NAME-3 (recommended). This specification uses one spelling convention for each kind of name it
mints, and records it here. It imposes none on the names a Worker mints.**

| Kind | Convention | Where |
|---|---|---|
| A member of a schema in `schemas/` | `camelCase` | `nextCursor`, `capabilities` |
| An error code | lower `snake_case` | `unprocessable_content`, `idempotency_key_reused` |
| A reserved Capability name | lowercase, no separator | `health`, `metrics` |

What binds here is *one per kind*, not which one. A reader who has met `nextCursor` should not have
to check whether the next schema says `next_cursor`, and the cost of checking is paid on every
reading by every reader, which is why the consistency is worth recording at all. Which convention
each kind uses was decided by what was already dominant for that kind in JSON over HTTP, so a
reader meeting one of these for the first time guesses right — and that is the only defence any of
the three has.

**The argument this decision was originally made on does not survive being written down, and it is
worth retracting explicitly.** `camelCase` was settled while generating `schemas/` on the ground
that the Zod objects are the source and camelCase is what a TypeScript consumer reads without a
mapping layer. That is a convenience for one language, offered by a specification whose second
principle is that a worker built with none of this tooling — a cron job in Python over Postgres —
must be able to satisfy it completely. A Python implementer reading `nextCursor` gets a name that
fights their language's conventions, and the original argument says their inconvenience is worth
less than a TypeScript reader's. It is not. The decision stands on consistency, which is
language-neutral, and on nothing else.

It recommends rather than binds because no party misreads anything when it is broken. A member name
is read out of a schema, an error code out of a closed enumeration; nobody guesses either. A
specification that failed a Worker over the case of a letter would be enforcing taste, and this
file opened by saying it would not.

The second sentence of NAME-3 is the load-bearing one. A Worker's own Action payloads, its event
shapes and its Task payloads carry whatever member names that Worker likes. A console renders a
form from the schema it was given and a consumer validates against it; neither has an opinion, and
a Worker whose domain speaks `snake_case` should not have to translate its own vocabulary to be
legible here.

## An Alarm is neither a Task nor an Alert

**NAME-4 (required). A Worker waking itself at a future time to re-evaluate is an Alarm. It is not
a Task and it is not an Alert, and a Worker exposes one as neither.**

The three are told apart by who is being asked for something. A **Task** asks another party to do
something, is claimed under an exclusive lease, and names the Actions that may answer it. An
**Alert** asks an operator to look. An **Alarm** asks nobody for anything: the Worker set it, the
Worker will service it, and it is a private scheduling detail of how that Worker keeps its own
facts current.

Exposing one as a Task puts work in front of a consumer that cannot possibly do it — there is no
Action that answers *wake up and re-evaluate*, nothing for a lease to protect, and the Task's
condition is not a fact anybody outside the Worker can affect. A consumer that claims one holds a
lease on nothing and reports a failure it did not cause. Exposing one as an Alert is quieter and
worse: an operator's console fills with conditions that require nothing and clear themselves, and
the operator learns that this Worker's Alerts are noise, which is a lesson they will still have
learned on the day one of them is not.

This fence is written because the collision is live rather than hypothetical. Runtimes exist whose
own scheduling primitive carries this exact name, and a Worker built on one meets the word in its
own platform's documentation long before it meets this specification. Without a normative sentence
the distinction lives only in [the architecture](../docs/architecture.md), which binds nobody, and
the first implementer to reach for the nearest matching surface will reach for the wrong one in
good faith.

The rule forbids the *surface*, not the vocabulary. A Worker may call its timers alarms, tasks or
anything else in its own code and its own logs, and this protocol neither sees nor cares. What it
may not do is publish one where another party is entitled to read it as a request.

## When a declared schema changes

**NAME-5 (required). A change to a declared schema is compatible when every document the old schema
accepted the new one also accepts, and means the same thing by it. Any other change is breaking.**

**NAME-6 (required). Compatibility is judged in the direction the document travels: for a document
a Worker receives, against every sender built on the old schema; for one it sends, against every
reader built on the old schema.**

The second clause of NAME-5 is the one that earns it a rule. A purely structural test — does every
old document still validate — calls a change compatible when a field's units move from seconds to
milliseconds, when a status value keeps its spelling and changes its meaning, or when a list that
was ordered stops being. Every consumer breaks, none of them fails validation, and the failure
arrives as wrong numbers rather than as an error. A definition of compatibility that a machine can
check completely would be a definition that misses exactly the changes worth catching, and it is
better to state the obligation honestly and admit that part of it needs a person.

NAME-6 exists because the same edit has opposite verdicts in the two directions, and stating the
rule about the *edit* is therefore impossible. Adding an optional member to something a Worker
sends is compatible, because a reader built on the old schema can ignore it — where the schema lets
it. Adding a required member to something a Worker receives is breaking, because every sender built
on the old schema omits it. One sentence about "adding a member" would be wrong half the time.

Whether a reader actually *can* ignore an added member is not this file's to say — it is decided by
whether the schema in question is closed, and `schemas/` decides that per document. That is why
this file states the test and not the verdict: the same protocol has both closed documents and open
ones, deliberately, and each says which it is.

**How long a Worker answers a superseded schema has an answer, and it is not a duration.** This
file once listed it as blocked for a mechanical reason — DESC-22 keys Capabilities by name, so a
Worker had nowhere to say *I also still answer the previous one*. descriptor.md has since settled
that a Capability is declared once and explained why the second entry was the wrong instrument:
what a consumer actually holds is an Action or a Task type, not a Capability surface, and NAME-2
makes a payload that changed breakingly a different thing, which under NAME-7 is a different name.
So an owner keeps an old consumer working by declaring **both names at once**, each with its own
schema, and the old one leaving the Descriptor is the announcement that it is gone. There is now
somewhere to declare it, and it was never the Capability entry.

*How long* the old name stays is then the owner's, and this protocol does not state a number for
the same reason [health](health.md) states no poll cadence: it would be a figure every deployment
was measured against, invented by somebody who had seen none of them. What the protocol owes is
that the window is *visible* — both names are in the Descriptor while both are answered — and that
is already true.

What a breaking change then costs is already fixed elsewhere and is not repeated here. DESC-9 makes
a Capability's version a single integer and DESC-29 makes it count breaking changes to that
Capability, so the number moving *is* the announcement. ENDP-5 puts that version on every response,
and ENDP-6 lets a caller state the version it expects and be refused whole rather than guessed at. A
consumer therefore discovers a breaking change on its next call, loudly, with a `400` that names the
version — which is the discovery this protocol is built to deliver, and it needs nothing from this
file.

**Whether anyone is told *proactively* when a breaking change lands under a Contract already
granted was open, and is not any more.** It was parked until [alerts](alerts.md) was written,
because a notification needs somewhere to arrive and that file was where it would be. It is not: an
Alert is read by whoever operates a Worker, and a consumer under a Contract is not that party and
may hold no credential for the address at all. So the loud discovery described above is the whole
of it. The Contract's own contents are open in [undecided](../docs/undecided.md) besides.

## Still open here
- Whether a name carries a length bound. Nothing here needs one, and every bound anyone proposed
  would be arbitrary; it is listed only so that its absence is visibly a decision.

## Withdrawn

Nothing yet.

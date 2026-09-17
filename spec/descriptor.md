# Descriptor

`draft`

The document a Worker serves at a route this spec fixes, and the first thing anyone reads about
it: the Worker's own id, distinct from where it lives; the Capabilities it implements, each with
the schemas it answers with and, where it answers over HTTP, the address it answers at; the edition
of this protocol it speaks, and a version per Capability. The Control Tower's registry is read from
here, and the Tower keeps a dated copy of the last one it saw.

Its shape is [schemas/descriptor.json](../schemas/descriptor.json), and one entry of its Capability
list is [schemas/capability-entry.json](../schemas/capability-entry.json). What follows is what no
schema can state. Rules carry ids; the convention is in [spec/README.md](README.md).

## The floor

**DESC-1 (required). Every Worker serves a Descriptor, and that is the whole of what every Worker
owes.**

**DESC-2 (required). Capabilities are declared or left out freely, in any combination including
none, and no Capability is a precondition of another.** A Worker that raises no Tasks declares no
`tasks`, a Worker that only ever answers people declares no `events`, and a Worker that declares an
empty list is conformant and does nothing. There is no half a Worker must implement in order to be
one. Conformance is a statement about whether a Worker can be read and believed, never about
whether it is worth enrolling.

That settles what stands for a liveness probe when a Worker declares no `health`: the Descriptor
route itself. The Tower fetches it on a schedule anyway, because the dated copy its registry is
made of has to come from somewhere; a fetch that fails is the same fact a failed health poll would
have been, arriving by the same means. `health` says how a Worker is doing, which is a different
and better question, and a Tower is free to refuse to enroll a Worker that does not answer it —
but that is one Tower's policy, not this protocol's floor. Making it a condition of conformance
would disqualify a Worker that usefully declares only `actions`: a thin proxy in front of a system
that cannot speak this protocol, whose whole job is to accept an operation and pass it on. Such a
Worker has no dependency of its own worth reporting on, and requiring it to invent one buys a
poller nothing it could not already learn by fetching the Descriptor.

## The route

**DESC-3 (required). A Worker is enrolled as a base URL — one absolute `https` URL, with or without
a path — and serves its Descriptor at `.well-known/worker-protocol` beneath it.**

**DESC-26 (required). Every Descriptor a Worker serves is the Descriptor at DESC-3's route. A
Worker serves no second Descriptor that differs from it, at any address.**

**DESC-5 (required). Reading a Descriptor is a GET and changes nothing.**

An operator who enrolls `https://example.com` is read at
`https://example.com/.well-known/worker-protocol`; one who enrolls `https://example.com/fleet/` is
read at `https://example.com/fleet/.well-known/worker-protocol`.

A Worker that owns the root of its origin therefore serves the well-known URI of RFC 8615
unchanged, and is discoverable from a bare hostname. One mounted under a path does not, and is
found only from the base URL an operator recorded. That is the deliberate trade: reserving the
origin root would forbid a Worker from living beside an application that already owns it, and the
Workers that most need to live beside one are the Workers people use.

DESC-26 forbids a second Descriptor and not a second address, and the difference is the whole of
what the rule is for. A Worker reachable at a vanity hostname and at the address behind a load
balancer serves the same document at both, and nobody is confused: DESC-6 makes the id the Worker's
identity, so two addresses answering with one id are one Worker seen twice. What cannot be allowed
is a second document — an older copy left at a path somebody forgot, a hand-written one beside the
generated one — because then two readers hold two answers to the same question and nothing says
which is the Worker's. The earlier form of this rule forbade the address rather than the
divergence, which cost a Worker its aliases and bought nothing; it is withdrawn below.

The scheme is `https` and not a preference. A credential travels in a header on every one of these
calls, by [registration](registration.md), and a bearer token read off the wire is the whole of the
access it grants — there is nothing to replay-protect it and nothing to bind it to a request. A
Worker reachable over plaintext has published its Tower's credential to the path between them.

DESC-5 fixes the verb for the same reason ENDP-2 fixes it everywhere else, and
[endpoints](endpoints.md) makes that argument at length: a document a console, a verifier and a
curious operator can all be pointed at on the same afternoon is a different thing from one that
must be requested.

This is the only route this protocol fixes. Every other address is declared, so the question of a
fixed prefix does not arise — see [endpoints](endpoints.md).

What credential the reader presents, and what an unrecognized reader is shown, belong to
[registration](registration.md); this file assumes only that the Tower can read the Descriptor with
the credential its operator was given at enrollment, because the registry is derived from it and
there is no other source.

## Identity

**DESC-6 (required). The Worker's id is opaque and stable: it identifies this Worker and no other,
carries whatever scope it needs to be unambiguous, is not the URL and is not derived from the URL,
and survives a move.**

A Worker that changes host keeps its id and keeps its Contracts. Nothing outside the Descriptor
supplies context that the id needs in order to mean something: a reader holding the id alone, with
no knowledge of the deployment it came from, still knows which Worker is meant. An id that is a
path through a Worker's own internals, or that is only unique within a deployment the reader cannot
name, is not an id.

*Not derived from the URL* is the clause that does the work, and it is drawn at derivation rather
than at appearance because derivation is the mechanism that breaks the rest of the rule. An id
computed from the address — a slug of the hostname, a hash of the base URL, anything read out of
configuration at boot — is an id that is computed again the next time the Worker starts, and a
Worker that moved starts with a different one. It does not survive the move, and nothing announces
that it did not: the Descriptor answers cleanly at the new address with an id the Tower has never
seen, and REG-13 correctly refuses to treat it as the same Worker. The Contracts that DESC-6
promises would survive are then attached to an id nobody serves. A rule drawn at *looks like a URL*
would catch the slug and miss the hash, which is the case that fails silently; drawn at derivation
it catches the mechanism, and the implementer is the one party who knows which it used.

How ids are spelled, whether they are namespaced, and whether a retired one may be reused, are
[naming](naming.md)'s. What the Tower does when the Descriptor at an enrolled URL answers with an
id it has not seen before is [registration](registration.md)'s.

## Two versions

**DESC-23 (required). A Descriptor carries exactly one edition: the version of this specification
the Worker speaks, written `MAJOR.MINOR`. Editions are ordered, by comparing MAJOR and then MINOR
as numbers.**

**DESC-8 (required). The Capability names an edition may contain are the enumeration in
[schemas/capability-name.json](../schemas/capability-name.json), which is normative and is the list
a verifier checks against.**

**DESC-24 (required). A MAJOR bump changes what a reader cannot survive not knowing. A MINOR bump
only adds what a reader holding an earlier MINOR of the same MAJOR may ignore and still be
correct.**

**DESC-9 (required). A Capability version is a single integer, counting breaking changes to that
Capability alone. There is no minor version.**

The edition is what gets cited — *this Worker speaks worker-protocol 0.1* — and it is what lets a
new Capability exist at all, because the closed list of Capability names is a property of an
edition and not of the protocol forever. Prose does not repeat that list; the table in
[spec/README.md](README.md) is a reading aid and the schema wins.

*Exactly one* is what makes DESC-25 decidable. A verifier compares the edition it holds against the
edition the Worker declares and reports itself older or not; given two declared editions there is
no *the* edition to compare against, and a Worker could always avoid the verdict by declaring one
edition the verifier holds beside one it does not. A Worker that wants to serve two editions serves
two Descriptors, which is to say it is two Workers with two ids — and that is the honest shape,
because a Contract is made over a declaration and there would otherwise be no saying which.

Editions are ordered because DESC-25 spends the ordering: a verifier that meets an edition it does
not hold reports that it is *older than the Worker*, and there is no way to say "older" about two
values that cannot be compared. The alternative was to let a verifier report only that it did not
recognize the edition, and that loses a diagnostic worth keeping — knowing the verifier is behind
tells an operator to upgrade the verifier, where an unrecognized token leaves the Worker under
suspicion for what is the reader's problem.

DESC-24 is what makes that diagnostic *actionable* rather than merely true. An order alone tells a
reader which of two editions is newer; it does not tell it whether it can still talk. With the
meaning attached, the two components answer different questions: MAJOR asks *can I read this at
all*, MINOR asks *am I seeing everything*. A reader behind on MINOR is not broken, only partial,
and knows which of the two it is.

This is deliberately the same shape as the dotted and undotted Capability names. There, a name a
reader does not recognize is either safely ignorable or a failure, and the dot is what tells the
two apart without a registry. Here, MAJOR and MINOR do that for the specification itself. In both
places the reader can act on what it does not understand, which is the only way a protocol grows
without every reader upgrading at once.

**The shape is two components on purpose, and it is not SemVer.** A PATCH would have to be a change
that by construction never alters a verdict — and this repository already has a test for exactly
that, in the rule ids: a rewrite that cannot change a verdict keeps its id and is not a version
event at all. A third component would name the one kind of change that needs no name. Two also
keeps the edition beside DESC-9's Capability version, which is a single integer for a related
reason; a three-component edition sitting next to a bare integer would be the larger inconsistency.

`health` can freeze at 1 while `events` moves to 3, which is the grain at which each file here
already carries its own maturity marker. There is no minor version on purpose: the only decision a
reader makes from this number is whether it can talk to this surface at all, and a change that does
not force that decision is a change a reader can discover by looking and is not worth announcing.

Editions and Capability versions move independently. A Worker speaking a newer edition may declare
a Capability at the same version an older edition defined; a reader that knows the edition and the
version knows the surface.

## Capability entries and their addresses

**DESC-22 (required). Capabilities are declared as a map keyed by Capability name, so a Capability
is declared at most once. Each entry carries that Capability's version. An address is optional in
this shared entry and required by each Capability's own file: every Capability answered over HTTP
requires one, and `events`, which is answered over a broker, does not.**

**DESC-11 (required). Where a Capability's behavior on a call is conditional, the condition is
declared in its entry.**

**DESC-12 (required). An address is an absolute `https` URL, or a relative reference resolved
against the URL the Descriptor was read from. It may point away from the origin that served the
Descriptor.**

**DESC-13 (required). A client does not present a credential it was granted for this Worker to an
address on an origin the operator did not record as the Worker's own.**

A map rather than a list, because the alternative could not keep the promise this file makes. The
question of declaring one Capability twice is [open](../docs/undecided.md), and until it is
answered the shape forbids it — but a list of entries cannot express that. JSON Schema compares
whole items for uniqueness, so two entries named `health` at two addresses are distinct items and
validate cleanly. Keyed by name, the constraint costs nothing and is structural: there is nowhere
to put the second one.

The address is optional here and nowhere else. `events` is the reason: what a Worker declares for
it is the broker it publishes to, and the protocol deliberately names no broker and gives it no
HTTP surface to answer at. Requiring an address of every Capability would have forced that entry to
carry a URL that does not exist. The obligation is not softened, only moved — each Capability's own
file says whether its entry requires an address, and every Capability answered over HTTP does.

What else an entry carries is the business of that same file — which Actions a Worker accepts,
which indicators it publishes, which Task types it answers, which events it publishes and to which
broker — and each of those files extends
[schemas/capability-entry.json](../schemas/capability-entry.json) with what its own surface needs.
This file fixes only the envelope they share.

An Action that requires an idempotency key is the first case of DESC-11: it declares that in its
entry, together with where the key is read from and how long the Worker honors one; see
[endpoints](endpoints.md) for what those mean on a call and [actions](actions.md) for the shape of
the declaration. The reason it lives in the Descriptor and not in a response is the order of
events: a caller decides whether it can retry safely *before* it sends anything, and a caller that
had to learn the answer from a reply has already sent the request it was trying to protect.

An address may point away because a Worker whose Tasks are held by one deployment and whose health
is answered by another is a placement decision, and this protocol cannot see the difference. The
rule about credentials is what that costs. A Descriptor is a document a Worker controls, and an
address in it is an instruction to send a request somewhere; without DESC-13, a Worker that
declares an address at somebody else's origin has arranged for the Tower to hand that somebody a
credential. Which origins count as a Worker's own, and how an operator records a second one, are
[registration](registration.md)'s to say. A client that reaches an address it may not authenticate
against reads it unauthenticated or not at all, and reports the entry as unverifiable rather than
failing quietly.

## A Capability a Worker defines itself

**DESC-14 (required). A Capability name that contains a `.` is the Worker's own and is never
defined by this specification. A name with no `.` is reserved: it is defined by the edition the
Descriptor declares, or it is nothing.**

That rule is all a verifier needs, and it needs no registry:

- **DESC-15 (required). A verifier ignores a dotted name it does not know, and reports it as
  ignored.**
- **DESC-16 (required). A verifier fails a Worker for an undotted name it does not know, when it
  knows the declared edition:** the Descriptor claims a Capability that edition does not define.
- **DESC-25 (required). A verifier that does not hold the declared edition's MAJOR verifies
  nothing, and reports that it is older than the Worker. One that holds the MAJOR but not that
  MINOR verifies what the edition it does hold defines, ignores every undotted name that edition
  does not name, and reports what it ignored** — rather than failing a Worker for a Capability
  added after the verifier was built.

DESC-16 and DESC-25 divide cleanly because DESC-16 fires only when the verifier holds the declared
edition exactly. A verifier one MINOR behind does not, so it never fails a Worker for a name it
could not have heard of; a verifier holding the edition does, and an undotted name that edition
does not define is then a real fault with nowhere to hide. The two together are why an older
verifier is useful rather than merely safe: it still checks everything it knows.

What a dotted name may look like, and how two teams avoid colliding inside that space, are
[naming](naming.md)'s.

## When the Descriptor and the Worker disagree

**DESC-18 (required). A Descriptor that declares a Capability the Worker does not serve is a fault
in the Descriptor, not in the surface.**

It is read that way by all three readers:

- **DESC-19 (required). A verifier reports the discrepancy against the Descriptor and fails the
  Worker.** It does not report the Capability as absent, because the Worker said it was there; the
  discrepancy is the finding.
- **DESC-20 (required). The Tower catalogs what the Descriptor declared, records that the address
  did not answer and when, and does not drop the entry.** A registry that silently omits what a
  Worker claims leaves the Worker's claim and the catalog disagreeing with nothing written down,
  and an operator looking at a Capability missing from the console cannot tell whether it was never
  declared or quietly discarded.
- **DESC-21 (required). A consumer that meets a declared surface answering `404` stops, and does
  not retry.** It is a contract error, and [endpoints](endpoints.md) says why at length. A consumer
  that treats a missing declared surface as a transient failure retries against a Worker that will
  never answer, and the mistake surfaces as slow silence instead of a refusal.

DESC-20 binds, and it is worth saying why, because it is the rule most easily mistaken for advice
about a console. Nothing on a *call* turns on it — a Tower that drops the entry breaks no request
between a consumer and this Worker. But the party it fails is the operator, and the operator is the
party this whole specification exists for: someone who must see, operate and give work to Workers
they did not build. The catalog is the surface they see, and a catalog that quietly omits an entry
tells them the Worker was never enrolled. Something was produced and a party read it wrongly, which
is the same fault DESC-21 describes and not a different kind of thing. That the Control Tower is
named and defined in these files is what gives this specification the standing to require it.

The converse is not a fault. A Worker serves whatever else it likes at whatever address it likes,
and this protocol has no opinion about it — but nothing undeclared is visible: no console renders
it, no catalog holds it, and no Contract can be made over it.

## Still open here

- **Whether a Worker may declare the same Capability twice, at two addresses and two versions**, so
  that a consumer built against an older one keeps working while a newer one exists. Nothing needs
  it yet, and the schema forbids it until something does. Open in
  [undecided](../docs/undecided.md).
- What a Descriptor says about a Capability that exists but is temporarily not answering — a
  degraded surface as against an undeclared one. Today that is `health`'s to report and the
  Descriptor does not express it.

## Withdrawn

- **DESC-7** — required that a Descriptor carry exactly one edition, without saying what an edition
  is as a value. Replaced by **DESC-23**, which gives it the form `MAJOR.MINOR` and an ordering.
  An edition of `banana` satisfied DESC-7 and does not satisfy DESC-23, so the rewrite could change
  a verdict and took a new id.
- **DESC-17** — required that a verifier which does not know the declared edition verify nothing
  and report itself older than the Worker. Replaced by **DESC-25**, which scopes that to the
  edition's MAJOR and has a verifier one MINOR behind check what it does hold. DESC-24 is what
  broke it: once a MINOR bump is defined as safely ignorable, a verifier that refused to check
  anything against a Worker one MINOR ahead was discarding work it was capable of, and a Worker
  that went unverified under DESC-17 can now be verified and can now fail. The verdict moves, so
  the id did not survive.
- **DESC-4** — required that a Worker serve its Descriptor at no other address. Replaced by
  **DESC-26**, which forbids a second *Descriptor* rather than a second address: the argument
  beneath it was always about two documents disagreeing, and a Worker reachable under an alias
  serves one document at two addresses and disagrees with nothing. A Worker that answers the same
  Descriptor at a second hostname failed DESC-4 and satisfies DESC-26, so the rewrite widens what
  is allowed and the id did not survive.
- **DESC-10** — required that each entry in the Capability list name the Capability, its version
  and the address it answers at. Replaced by **DESC-22**, which keys the entries by name instead of
  naming the Capability inside each, and makes the address optional in the shared entry. A
  Descriptor conformant under one is not a document the other accepts, so the id did not survive.

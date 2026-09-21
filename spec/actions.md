# Actions

`draft`

How a Worker declares the operations it accepts, and how somebody performs one. An Action is
published with a schema and is the only way to act on a Worker that this protocol sees; what else a
Worker serves is its own business.

This is the half of *operate* that does something. [health](health.md) says whether a Worker works
and [metrics](metrics.md) says what it did, and both are read; an operator who can only read is
watching rather than operating. It is also the first surface here that changes state, so ENDP-3 has
something to be about and REG-31 has an address to recommend a credential on.

The declaration is [schemas/actions-entry.json](../schemas/actions-entry.json) and one Action's is
[schemas/action-declaration.json](../schemas/action-declaration.json). What follows is what no
schema can state. Rules carry ids and a class; the convention is in [spec/README.md](README.md).

## What a Worker declares

**ACT-16 (required). An `actions` entry declares an address, and declares under `accepts` every
Action the Worker accepts, keyed by name. The Descriptor is the catalog: this surface performs and
never lists what exists.**

**ACT-2 (required). Each Action declares the JSON Schema of its input.**

**ACT-3 (required). Each Action declares what it answers on success: nothing, or the JSON Schema of
a result.**

**ACT-4 (required). Each Action declares whether it completes within the call.**

ACT-16 is the same division the rest of this protocol already makes, and it is made for the third
time here because it keeps earning it: everything anyone knows about a Worker before calling it is
read from the Descriptor, so a console renders a form and decides whether to offer a button before
it sends anything. A surface that also listed its Actions would be a second catalog to keep in step
with the first, and the two would disagree on the day a deployment was half finished.

**ACT-2 is what the whole of this file is for.** A console renders a form from a schema it did not
author and posts the result to an address it does not understand; so does a teams app, and so does
any consumer acting under a Contract. None of them can be told what an operation needs in prose,
because none of them reads prose. The schema is the Worker's own — this protocol has no data model
and [naming](naming.md) leaves a Worker's member names alone — and what it buys is that an operator
who never met this Worker can still act on it correctly.

ACT-3 and ACT-4 are declared rather than discovered for the same reason ENDP-15 has the idempotency
declaration live in the Descriptor: **the order of events**. A caller decides whether it can wait,
whether it has somewhere to put a result, and whether a retry is safe *before* it sends anything. A
caller that had to learn any of those from a reply has already sent the request it was reasoning
about.

An Action's name is the Worker's own, and [naming](naming.md) says why NAME-7 does not reach it: a
consumer learns which Action answers from the Descriptor that declared it, and two Workers both
declaring `record-verification` are never placed side by side. The one exception is ACT-13's
reserved name.

## Performing one

**ACT-5 (required). An Action is performed by POSTing to the address its entry declares, naming the
Action in the `action` query parameter. The body is the input and carries nothing else.**

**ACT-6 (required). An Action the entry does not declare is `404`, with the code `not_found`.**

**ACT-7 (required). A request that names no Action is `400`, with the code `invalid_parameter`.**

The shape is the one [metrics](metrics.md) already uses: one declared address, and a parameter
naming what is being asked for there. It is chosen over the two alternatives for reasons worth
writing down, because the obvious one is wrong.

*An address per Action* reads well and breaks ENDP-1's promise in practice rather than in principle:
a Worker with forty Actions publishes forty addresses in a document every party parses before it can
do anything, and a console that wants to know whether this Worker accepts anything at all has to
walk them. Keeping the Capability's address singular keeps the Descriptor the size of what a Worker
*offers* rather than the size of its API.

*A path segment appended to the address* is the one that must not be allowed. ENDP-1 says every
address is declared and that no reader assembles one, and its whole argument is that a reader
holding a document listing every address has no use for a rule that would let it guess one. A caller
that concatenates a name onto a base has guessed, and the day a Worker percent-encodes differently
from the console is the day the guess is wrong in a way nobody can see.

**The body carries nothing else, and that clause is load-bearing.** It means a console POSTs the
form result verbatim, and a Worker validates the body directly against the schema it published, with
no envelope to unwrap on either side. An envelope of `{ action, input }` would have put this
protocol's vocabulary inside a document the Worker owns, and ENDP-17 — which compares one body
against another under the same idempotency key — would have been comparing a shape this
specification invented rather than the one the Action declared.

ACT-6 and ACT-7 divide by which side is wrong about what, exactly as MET-9 and MET-10 do. An Action
that is not declared is a resource that does not exist. A request naming none has not said what it
wants, which is a parameter fault and nothing to do with whether the Worker could have done it.

**The caller names the Action, and that settles a question this repository listed as open.** The
alternative was that a consumer posts a *fact* and the owner maps it to an operation, which is more
decoupled and was never free: it requires a vocabulary of facts that both parties share, which is a
second declared thing, minted by somebody, compared across Workers — so NAME-7 would reach it, and
this protocol would be running a registry of fact types it has spent five files refusing to create.
Naming the Action costs a consumer one string it read out of the Descriptor. Where an owner
genuinely wants the indirection it can declare an Action that takes a fact, which is the decoupled
design available to anyone who wants it and imposed on nobody.

## What a performance answers

**ACT-8 (required). An input that does not match the Action's declared schema is `400`, with the
code `schema_mismatch`.**

**ACT-9 (required). An input that matches the schema and that the Worker will not accept on its own
rules is `422`, with the code `unprocessable_content`.**

**ACT-10 (required). An Action that completes within the call answers `200` with its declared
result, or `204` where it declares none.**

**ACT-11 (required). An Action that declares it does not complete within the call answers `202`
with no body.**

ACT-8 and ACT-9 are ENDP-12 with the two cases named. *I cannot read this* and *I read it and I
will not have it* are fixed by looking at two different things — a serializer and a payload — and
collapsing them makes both look like the other. An Action is where that distinction finally has a
body to be about.

`schema_mismatch` is a new code, and [endpoints](endpoints.md) already priced one: closing the
vocabulary means a new code requires a new edition, and this is the file that spends it. It is not
`malformed_request`, which names a body that will not parse at all, and the difference is what a
caller does next. A body that will not parse is a serializer bug in the caller. A body that parses
and does not match is a caller built against a declaration that has since changed — it re-reads the
Descriptor, which is where the answer is, and ENDP-5's headers already told it the version moved.
One code for both would have sent every caller to the wrong half of its own code.

ENDP-29 leaves the status of a success open and says so, and this is the file it left it open for.
`200` and `204` are drawn at whether the Action declared a result, so a caller knows which to expect
before it calls and a console knows whether it has anything to render. `201` is deliberately absent:
this protocol has no resources a caller addresses afterwards, so a `Location` would point at
something nothing here defines.

**ACT-11 is the smallest honest answer to a question this file cannot yet finish.** A Worker whose
operation outlives the call says so in its declaration and answers `202`, and that is the whole of
what this edition defines: the caller knows it was accepted, and knows it will not learn the outcome
here. How the outcome arrives — an event, a Task, a Worker the caller polls — is not something this
file can settle alone, because every candidate is a surface another file owns: an event is
[events](events.md)'s, a Task is [tasks](tasks.md)'s, and a resource to poll
is nothing this protocol defines yet. Saying `202` and stopping is better than inventing a
mechanism those files would then have to live with, and it is listed below so that the gap is a
decision rather than an omission.

## Saying it is the same call again

**ACT-12 (required). The declaration ENDP-15 requires is carried in the Action's entry: whether a
key is required, where the Worker reads it from — the `Idempotency-Key` header or a named member of
the input — and how long the Worker honors one.**

This is DESC-11's first case, which [descriptor](descriptor.md) promised and could not give a shape
to until this file existed. What those declarations mean on a call is
[endpoints](endpoints.md)'s — ENDP-16 makes a repeat under the same key answer the recorded outcome,
ENDP-17 makes a key reused with a different body `409`, ENDP-18 makes a required key absent `400` —
and nothing about them is restated here.

Reading the key from a named member of the input is what makes this worth a declaration rather than
a fixed header. A Worker taking readings keyed by vehicle, kind and instant already holds the key in
the body, and asking a caller to invent a second one beside it is ceremony that buys nothing and
adds a way to get it wrong. Whether such a key is scoped to the caller that presented it or is
global to the Action is [open](../docs/undecided.md), and it is `endpoints`'s to answer.

## Settings, and the form a console renders

**ACT-13 (required). `configure` is an Action name this edition reserves. A Worker that declares it
means the Action this file defines; a Worker that accepts no settings does not declare it.**

**ACT-14 (required). The input of `configure` is the Worker's complete settings document, and a
performance replaces what the Worker holds. This edition defines no partial update.**

**ACT-15 (required). A Worker that declares `configure` declares a reading address for it, and a
GET of that address answers a document its own `configure` would accept.**

Every other Action name is the Worker's own; this one is reserved for the same reason the undotted
Capability names of DESC-14 are. A console that can show *this Worker's settings* for a
Worker nobody told it about needs one name to look for, and a name a console matches against a name
that came from elsewhere is exactly what a reserved word is for. Unlike DESC-14 there is no syntax
to draw the line with, because Action names are never compared between Workers and need none: the
reserved list is short, it is this edition's, and a Worker that wanted `configure` for something
else has one word to avoid.

ACT-14 replaces rather than merges, and the reason is the console rather than the Worker. ACT-15
hands a console the current document, the console renders a form from the schema and fills it, and
the operator posts the whole thing back — so replacement is what actually happens on the wire
whatever the protocol says, and a merge semantics would mean two callers with two mental models of
the same POST. A partial update is a real want and it is a different operation: a Worker that needs
one declares an Action for it, under its own name, with a schema saying which parts it takes.

ACT-15 is what makes `configure` usable rather than merely postable. Without it a console renders an
empty form, an operator fills in the fields they remember, and everything they did not remember is
replaced with whatever the schema's defaults are — which is data loss performed by a well-meaning
person through a surface this protocol published. The reading address is separate from the entry's
posting address because ENDP-2 and ENDP-3 draw that line everywhere else: reading is a GET and it
changes nothing.

What a setting *is* stays outside. Nothing here says a setting exists, what a Worker keeps in one,
or that one bears on anything else it publishes — [metrics](metrics.md) says as much from the other
side. The schema is the Worker's; this file fixes only that there is one, that it can be read, and
that writing it is an Action like any other.

## Still open here

- **How the outcome of an Action that answered `202` reaches anyone.** It was left open because
  every candidate lived in a file that was not written; all of them are now, and none of them took
  it. [events](events.md) publishes Facts with no addressee, so a caller waiting on one particular
  outcome is not who an event is for. [tasks](tasks.md) inverts the direction
  — a Task is work an owner offers, not a result it owes a caller. So the question survives the
  reason it was parked for, and ACT-11 still defines nothing rather than inventing a fourth.
- Whether an Action may be declared with no input at all, or whether the empty object is the
  spelling for that. The schema admits both today and nothing depends on which.
- Whether this edition reserves any Action name other than `configure`.

## Withdrawn

- **ACT-1** — required the same entry, with the Actions keyed by name under `actions`. Replaced by
  **ACT-16**, which puts them under `accepts`. A Descriptor written against ACT-1 fails ACT-16 and
  the other way round, so the verdict moves and the id did not survive.

  The old name was the Capability's name repeated one level down, which reads as a container rather
  than as a claim: `actions.actions` says *these are the actions* twice and says nothing about what
  the Worker does with them. `accepts` is the verb ACT-1's own sentence already used, and it is the
  one a reader wants at that exact point — a Descriptor's whole job is to say what may be sent
  here, and [events](events.md) and [metrics](metrics.md) publish where this one accepts.

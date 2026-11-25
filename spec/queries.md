# Queries

`draft`

How a Worker declares the reads it answers that this protocol does not define, and how somebody
reads one. A Query is published with the schema of its parameters and of what it answers, is a GET,
and changes nothing.

## Why this file exists

Everything a Worker could be *read* for was, until this file, something this protocol had already
named: its [health](health.md), its [metrics](metrics.md), its [Alerts](alerts.md), its
[activity](activity.md), its [logs](logs.md), its [Tasks](tasks.md). Everything a Worker defined
*itself* was an [Action](actions.md) — and an Action is the half of *operate* that does something.
A Worker with a Fact of its own that somebody else needs to read had nowhere to put it.

The case that forced the question is ordinary. A Worker tracks a fleet and publishes an event each
time a vehicle starts or stops moving. A consumer that must tell a store its delivery is twenty
minutes away needs to know where each vehicle is *now*, between two of those events — a Fact the
Worker holds, that no event carries and no metric is. There were three places to put that read, and
each was wrong:

- **As an Action.** It would have worked on the wire and lied in the Descriptor. An Action is what
  a console renders as a button and an operator presses to make something happen; every reader of
  `accepts` is entitled to assume that performing one changes something, and ACT-22, ENDP-16 and
  the whole of idempotency exist because it does. A read published there makes each of those
  readers wrong about one entry, and nothing in the entry says which.
- **As a Capability of the Worker's own.** DESC-14 lets a Worker declare one under a dotted name,
  and promises exactly one thing about it: that a verifier will ignore it. Nothing says what it
  takes, what it answers, or how it is called, so a caller learns all three from somewhere other
  than the Descriptor — which is the thing this protocol exists to prevent.
- **As an event, published on a timer.** That turns a question one consumer asks now and then into
  a stream every subscriber stores, and makes the Worker decide how often everybody needs to know.

So this file is the missing half of the pair. An Action is an operation a Worker defines; a Query
is a read a Worker defines. They are declared the same way, for the same reason, and they are kept
apart by the one difference that matters to every reader: **one may be sent again without a
thought, and the other may not.**

The declaration is [schemas/queries-entry.json](../schemas/queries-entry.json) and one Query's is
[schemas/query-declaration.json](../schemas/query-declaration.json). What follows is what no schema
can state. Rules carry ids and a class; the convention is in [spec/README.md](README.md).

## What a Worker declares

**QRY-1 (required). A `queries` entry declares an address, and declares under `answers` every Query
the Worker answers, keyed by name. The Descriptor is the catalog: this surface answers and never
lists what exists.**

**QRY-2 (required). Each Query declares the JSON Schema of its parameters: an object, each of whose
members is a string.**

**QRY-3 (required). A Query declares no parameter named `query` or `cursor`.**

**QRY-4 (required). Each Query declares what it answers, as exactly one of two: under `result`, the
JSON Schema of one document; or under `items`, the JSON Schema of one item of a collection.**

QRY-1 is ACT-16 for the other half, and it is the division this protocol makes everywhere:
everything anyone knows about a Worker before calling it is read from the Descriptor. A console
decides whether there is anything to show, and renders the form that asks for it, before it sends
anything; a consumer under a Contract knows what it will receive before it writes the code that
reads it.

**QRY-2 says strings because a URL carries nothing else.** The parameters of a GET travel in its
query string, where `7` and `"7"` are the same four bytes and `true` is a word. A schema that
declared an integer there would have two readings — the Worker's, which parsed it, and the
caller's, which has to guess how — and the declaration would be the one place they could not
settle it. So a parameter is a string, and the schema narrows it with what JSON Schema already has
for strings: an `enum`, a `pattern`, a `format`. An instant is a string with a format, as it is
everywhere else in this protocol. A Query that takes no parameters declares an object with no
members, which is what *none* looks like in a schema.

It is also why a parameter is not a list, and why there is no body. A read whose input does not fit
in a URL is asking for a selection the caller could make itself from a wider answer, and paging
(QRY-9) is what makes the wider answer affordable. Where the input really is a document — a search
over a structure, a computation over something the caller sends — it is not this file's read, and
`Still open here` says what is not yet decided about it.

QRY-3 is TASK-46 again. `query` names which Query is read and `cursor` walks a collection, on the
same address and in the same query string as the Query's own parameters; a Query that declared
either would have made one request mean two things.

**QRY-4 draws one line, and it is the one ENDP-20 already drew.** A read answers one thing or a
list of things, and a list here is always the shared page envelope. Declaring which — and never
both, and never a list tucked inside a `result` to avoid the envelope — is what lets one client page
through a Worker's own collections exactly as it pages through its Tasks, without being told how.

A Query's name is the Worker's own, as an Action's is, and NAME-7 does not reach it for the same
reason: a caller learns which Query answers from the Descriptor that declared it, and two Workers
that both declare `positions` are never placed side by side.

## Reading one

**QRY-5 (required). A Query is read by a GET of the address its entry declares, naming the Query in
the `query` parameter. Each parameter the Query declares travels as a query parameter of the same
name, at most once.**

**QRY-6 (required). A Query the entry does not declare is `404`, with the code `not_found`.**

**QRY-7 (required). A request that names no Query is `400`, with the code `invalid_parameter`.**

**QRY-8 (required). Parameters that do not match the Query's declared schema are `400`, with the
code `invalid_parameter`: one it requires that is absent, one whose value it refuses, one sent more
than once.**

One address and a parameter naming what is asked for there is the shape [metrics](metrics.md) and
[actions](actions.md) already have, and the argument is in [actions](actions.md) and is not
repeated: an address per Query makes the Descriptor the size of a Worker's API, and a name appended
to a path is an address somebody assembled, which ENDP-1 exists to forbid.

QRY-6 and QRY-7 divide as ACT-6 and ACT-7 do, by which side is wrong about what. A Query that is
not declared is a resource that does not exist; a request naming none has not said what it wants.

**QRY-8 stops where ENDP-24 begins, and the two are not the same fault.** A parameter the Query
declares, sent wrongly, is a caller that knows the Query and filled it in badly:
`invalid_parameter`. A parameter the Query does not declare is ENDP-24's — `unknown_filter`, and
never ignored — because a filter dropped in silence answers more than was asked for in a shape the
caller will happily parse. That rule already binds every address that takes parameters, so it is
cited here and not restated.

**What a Query may do is ENDP-2's, and nothing here adds to it.** A GET changes nothing a later
reader could observe, so a Worker declares as a Query only what it could answer twice: the line
[endpoints](endpoints.md) draws is that *if a caller could not run it twice and get the same
answer, it is not on the read side of this protocol*. A read that marks something seen, advances a
position or consumes what it returned is an Action that answers a result, and is declared as one.
The gain is everything a caller no longer has to ask: no idempotency key, no window, no question of
whether a timeout means it happened. A caller that got no answer reads again.

## What a read answers

**QRY-9 (required). A Query that declares `result` answers `200` with a document that matches it.
One that declares `items` answers `200` with the shared page envelope, each item matching the
declared schema, and takes `cursor` as every collection does.**

**QRY-9 is two sentences because ENDP-20 already wrote the second.** A collection a Worker defines
is a collection: the envelope is [schemas/page.json](../schemas/page.json), the cursor is opaque
and the Worker's (ENDP-21), the caller counts what arrived (ENDP-31), and a page reached through a
cursor repeats nothing the page before it carried (ENDP-33). None of that is restated as a QRY
rule, for the reason [nudges](nudges.md) gives about credentials: a second copy would be checked
twice and would disagree with the first on the day one of them was edited.

The order ENDP-23 requires a collection to hold is the Worker's to choose and to say — in the
description of the Query's own schema, where everything else about what it answers is said. This
file fixes none, because it knows nothing about what the items are.

A Query that declares `result` does not take `cursor`; sent one, it has been sent a parameter it
does not know, which is ENDP-24's.

**A read about something the Worker does not hold is still answered, and the answer says so.** A
plate nobody registered matches the schema of a parameter that takes a plate, so QRY-8 has nothing
to refuse and QRY-9 has a document to answer: one whose declared schema has a way to say *nothing
here* — a flag, a member left out — or, for a collection, a page with no items. It is never `404`.
On this address `not_found` means one thing, that the Query is not declared (QRY-6), and a caller
reading from a Descriptor a poll old has to be able to tell a Query that was withdrawn from a
vehicle that was never there. What a Worker's domain refuses about a value, the parameter's schema
says ahead of time, with an `enum` or a `pattern`, where a console can read it before asking.

## Who may read one

**QRY-10 (required). A Worker answers only the Queries the credential presented covers. A declared
Query that credential does not cover is `403`, with the code `forbidden`, answered before its
parameters are judged.**

**QRY-11 (required). A credential issued for a grant covers no Query its grant does not name
under `queries`, and none at all where the grant carries no `queries`: a declared Query it does not
cover is `403`, with the code `forbidden`.**

**Reading is divided as doing is.** ACT-22 has a Worker perform only the Actions a credential
covers, and TASK-6 has it answer only the Tasks one covers; a Query is the third thing a Contract
can name, and a Contract that grants a consumer one of a Worker's reads and withholds another is a
promise only the Worker can keep. It costs nothing to a Worker that divides nothing: one that holds
a single secret covers every Query with it.

**The credential a Worker was enrolled with reads every Query**, because REG-37 has a Worker accept
it on every address this protocol defines for reading, and this is one. QRY-10 is about every
other credential.

After QRY-6, because which Queries exist is no secret: the Descriptor is the same document for
every caller (REG-8), so a declared Query this credential may not read is refused as such, and an
undeclared one stays `404` (REG-7). Before QRY-8, so that a caller that may not read a Query learns
nothing about what it takes that the Descriptor did not already say.

**QRY-11 is GRANT-8's ceiling, said where a Query is.** A grant names what a Contract's credential
reaches, and what an applicant promises a Contract with it is that the credential reaches nothing
else. `queries` is the list that names the Queries (GRANT-11), and it is the one list a grant may
leave out, because it arrived after the other three and a grant written before it existed is still
a whole grant. Left out, it names none: a Worker that read silence as *all* would have widened
every grant applied before this edition by a thing nobody applied for. The Worker may still narrow
inside the list by rules of its own, as GRANT-8 lets it everywhere else, and never widen. It is
refused as QRY-10 refuses: after QRY-6, before the parameters.

## What this file does not fix

**What a Query is about.** Nothing here says a position, a balance or a document exists. The
schemas are the Worker's own; this file fixes that there are two of them, where they travel, and
what a refusal is called.

**How fresh an answer is.** A Query answers what the Worker holds when it is asked. Whether that is
a second old or an hour old is a Fact about the Worker's domain, and a Worker that wants a caller
to know says so in what it answers — an instant beside each item is the usual way.

**How often to read one.** A caller that polls is choosing its own latency, as a Tower choosing its
poll interval does. A Worker that cannot afford the reads it is sent answers `429` like any other
address, and a rate agreed between two parties is a Contract's.

## Still open here

- **A read whose input is a document.** QRY-2 keeps a parameter a string because a GET has nowhere
  else to put one. A search over a structure does not fit, and the two honest answers — a body on a
  read, which HTTP leaves undefined on a GET, or a POST that this protocol would have to promise
  changes nothing — each cost a rule this file is not yet in a position to argue.
- Whether a Query may name in `supersededBy` the one that replaces it, as NAME-10 lets an Action, a
  Task type and an event type do.

## Withdrawn

Nothing yet.

# Grants

`draft`

How an owner is told, ahead of time, what a Contract's credential covers, and how it hands back the
credential it issued for it. A grant is what a Contract carries to the owner: the Task types its
credential reads, the Actions it performs and the event types it consumes — and nothing about who
the consumer is, which the owner never needed to know.

## Why this exists

REG-24 has an owner validate a Contract's credential without calling the Control Tower, so whatever
that credential covers has to be in the owner before its first call. Until this file, nothing said
how it got there. Each owner received coverage its own way, and a Tower brokering Contracts across a
network had to speak to every owner differently — which is the integration cost this protocol exists
to remove.

REG-33 recommends that the owner issue the Contract's credential, and that step was manual, per
owner. A surface through which the party brokering a Contract asks and the owner issues is REG-33
carried out, not an exception to it: the credential is still the owner's, made however the owner
already knows how to check one.

**It is not a permission model.** It fixes what an owner and the party that applies a grant must
agree on for a Contract to take effect — the three lists, the credential, and when a change counts —
and nothing about how an owner stores a grant or checks a credential against it. `403` is still the
whole vocabulary of a right withheld. A Worker that does not declare `grants` is conformant, and how
its credentials are covered stays its own: a Worker holding one static secret can still be an owner,
which is REG-33's argument and the reason this Capability is optional.

**A grant is not a Contract.** The Contract is the Tower's agreement between a consumer and a
Service, and an owner never reads it ([architecture](../docs/architecture.md)). A grant is the part
of it one owner has to hold: what a credential covers on this Worker. The Capability is named for
what the owner holds.

The declaration is [schemas/grants-entry.json](../schemas/grants-entry.json), a request is
[schemas/grant-request.json](../schemas/grant-request.json), an answer is
[schemas/grant-receipt.json](../schemas/grant-receipt.json) and a listed grant is
[schemas/grant.json](../schemas/grant.json). Rules carry ids and a class; the convention is in
[spec/README.md](README.md).

## What a Worker declares, and who may apply

**GRANT-1 (required). A `grants` entry declares an address.**

**GRANT-2 (required). A grant belongs to its applicant: the caller that applied it, the same caller
ENDP-34 scopes a key to, and one the Worker's authentication names. Which named callers may apply is
the Worker's own; on this address any other is `403`, with the code `forbidden`, and so is a caller
the Worker names nothing for, and every credential issued for a grant.**

**The applicant is a caller and not a credential.** A Tower rotates its own credential like anybody
else, and a grant bound to the bytes it was applied with would be orphaned by the rotation — no
longer listable, revocable or readable under `contract` by the party that brokered it. Who is
calling is whatever the Worker's authentication decides, as ENDP-34 already has it.

**An applicant is a caller the Worker names, because `contract` is told to it and to nobody else**
(MET-23, EVT-22). A Worker that cannot tell its callers apart would tell every one of them; a grant
applied by *nobody in particular* would make every unnamed reader its applicant. So a Worker that
names no caller has no applicant, and one holding a single static secret that wants to apply grants
names the one caller that secret is.

**Which callers may apply is the owner's, and this file does not say how.** An owner enrolled with
one Tower accepts that Tower's caller; one watched by two may accept both, and each applies grants
the other never sees. Tying applying to enrollment instead — the credential the Tower polls with —
would let an owner broker with only one Tower, and would make polling a Worker the same right as
issuing credentials on it.

**A credential issued for a grant never applies one.** It covers what its grant names, and applying
is not among the things a grant can name; a consumer able to mint credentials on the owner would
have been handed the Tower's role by a Contract.

## Applying one

**GRANT-3 (required). A POST to the address applies a grant. Its body carries the grant's `id`, and
under `tasks`, `actions` and `events` either `all` or a list of names — Task types the `tasks`
entry raises, Actions the `actions` entry accepts, event types the `events` entry publishes — and
optionally `rotate`, and nothing else. A name the Worker does not declare is `422`, with the code
`unprocessable_content`, and nothing is applied.**

**GRANT-4 (required). A grant is identified by its applicant and its id. Applying under an id the
applicant holds no grant under creates one, issues a credential for it, and is answered `201` with
the grant and the credential.**

**GRANT-5 (required). Applying under an id the applicant already holds replaces what that grant
names and is answered `200` with the grant. It issues a credential only where the request carries
`rotate: true`, and then answers it, and every credential issued for that grant before stops being
valid.**

**The three lists are what a Contract names.** The [architecture](../docs/architecture.md) has a
Contract name a Service's events, Task types and Actions, and those are what a credential reads
(TASK-6), performs (ACT-22) and consumes (SUB-4). Health, Alerts, activity, logs and metrics are not
here: they are the relationship of enrollment between a Worker and whoever operates it, the same for
every credential that reaches them (ALRT-6), and a grant that named them would force filtering on
surfaces that are deliberately one document. `all` is a value and not an omission, so a grant that
covers every Action says so, and one that names none sends an empty list.

**An unknown name is refused rather than dropped**, for SUB-3's reason: a grant that quietly covered
less than its applicant asked for would be a Contract the owner was never told about, and the
consumer would find out from a `403` it had no way to explain.

**The id is the applicant's, and two applicants may use the same one.** It is what the applicant
already calls its Contract, so nothing has to be mapped, and it is unique only beside the applicant:
two Towers brokering with one owner hold two grants under one id and see neither of each other's.

**Creating issues a credential, updating does not, and rotating is asked for.** Changing what a
grant covers is routine — a Contract extended to one more Task type — and a consumer that did
nothing wrong should not be cut off by it: its credential stays valid and covers the new lists from
the response on (GRANT-9). A credential that leaked, or a response that was lost on creation, is
mended by applying again with `rotate`. An applicant always knows which of those it is in, because
it either holds the credential or it does not.

**Nothing here is idempotent through a key, and nothing needs to be.** Applying the same lists twice
leaves the same grant and issues nothing, so a repeat of an update is harmless; a repeat of a
creation whose response was lost answers `200` without a credential, which tells the applicant to
rotate. A window answering the same credential twice would have kept that credential at rest in the
owner for the length of it, which is the one thing a Worker should never be made to hold.

## Listing and revoking

**GRANT-6 (required). A GET of the address lists the applicant's own grants in the page envelope of
ENDP-20, and never another applicant's, nor any credential.**

**GRANT-7 (required). A DELETE to that address naming a grant in the `grant` parameter revokes it
and is answered `204`. An id the caller holds no grant under is `404`, with the code `not_found`,
and nothing is revoked.**

GRANT-7 is `404` and not `403`, and unlike SUB-17 it binds, because there is nothing to protect by
recommending it: an id is unique only beside its applicant, so another applicant's grant under the
same id is not this caller's grant refused but a grant this caller does not hold.

Revoking is a DELETE for the reason SUB-9 is (ENDP-36), and names the grant in a parameter on the
declared address because ENDP-1 lets a caller use only addresses the Descriptor declared.

## What a credential issued for a grant covers

**GRANT-8 (required). A credential issued for a grant covers nothing its grant does not name: no
Task of a type outside `tasks` (TASK-6), no Action outside `actions` (ACT-22), and no event type
outside `events` (SUB-4).**

**GRANT-10 (required). A credential issued for a grant is `403` on the addresses of `health`,
`metrics`, `alerts`, `activity` and `logs`, and on the reading address of `configure`.**

**The grant bounds, and the Worker may narrow inside it.** GRANT-8 fixes the ceiling, which is what
an applicant needs to promise a Contract: nothing outside the lists. Inside them, a Worker may still
refuse by rules of its own domain — the Tasks of one store and not another, say — because everything
behind `403` is the Worker's; what it may never do is widen. A Worker with no rules of its own
covers exactly the lists.

**`all` means every name the Worker declares, including one it declares later.** It is how a
Contract over a whole Service is written, and it widens when the Worker deploys a new Task type,
Action or event type, which is what a Contract over the whole of something means. A grant that must
not widen names its lists. A name the Worker stops declaring covers nothing from then on, as there
is nothing left to cover; an applicant that applies the same lists again is told so with GRANT-3's
`422`, and drops the name.

**Watching is enrollment, and no grant names it.** GRANT-10 closes the surfaces through which a
Worker is operated, because they are the relationship between a Worker and whoever operates it,
which REG-34 fixes and ALRT-6 keeps one document for every reader — not a Contract between a
consumer and a Service. A grant that opened them would let a Contract hand out what enrollment
withholds, and the one Worker with alerts to hide would have a second door to them. A party that
should watch a Worker is enrolled with it, with a credential recorded for it, as any Tower is. A
party that both watches a Worker and works under a Contract with it therefore holds two credentials
there: the one recorded at enrollment, and the one a grant issued.

**GRANT-9 (required). A change takes effect from the response to it. Revoked, or replaced by a
rotation, a credential is `401` on every address, and every subscription it created ends as
`revoked` (SUB-14, SUB-15). Narrowed, what it no longer covers is `403`, and every subscription it
created that names an event type no longer covered ends as `revoked`. A subscription ending here
receives nothing from the response on.**

**A revoked credential no longer exists, so it is `401` and not `403`.** It was issued for one grant
and lives and dies with it. Keeping it recognised in order to answer `403` would keep alive a
credential that serves no purpose, and ENDP-40 already divides the two statuses at whether the
credential could be read at all. A narrowed one is still read and still covers something, so what it
lost is `403`, as any right withheld is.

**This revocation can be observed, and that is the difference from the rule
[registration](registration.md) withdrew.** It required a revoked credential to be refused from the
next request, and went because a revocation through an identity provider cannot be seen from
outside — no verifier knows when it was issued. This one goes through the protocol, and its
response is the instant: revoke, call, `401`. The owner holds the grant itself, so no cached verdict
on the credential stands between the two.

**A subscription goes with the coverage that created it.** A consumer that may no longer consume a
type has no subscription to it, and SUB-14 already ends a subscription whose caller the Worker no
longer accepts. A subscription naming several types, one of which was narrowed away, ends whole; the
consumer subscribes again with what it still covers (SUB-7). After a rotation it subscribes again
under the new credential, and the gap in its events is confined to a rotation somebody asked for —
which is also what removes any subscription a leaked credential made towards a sink of its own.
*Receives nothing from the response on* is what makes the ending observable at the sink, whichever
moment the Worker writes it down.

## What this file does not fix

**How an owner stores a grant or checks a credential.** A table, a document, an identity provider
told to mint a key — whatever the owner already runs. GRANT-8 says what a credential covers, and the
lookup behind it is the owner's.

**What a credential looks like.** It is presented by REG-3 like any other, and nothing here says
what it is made of or how long it lives beyond its grant.

**Whether an operator sees every grant.** GRANT-6 forbids showing one applicant another's, and is
worded so that a view for the Worker's own operator would be an addition rather than a change.

## Still open here

- Whether a grant carries more of a Contract than these three lists — a rate, a retention of Task
  events, the time zone a multi-tenant Worker cuts a consumer's metric buckets in. Open in
  [undecided](../docs/undecided.md).

## Withdrawn

Nothing yet.

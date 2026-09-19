# Tasks and Claims

`draft`

How an owner exposes the Tasks its conditions hold open, how a consumer claims one exclusively, and
how a Response comes back. The Task closes by condition; the Claim closes by declaration or by
lease.

This is the *delegate* half, and it is the one that inverts a dependency. A Task names the Actions
that may answer it and the Skill needed to perform them, and never an actor. The owner knows
nobody; the consumer knows the owner, exactly as a subscriber knows the shape of the event it
consumes. Everything below exists to keep that true under contention, under failure, and under two
clocks that were never synchronised.

The declaration is [schemas/tasks-entry.json](../schemas/tasks-entry.json), one Task on the wire is
[schemas/task.json](../schemas/task.json), and a Claim is
[schemas/claim.json](../schemas/claim.json). One header name is fixed by this file and by nothing
else, because a JSON Schema describes a body and not a header: `Worker-Protocol-Claim`, which
TASK-20 gives its meaning. What follows is what no schema can state. Rules carry ids and a class;
the convention is in [spec/README.md](README.md).

## What a Worker declares

**TASK-1 (required). A `tasks` entry declares two addresses: one a read answers Tasks from, and one
a claim is posted to.**

**TASK-2 (required). The entry declares every Task type the Worker raises, keyed by name, each with
the schema of its payload and the closed list of Actions that may answer it.**

**TASK-3 (required). The entry declares the Task types the Worker answers, which is its Skill. A
Worker declares either list, both, or neither.**

**TASK-4 (required). A Task type is a qualified name under NAME-7.**

Two addresses and not one, because ENDP-3 puts everything that changes state on an address declared
for the purpose and ENDP-2 keeps a read a read. Listing a Worker's open Tasks must not consume
them — that is the exact case [endpoints](endpoints.md) spends ENDP-2's argument on — and claiming
one takes an exclusive lease, so it is not a read and could never be a GET.

TASK-2's closed list is the keystone of the whole arrangement, and it is a *list of the owner's own
Actions*. A Response is an Action posted into the owner (TASK-16), so the Actions that may answer a
Task are declared in that same Worker's `actions` entry and named here by their names. A Task type
that names an Action the Worker does not accept is a Descriptor disagreeing with itself, which is
the fault DESC-18 already describes one level up. TASK-21 is where the list binds on a call: an
Action performed under a Claim whose Task type does not list it is refused.

TASK-3 is the other side of the same name, and putting both in one entry is what makes the
[architecture](../docs/architecture.md)'s *unit of discovery* concrete: the Tower catalogs Workers
by the Task types they answer, so a Worker that answers `tech.rowing.fleet.verify-vehicle` says so
where every reader already looks. A Worker that raises Tasks and answers none, or answers and
raises none, is the ordinary case rather than the exception — which is why neither list is required.

TASK-4 is NAME-7 applied and adds nothing to it. A Task type is matched by a party that did not
mint it, which is the whole test NAME-7 states: two teams that never spoke both raising
`verify-vehicle` is a collision a consumer cannot see and the Tower will resolve wrongly.

## Reading what is open

**TASK-5 (required). A read of the reading address answers the Tasks whose conditions hold, in the
page envelope of ENDP-20.**

**TASK-6 (required). A Worker answers only the Tasks the credential presented covers.**

**TASK-7 (required). Each Task carries its id, its type, its payload, how many Claims have failed,
how many have lapsed, and whether it may be claimed now.**

**TASK-8 (required). A read filters by Task type with `type`. A type the entry does not declare is
`400`, with the code `invalid_parameter`.**

**TASK-26 (required). A Task under a Claim carries `holder`, an identifier the owner mints for
whoever holds that Claim, when it is read with a credential recorded for the Worker at enrollment
(REG-21) — and never when it is read with any other.**

TASK-6 answers the question this file was asked — whether the owner filters or the consumer reads
and discards — and it goes to the owner for two reasons that point the same way. A list that showed
every Task to every holder of any Contract is a disclosure the owner cannot take back, and it would
be made by the one party that already knows better: REG-24 has an owner validate the credential
itself, so it holds the answer before it builds the page. And a consumer reading and discarding
pages through work it may not take, which costs both sides and gets slower as the network grows.

It is worth naming the contrast with REG-8, which requires the *Descriptor* to be the same document
for every caller. The two are not in tension: a Descriptor says what a Worker implements, and
filtering it would make the registry a statement about what the Tower is allowed to see. A Task
list is not a declaration, it is work — and which work a consumer may take is exactly what a
Contract is.

TASK-7 puts the failure counts on the Task itself, which is where the
[architecture](../docs/architecture.md) said they would be: failure is counted over Claims and
never over the condition. A Task that has outlived several failed Claims is stuck, and the point is
that it is stuck *where somebody can see it*, with the count beside it, rather than in a queue
retrying in silence. `claimable` is the other half — an owner that has stopped granting leases says
so on the Task rather than by refusing every claim and leaving a consumer to infer it from a
pattern of `409`s.

TASK-26 is the other thing a stuck Task has to show. TASK-7's counts say how many Claims failed and
how many lapsed, and a Task that has outlived several is stuck where an operator can see it — with
a number beside it and nobody to call. The owner already knows who holds the current Claim: REG-24
has it validate the credential itself, so it held the answer before it granted the lease. What it
publishes is an identifier of its own and not the credential or a name, because REG-27 only
*recommends* one credential per holder, and because the id is the owner's to mint and an operator's
to map onto the Contract it brokered. It goes to the recorded credential and to no other for the
reason TASK-6 gives: a consumer that read who else holds work from this owner would learn about a
party it has no Contract with, and that is a disclosure the owner cannot take back. A Worker that
reads openly has no recorded credential and answers no `holder` to anyone.

## Claiming

**TASK-9 (required). A claim is a POST to the claim address naming the Task in `task`. It answers
the Claim: its id, the Task it holds, and the instant its lease expires.**

**TASK-10 (required). A claim of a Task that is already claimed is `409`, with the code
`conflict`.**

**TASK-11 (required). A claim of a Task the Worker will not currently grant a lease on is `409`,
with the code `conflict`.**

**TASK-12 (required). The owner sets the lease. Its expiry travels as an RFC 3339 instant carrying
an offset, and this protocol fixes no duration.**

**TASK-13 (required). A holder renews by posting the claim address naming the Claim in `claim` and
no outcome. The owner answers a new expiry, or refuses.**

**TASK-23 (required). A `tasks` entry declares in `claimByType` whether a claim may name a Task
type in `type` rather than a Task in `task`. A claim naming a type the entry does not raise, or
naming one where the entry does not declare `claimByType`, is `400`, with the code
`invalid_parameter`.**

**TASK-24 (required). Where `claimByType` is declared, a claim naming a type grants a lease on one
claimable Task of that type that the credential presented covers, and answers the Claim with the
Task it holds in `held`. Where no such Task is claimable, `204`, and nothing is claimed.**

**TASK-25 (required). A claim or a renewal may propose a lease duration in `lease`, in seconds.
The owner grants what it decides and publishes it as the expiry, and a proposal binds it to
nothing.**

Claiming is exclusive and the owner's store settles contention by first commit, which is why this
file needs no policy for it: two consumers that post at the same instant produce one grant and one
`409`, and neither had to agree with the other about anything. `conflict` is the code ENDP-29
already named *a Task already claimed* among its 409s, so the vocabulary needed nothing new.

TASK-10 and TASK-11 share a code and are two rules because a report naming one of them is the point
of having ids at all. They are also two different facts for the consumer: a Task somebody else is
holding will free up, and a Task the owner has stopped granting on will not until a person looks at
it. Which one it was is on the Task itself under TASK-7, which is where a consumer reads it without
having to interpret a status code.

**No duration is fixed, and that is the same refusal [health](health.md) makes about a poll
cadence.** A number here would be a number every Worker in every deployment was measured against,
invented by somebody who had seen none of them. What a lease has to be is long enough for the work
and short enough that a lapsed one is not a stall, and only the owner knows either.

**TASK-25 is what lets the consumer say the one thing it knows.** How long the work takes is the
holder's fact and nobody else's: a consumer that needs thirty minutes and is granted five renews
six times, and each renewal is a request the owner answers for no reason a longer lease would not
have removed. So it may *propose*, and the two rules above are untouched by it. A duration is not
an instant, so TASK-18's argument about two clocks does not reach it; and the owner grants what it
decides and publishes the expiry as before, so a proposal is information and never a term. It is
allowed on a renewal as well as on a claim because a renewal is where a holder finds out that its
lease was short.

**TASK-23 and TASK-24 remove a round trip and a race, and are an addition and not a replacement.** A
claim names a Task by id (TASK-9), and the id is read off the list — so the path from a nudge is
nudge, list, claim, and under contention several consumers read the same page and run at the same
ids, harvesting `409`s that TASK-10 then has to explain. Claiming by type asks the owner for *one
claimable Task of this kind that I may take*, and the owner, whose store already settles contention
by first commit, answers the Claim and the Task together: one call, and no race the consumer can
lose. The list stays where it is, for the operator and for TASK-6. It is declared rather than
assumed because DESC-11 has a Capability declare what is conditional on a call, and because an
owner whose store cannot pick *any one* atomically should not be made to pretend it can.

**A success and not a refusal, and this is the one place in the protocol where that had to be
argued.** A claim by type asks *is there work of this kind for me*, and *no, not now* is the answer
a consumer polling a quiet queue gets most of the time. It is not a failure of any kind:
[endpoints](endpoints.md) divides every refusal into *you are wrong* and *I am busy*, and calls
that division the most load-bearing thing it says — an empty queue is neither. `reject` means, in
ENDP-28's own words, that the request *is wrong and will be wrong again*, which is false here and
would be false of `409` too; the choice was never between two error codes. The protocol already has
a convention for a question that finds nothing, and it is the opposite of an error: a read with no
results is an empty page under ENDP-20 and answers `200`. A claim by type is the first call here
that can legitimately come back empty without being a page, and `204` is what ENDP-29 leaves room
for when it says this protocol does not fix the status of a success. TASK-14 and ACT-10 already
answer `204` for *done, and nothing to hand back*.

The earlier draft of this rule answered `404`, and it was wrong twice over. It classed an ordinary
Tuesday as a contract error — and the rule that then stood in [descriptor](descriptor.md), written
about a declared address that is not served but worded as *a declared surface answering `404`*,
told every conformant consumer to stop polling permanently the first time it found the queue empty.
That one has been narrowed to what its argument earns and its predecessor is withdrawn there; this
one never reached an edition, so it is corrected in place.

`invalid_parameter` for a type the entry does not raise is TASK-8's division applied to a write,
and the same code where `claimByType` is not declared, so that a consumer built against an owner
that declares it and pointed at one that does not is told the same thing either way. A claim that
names a Task the owner is not granting on is different again and stays a `409`: it conflicts with
the state of a thing the caller named, which is TASK-11.

## Answering

**TASK-14 (required). A holder closes its Claim by posting the claim address naming the Claim in
`claim` and an outcome of `done`, `failed` or `released`.**

**TASK-15 (required). Closing a Claim does not close the Task. A Task closes when its condition
stops holding, and no party declares that.**

**TASK-16 (required). A Response is two calls: the Action into the owner, and then the outcome on
the Claim. They are not atomic.**

**TASK-17 (required). A call naming a Claim that is no longer the Task's current one is `409`, with
the code `conflict`.**

**TASK-20 (required). A holder performs the Action that answers its Task naming its Claim in the
`Worker-Protocol-Claim` header of the call.**

**TASK-21 (required). An Action call carrying `Worker-Protocol-Claim` is refused before anything is
performed where the Claim named is not its Task's current one, or where its Task's type does not
list the Action under TASK-2: `409`, with the code `conflict`.**

**TASK-22 (required). A Claim stays its Task's current one after the Task's condition stops
holding. It stops being current when it is closed, when it lapses, or when another Claim is granted
on the same Task — never because the Task closed — so an outcome naming it answers `204` and a
renewal naming it answers an expiry.**

TASK-15 is the sentence the rest of this file protects. The owner derives its Task from its own
Facts, so a consumer declaring the work done is telling the owner something about the consumer, not
about the condition. An owner that closed a Task because somebody said so would be holding state
whose authority it had given away — which is the one thing the
[architecture](../docs/architecture.md) does not allow of a Worker.

**TASK-16 costs something real and it is stated rather than hidden — and the cost is narrower than
a first reading suggests, because TASK-15 narrows it.** Two calls that are not atomic means the
second can be lost. When the Action resolves the condition, that costs nothing that matters: the
Task is gone the moment the Action lands, there is nothing left for anyone to reclaim, and a lost
outcome leaves the owner a Claim it closes by lapse. The window is open only when the Action does
*not* resolve the condition — partial progress, a condition that waits on something else, an
Action that declares it does not complete within the call and whose outcome ACT-11 leaves this
edition without. There, the Action lands, the outcome never does, the lease lapses, and another
consumer claims the same Task and performs the same Action again. That is not a defect to be
engineered away here — making it atomic would mean the owner accepting an envelope that carried an
Action performance inside a Claim outcome, which puts this protocol's vocabulary inside a document
the Worker owns and is exactly what ACT-5 argues against. The protocol already offers the answer
and it is the Action's to take: an Action that declares an idempotency key under ACT-12 is
performed once however many times it is posted. **A Task whose answering Action declares no key is
one a consumer should expect to perform more than once**, and that is emphasis rather than an
obligation, because nothing about it is a contract between two parties — it is what a design costs,
said out loud.

TASK-17 settles how a stale Response is refused, and it settles it *without a clock*. The Claim id
is the fencing token: a call names the Claim it was performed under, and the owner checks at write
time whether that Claim is still the Task's current one. A lapsed lease, a released Claim, a Task
reclaimed by somebody else — all three are the same check and it is a precondition rather than a
sweep. Comparing instants would have required the owner and the holder to agree about the time,
which is the thing the next section says they cannot.

**TASK-20 and TASK-21 are what make the token a token.** Until they were written, this file defined
a Response as two calls and never said that the first of them names the Claim — and no rule in
[actions](actions.md) required one, so on the wire a Response and an ordinary performance of the
same Action were the same bytes. A fencing token nobody presents fences nothing: the late Response
TASK-17 exists to refuse could not be told from an operator posting the same Action from a console,
and the twenty minutes of work the Claim was taken to protect could be paid for twice by a Worker
that did everything the text asked. So the holder names its Claim on the Action, and it names it in
a header rather than in the body because ACT-5 makes the body the input and nothing else —
`Idempotency-Key` is the precedent, a fact about the call that is not part of what the Action takes.
An Action posted without the header is a performance under [actions](actions.md) and this file has
nothing to say about it: it may well resolve the condition, which is TASK-15 working as intended,
but it answers no Claim and nothing here refuses it. TASK-21's refusal comes *before* the
performance because that is what a precondition is; a Worker that performed and then refused would
have done the duplicate work the fence exists to prevent. The second clause is TASK-2's list
binding at last: a Claim on one Task type does not license an Action that type never named.

**What the fence does not reach is worth stating, because TASK-20 binds the holder and nobody can
check it.** A holder that simply omits the header performs the Action, and the owner has no way to
tell that call from a console posting the same thing: the one late Response TASK-21 would have
refused — a holder whose lease lapsed, whose Task another consumer has since claimed, posting
anyway — goes through, and the work is done twice. Nothing here can prevent that, and pretending
otherwise would be the kind of rule this specification refuses to write: the subject is the
consumer, no request carries the evidence, and `conformance/` reports it as another subject's. What
bounds the damage is the same thing that bounds TASK-16's: an Action with an idempotency key under
ACT-12 is performed once however many times it is posted.

**TASK-22 closes a hole TASK-17 would otherwise open on every successful Response.** When the
Action resolves the condition, the Task is gone before the outcome arrives, and a reading of *the
Task's current one* that looked the Task up would find nothing and answer `409` — so the ordinary
end of every Response would be an error the consumer learns to ignore, which is how it comes to
ignore the one `409` that matters. Currency is therefore a fact about the Claim and never about the
Task: it ends by declaration, by lapse, or by a successor, and a Task closing ends nothing. The
outcome is accepted, the holder's bookkeeping closes cleanly, and TASK-17 keeps its one meaning.

**The case is ordinary rather than a corner, and it was found by running into it.** Building the
conformance tool's Task checks required claiming before performing, because the Action that answers
a Task resolves its condition and the Task is then not there to be claimed — which reads as a
scheduling detail of a test harness and is not one. It is TASK-15 in the open: a Task disappears
the instant the Facts beneath it change, and any consumer listing Tasks while another performs that
Action sees exactly the same thing. The race is not between a test and a Worker; it is between two
consumers of any Worker, which is why the Claim has to survive the Task rather than be looked up
through it.

## Clocks

**TASK-18 (required). The owner's clock decides. A lease expiry is a fact the owner publishes and
enforces, and no party computes whether a lease is still held by comparing that instant against a
clock the owner never saw.**

Two processes that have never met do not share a clock, and this protocol has no mechanism that
would give them one — there is no handshake, no round-trip estimate, and nothing that would let a
consumer calibrate. So the expiry an owner publishes is not a number a holder does arithmetic on to
decide whether it may still act. It is a *hint about when to renew*, which is what a holder
genuinely needs it for, and every question of the form *is this Claim still mine* is answered by
asking: TASK-17 has the owner refuse a call naming a Claim it no longer holds open, and that answer
is authoritative because it was computed on one clock.

A holder whose clock runs slow acts, and is refused. A holder whose clock runs fast renews early
and costs the owner a request. Neither loses work, and neither had to be right about the time.

## The nudge

**TASK-19 (recommended). A nudge is an Action the consumer declares and the owner performs. It
carries a Task type and nothing else.**

A nudge is best-effort by construction: whoever receives one claims as it would have on its next
schedule, and losing one costs latency and never work. That is what lets this be the one call in
the protocol that runs from an owner *to* a consumer without any of the machinery such a direction
would otherwise need — no new surface, no second address, no delivery guarantee to specify.

Making it an Action is what removes the machinery. The consumer already declares Actions with
schemas and addresses (ACT-1, ACT-2), a Contract already names which Actions a party may post, and
REG-3 already fixes how the credential is presented — so the nudge needs exactly nothing from this
file beyond the name. The credential is the consumer's to issue, which is REG-33 read from the
other side: whoever is being called validates what it issued.

It recommends rather than binds because the pair is what makes the design correct and only one half
of it is load-bearing. **A Worker that claims only on a nudge is one dropped request away from
stalling silently**, so the schedule is what the design rests on; the nudge makes the common case
prompt and nothing depends on it arriving. A consumer that declares none is slower and never wrong.

Where the owner declares `claimByType`, a nudge is answered in one call: the consumer claims by the
type the nudge carried and receives the Task with the Claim (TASK-24), without listing first.

## Still open here

- **Who verifies that a Worker answers the Task types it declares under TASK-3.** The Tower at
  registration, the owner at claim time, or nobody. Open in [undecided](../docs/undecided.md).
- **What happens to a Claim held under a credential revoked mid-flight.** TASK-17 refuses the
  Response on the Claim, but nothing says whether the owner should have closed the Claim first.
  Listed from [registration](registration.md).
- **Whether a holder may close its Claim in the Action call itself** — the header TASK-20 fixes
  carrying an outcome beside the id, declared by the owner and never required. It is one
  declaration away and this edition stops short of it for two reasons. A Task type may list several
  Actions and a holder may post two before it is done, so the header would carry a declaration and
  not only an id, and the Response would have two forms. And a Worker whose Action reaches a
  system outside its own store has no transaction that spans both, so the form could only ever be
  declared. With TASK-22 the window TASK-16 admits is the narrow one, and ACT-12 already covers it.
- **Whether a holder renews several Claims in one call.** TASK-13 renews one. A batch answers an
  expiry or a refusal *per Claim*, which is a partial success ENDP-29 has no vocabulary for; and
  TASK-12 leaves the lease to the owner precisely so that a long one makes renewal rare.
- **Whether a credential recorded at enrollment is told from a Contract's by anything this protocol
  sees.** TASK-26 leans on the distinction and [registration](registration.md) leaves the shape of
  a credential's rights open.
- Whether a Task may carry a deadline of its own, distinct from any Claim's lease.
- What a Response may carry beyond the outcome — the cost and elapsed time the
  [architecture](../docs/architecture.md) mentions — and who consolidates it. TASK-26 now names
  whom it would be consolidated for. Open in [undecided](../docs/undecided.md).

## Withdrawn

Nothing yet.

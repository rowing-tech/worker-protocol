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
[schemas/claim.json](../schemas/claim.json). What follows is what no schema can state. Rules carry
ids and a class; the convention is in [spec/README.md](README.md).

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
the fault DESC-18 already describes one level up.

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

## Answering

**TASK-14 (required). A holder closes its Claim by posting the claim address naming the Claim in
`claim` and an outcome of `done`, `failed` or `released`.**

**TASK-15 (required). Closing a Claim does not close the Task. A Task closes when its condition
stops holding, and no party declares that.**

**TASK-16 (required). A Response is two calls: the Action into the owner, and then the outcome on
the Claim. They are not atomic.**

**TASK-17 (required). A call naming a Claim that is no longer the Task's current one is `409`, with
the code `conflict`.**

TASK-15 is the sentence the rest of this file protects. The owner derives its Task from its own
Facts, so a consumer declaring the work done is telling the owner something about the consumer, not
about the condition. An owner that closed a Task because somebody said so would be holding state
whose authority it had given away — which is the one thing the
[architecture](../docs/architecture.md) does not allow of a Worker.

**TASK-16 costs something real and it is stated rather than hidden.** Two calls that are not atomic
means the second can be lost: the Action lands, the outcome never does, the lease lapses, and
another consumer claims the same Task and performs the same Action again. That is not a defect to
be engineered away here — making it atomic would mean the owner accepting an envelope that carried
an Action performance inside a Claim outcome, which puts this protocol's vocabulary inside a
document the Worker owns and is exactly what ACT-5 argues against. The protocol already offers the
answer and it is the Action's to take: an Action that declares an idempotency key under ACT-12 is
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

## Still open here

- **Who verifies that a Worker answers the Task types it declares under TASK-3.** The Tower at
  registration, the owner at claim time, or nobody. Open in [undecided](../docs/undecided.md).
- **What happens to a Claim held under a credential revoked mid-flight.** TASK-17 refuses the
  Response on the Claim, but nothing says whether the owner should have closed the Claim first.
  Listed from [registration](registration.md).
- Whether a Task may carry a deadline of its own, distinct from any Claim's lease.
- What a Response may carry beyond the outcome — the cost and elapsed time the
  [architecture](../docs/architecture.md) mentions — and who consolidates it. Open in
  [undecided](../docs/undecided.md).

## Withdrawn

Nothing yet.

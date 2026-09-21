# Tasks

`draft`

How an owner exposes the Tasks its conditions hold open, and how somebody answers one. A Task
closes when its condition stops holding, and nobody declares that.

This is the *delegate* half, and it is the one that inverts a dependency. A Task names the Actions
that may answer it and the Skill needed to perform them, and never an actor. The owner knows
nobody; the consumer knows the owner, exactly as a subscriber knows the shape of the event it
consumes.

The declaration is [schemas/tasks-entry.json](../schemas/tasks-entry.json) and one Task on the wire
is [schemas/task.json](../schemas/task.json). What follows is what no schema can state. Rules carry
ids and a class; the convention is in [spec/README.md](README.md).

**This file used to carry a Claim: an exclusive lease a consumer took on a Task, with an expiry, a
renewal, a fencing token, counts of what had failed and lapsed, and an identifier for whoever held
it.** Sixteen rules of it are withdrawn below, and the argument is at the end of this file rather
than buried in the list, because a reader who remembers them is owed it.

## What a Worker declares

**TASK-27 (required). A `tasks` entry declares one address, which a read answers Tasks from.**

**TASK-2 (required). The entry declares every Task type the Worker raises, keyed by name, each with
the schema of its payload and the closed list of Actions that may answer it.**

**TASK-29 (required). The Descriptor declares under `skills`, at its root and not inside a
Capability, the Task types the Worker answers — which is its Skill. A Worker with none omits it.**

**TASK-4 (required). A Task type is a qualified name under NAME-7.**

TASK-2's closed list is a *list of the owner's own Actions*: answering a Task is performing one of
them, so they are declared in that same Worker's `actions` entry and named here by their names. A
Task type that names an Action the Worker does not accept is a Descriptor disagreeing with itself,
which is the fault DESC-18 already describes one level up.

**What the list does not do is bind on a call, and that is worth saying plainly.** A Worker cannot
tell an Action performed *because of* a Task from one performed for any other reason: the two are
the same request. The list tells a consumer what would answer, and nothing refuses a performance
that answers nothing.

TASK-29 is the other side of the same name, and it is what makes the
[architecture](../docs/architecture.md)'s *unit of discovery* concrete: the Tower catalogs Workers
by the Task types they answer, so a Worker that answers `tech.rowing.fleet.verify-vehicle` says so
where every reader already looks. Both lists are drawn from one vocabulary, and NAME-7 reaches both
for the same reason — `raises` says *I need this done* and `skills` says *I can do this*, and the
two are joined by a party that met neither.

**It sits at the root rather than in the `tasks` entry, and where it sits is an argument.** A
Capability is something a Worker *serves*: DESC-12 gives each entry an address, and a read of the
`tasks` address answers instances of the types under `raises`. A Skill is served at no address and
answered by no surface — it is what a Worker *is*, like its id, and the Tower reads it the way it
reads the id. Inside the entry it also made the pure answerer absurd: a field crew that knows how
to verify a vehicle and raises nothing of its own had to declare a `tasks` Capability, with a
reading address, in order to serve an empty page at it forever. At the root it declares a Skill and
no `tasks` Capability at all, which is what DESC-2 says a Worker may do with any Capability it does
not implement.

A Worker that raises Tasks and answers none, or answers and raises none, is the ordinary case
rather than the exception. **Both rules bind anyway, and they say the empty case differently.** A
Worker that raises nothing still declares `raises` as an empty map, because the entry exists and
every reader parses one shape; a Worker that answers nothing omits `skills` entirely, because
TASK-29 is a root field and DESC-2 already has a Worker leave out what it does not implement. What
neither rule requires is *content* — and both require that what content there is be complete. A
Worker that answers a Task type and leaves it out of `skills` is not conformant; it is merely
undiscoverable, which is the same thing from the Tower's side and is why nothing outside can tell.

TASK-4 is NAME-7 applied and adds nothing to it. A Task type is matched by a party that did not
mint it, which is the whole test NAME-7 states: two teams that never spoke both raising
`verify-vehicle` is a collision a consumer cannot see and the Tower will resolve wrongly.

## Reading what is open

**TASK-5 (required). A read of the reading address answers the Tasks whose conditions hold, in the
page envelope of ENDP-20.**

**TASK-6 (required). A Worker answers only the Tasks the credential presented covers.**

**TASK-28 (required). Each Task carries its id, its type, its payload, and the instant its
condition began, as an RFC 3339 instant carrying an offset.**

**TASK-8 (required). A read filters by Task type with `type`. A type the entry does not declare is
`400`, with the code `invalid_parameter`.**

TASK-6 answers the question this file was asked — whether the owner filters or the consumer reads
and discards — and it goes to the owner for two reasons that point the same way. A list that showed
every Task to every holder of any Contract is a disclosure the owner cannot take back, and it would
be made by the one party that already knows better: REG-24 has an owner validate the credential
itself, so it holds the answer before it builds the page. And a consumer reading and discarding
pages through work it may not take costs both sides and gets slower as the network grows.

It is worth naming the contrast with REG-8, which requires the *Descriptor* to be the same document
for every caller. The two are not in tension: a Descriptor says what a Worker implements, and
filtering it would make the registry a statement about what the Tower is allowed to see. A Task
list is not a declaration, it is work — and which work a consumer may take is exactly what a
Contract is.

**TASK-28 carries an instant and no status, and the instant is what a stuck Task is read from.** A
Task exists while its condition holds (TASK-15), so there is no state for anybody to interpret;
what an operator needs to know is *how long this has been true*, and a Task open since Tuesday is
one nobody has answered. It is the same field ALRT-3 puts on an Alert and it is read the same way:
it tells *this is new* from *this is the same thing as yesterday*, which is most of what anybody
wanted a status for.

## Answering one

**TASK-15 (required). A Task closes when its condition stops holding, and no party declares that.**

**TASK-19 (recommended). A nudge is an Action the consumer declares and the owner performs. It
carries a Task type and nothing else.**

TASK-15 is the sentence this whole file protects. The owner derives its Task from its own Facts, so
a consumer declaring the work done is telling the owner something about the consumer, not about the
condition. An owner that closed a Task because somebody said so would be holding state whose
authority it had given away — which is the one thing the
[architecture](../docs/architecture.md) does not allow of a Worker.

So answering a Task is performing an Action, under [actions](actions.md) and nothing added: ACT-5
posts it, the Worker changes the Facts the condition is derived from, and the Task is gone the next
time anybody reads. There is no second call and nothing to close.

**Two consumers may therefore answer the same Task, and that is admitted rather than prevented.**
What bounds it is what bounds any repeat in this protocol: an Action that declares an idempotency
key under ACT-12 is performed once however many times it is posted, and a condition that a first
answer resolved is not there for a second. Where an owner needs more than that — where the work is
expensive, or physical, or paid for — the consumers of that work coordinate among themselves, which
is the party that can. This protocol does not hold the lock, and the section below is why.

A nudge is best-effort by construction: whoever receives one reads as it would have on its next
schedule, and losing one costs latency and never work. That is what lets this be the one call in
the protocol that runs from an owner *to* a consumer without any of the machinery such a direction
would otherwise need — no new surface, no second address, no delivery guarantee to specify.

Making it an Action is what removes the machinery. The consumer already declares Actions with
schemas and addresses (ACT-16, ACT-2), a Contract already names which Actions a party may post, and
REG-3 already fixes how the credential is presented — so the nudge needs exactly nothing from this
file beyond the name. **The name is ACT-17's**, reserved there for the reason `configure` is: an
owner reading a consumer's Descriptor has to be able to tell which Action is the nudge, and a name
two parties agreed between themselves is not something a Descriptor can carry. It recommends rather
than binds because a Worker that reads only on a nudge is one dropped request away from stalling
silently: the schedule is what the design rests on, and a consumer that declares no nudge is slower
and never wrong.

## Why there is no lease here

**A Claim was an exclusive lease on a Task, and it is withdrawn.** Sixteen rules went with it: the
grant and its refusal, the expiry and the clock that decided it, the renewal, the outcome, the
fencing token, the counts of Claims that had failed and lapsed, the identifier of whoever held one,
the claim by type, and the header an Action named its Claim in. What is left is the list and the
condition, which is what the rest of this file has always been about.

**The argument that decided it is one this specification already made about itself.**
[spec/README.md](README.md) names orchestration a non-goal — *no workflow, no routing, no
scheduling, no retry policy beyond the class an answer carries* — and a lease over a unit of work
is the primitive of a work queue. The counts with a cap past which an owner stopped granting were
a retry policy under another name. It was the one place this protocol did the thing it says it does
not do.

**What it cost fell on the party least likely to need it.** A Worker that raises a Task had to
stand up a claim address, a lease clock and a store durable enough to settle contention — on a
platform where that means a durable object or a table — whether or not anybody was competing for
its work. Meanwhile the consumer's side was already optional: an Action performed without naming a
Claim was a performance this file said nothing about, so a consumer could ignore the whole
mechanism and the owner still paid for it.

**And the thing it bought is the one thing a consumer can do for itself.** Two people in one teams
app who must not both drive to the same vehicle are two people in one application, which locks
locally without the owner participating. The case that genuinely wanted a lease is narrower than it
looks: several *independent* consumers, under different Contracts, competing for one Task type. No
deployment has met it yet, and meeting it is what an edition is for — the rules come back with new
ids, argued from something that happened rather than from something imagined.

What is lost and should be said rather than glossed: an owner can no longer tell that work is
*being done* as against *not yet started*, and cannot count what was attempted and failed. TASK-28's
instant is what replaced both, and it is weaker: it says how long a condition has held and not what
anybody did about it.

## Still open here

- **Who verifies that a Worker answers the Task types it declares under TASK-29.** The Tower at
  registration, the owner at claim time, or nobody. Open in [undecided](../docs/undecided.md).
- Whether a Task may carry a deadline of its own.
- **Whether a consumer can say it is working on something, without a lease.** An advisory note on
  a Task would answer most of what the counts answered and none of what the lease did. It is not
  written because nothing has asked for it, and because the shortest road back to a lease is a
  field that is nearly one.
- What a consumer reports about the cost and elapsed time of the work it did, and who consolidates
  it. Open in [undecided](../docs/undecided.md).

## Withdrawn

- **TASK-3** — required the list inside the `tasks` entry, under `answers`. Replaced by
  **TASK-29**, which moves it to the Descriptor's root and calls it `skills`. An entry carrying
  `answers` satisfied TASK-3 and does not satisfy TASK-29, so the verdict moves and the id did not
  survive.

  Two things were wrong and only one of them was the name. *Answer* had three jobs in this file and
  could not keep them apart: a read **answers** Tasks (TASK-5, TASK-27), which is a response; a
  raised type names the Actions that may **answer** it (TASK-2, `answeredBy`), which is resolving a
  condition; and the entry declared what the Worker **answers**, which is neither — it is a
  standing capability, true before any Task exists and before anybody asks. TASK-3's own sentence
  already named that one: *which is its Skill*. The other two senses stay, because they are what
  the word means and they are told apart by what they are about.

  The second was the place, and it is the one a reader trips over rather than argues with. A Skill
  has no surface. Putting it in a Capability entry filed *what a Worker is* under *what a Worker
  serves*, and charged a Worker that only answers Tasks a whole `tasks` Capability — address
  included — for the privilege of serving nothing at it.

**Sixteen rules of the Claim lifecycle, withdrawn together, for the argument above.** They are
listed individually rather than summarized because a report citing one of them stays true about the
rule it cited, and because a reader who built against them is owed the specific sentence that is
gone.

- **TASK-9** — a claim was a POST to the claim address naming the Task, answering a Claim with its
  id, its Task and the instant its lease expired.
- **TASK-10** — a claim of a Task already claimed was `409` with `conflict`.
- **TASK-11** — a claim of a Task the Worker would not currently grant a lease on was `409` with
  `conflict`, and `claimable` on the Task was where an owner said so.
- **TASK-12** — the owner set the lease, its expiry travelled as an RFC 3339 instant, and this
  protocol fixed no duration.
- **TASK-13** — a holder renewed by naming the Claim with no outcome.
- **TASK-14** — a holder closed its Claim by declaring `done`, `failed` or `released`.
- **TASK-16** — a Response was two calls, the Action into the owner and then the outcome on the
  Claim, and they were not atomic. Answering a Task is now one call, which is ACT-5.
- **TASK-17** — a call naming a Claim that was no longer the Task's current one was `409`. The
  Claim id was the fencing token.
- **TASK-18** — the owner's clock decided, and no party computed whether a lease was still held by
  comparing an instant against a clock the owner never saw. Nothing compares clocks any more.
- **TASK-20** — a holder named its Claim in the `Worker-Protocol-Claim` header of the Action. The
  header is withdrawn with it and [endpoints](endpoints.md) is back to the three it fixes.
- **TASK-21** — an Action carrying that header was refused before anything was performed where the
  Claim was not current or its Task's type did not list the Action. The second clause is the one
  loss worth naming: nothing now binds that an Action answering a Task is one TASK-2 listed,
  because nothing on the wire says which Task an Action answered.
- **TASK-22** — a Claim stayed its Task's current one after the Task's condition stopped holding.
- **TASK-23** — the entry declared in `claimByType` whether a claim could name a Task type.
- **TASK-24** — a claim naming a type granted a lease on one claimable Task of it and answered the
  Claim with that Task in `held`; nothing claimable was `204`.
- **TASK-25** — a holder could propose a lease duration, which bound the owner to nothing.
- **TASK-26** — a Task under a Claim carried `holder` to a credential recorded at enrollment.

Two more are withdrawn because what they required is narrower now:

- **TASK-1** — required a `tasks` entry to declare **two** addresses, one read and one a claim was
  posted to. Replaced by **TASK-27**, which requires the reading address alone. An entry declaring
  only one failed TASK-1 and satisfies TASK-27, so the verdict moves and the id did not survive.
- **TASK-7** — required each Task to carry its id, type, payload, how many Claims had failed, how
  many had lapsed, and whether it could be claimed. Replaced by **TASK-28**, which requires the
  id, the type, the payload and the instant the condition began. Three of those members no longer
  exist and a fourth is new, so no Task conformant under one is a document the other accepts.

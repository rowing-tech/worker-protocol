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

**TASK-32 (required). The entry declares every Task type the Worker raises, keyed by name, each
with the schema of its payload and the one Action of its own that answers it. Where a Task can end
more than one way, the ways are variants of that Action's input, told apart by a discriminator.**

**TASK-31 (required). The Descriptor declares under `skills`, at its root and not inside a
Capability, the Task types the Worker answers — which is its Skill. It is a map keyed by Task type,
as `raises` is, and each entry may declare two JSON Schemas: the payload that Worker requires in
order to answer one, and what it produces in answer. A Worker with no Skill omits `skills`; a Skill
that states neither is a claim of capability and nothing more.**

**TASK-4 (required). A Task type is a qualified name under NAME-7.**

TASK-32 names *one of the owner's own Actions*: answering a Task is performing it, so it is
declared in that same Worker's `actions` entry and named here by its name. A Task type that names an
Action the Worker does not accept is a Descriptor disagreeing with itself, which is the fault
DESC-18 already describes one level up.

**One Action and not a list, and the outcomes go inside it.** A Task that can end several ways — the
vehicle was found and checked, the vehicle was not where it should be — used to name one Action per
ending, and that put the mapping between *what a consumer produces* and *which Action takes it*
nowhere anybody could declare it: the answerer does not know the owner's Action names, and the type
has no registry to fix them in. With one Action, there is nothing to map. The endings are variants
of its input, a discriminated union whose discriminator is the ending's name, minted by the owner
beside the payload where every other name of that type already lives. A consumer that can produce
one variant is answering a subtype of what the Action takes, which is ordinary assignability and
needs no rule of its own; a Tower reading both schemas can see which endings it will never report.

**What the name does not do is bind on a call, and that is worth saying plainly.** A Worker cannot
tell an Action performed *because of* a Task from one performed for any other reason: the two are
the same request. The name tells a consumer what would answer, and nothing refuses a performance
that answers nothing.

TASK-31 is the other side of the same name, and it is what makes the
[architecture](../docs/architecture.md)'s *unit of discovery* concrete: the Tower catalogs Workers
by the Task types they answer, so a Worker that answers `tech.rowing.fleet.verify-vehicle` says so
where every reader already looks. Both lists are drawn from one vocabulary, and NAME-7 reaches both
for the same reason — `raises` says *I need this done* and `skills` says *I can do this*, and the
two are joined by a party that met neither.

**The answerer declares both halves of the exchange from its own side, and neither is a copy of
the owner's.** A Task travels one way and its answer travels back, so there are two documents and
two questions. Under `raises` the owner says what it *sends*; under `skills` the answerer says what
it *needs to receive* in order to act — and it is the answerer who knows that, because it is the one
who has to act on it. Under `actions` the owner says what its answering Action *takes*; under
`skills` the answerer says what it *produces* — and again it is the answerer who knows, because a
Worker that can tell you where a vehicle is may have no way of knowing whether it is reachable.
NAME-6 says which way to judge each pair: a document is judged against the party that sends it. So
a Tower holding both Descriptors answers the question an operator asks at enrollment — *can this
Worker take that one's Tasks?* — on both halves, before any Task exists, and asks again on every
poll so that an owner that changes either shape is caught before work is handed over.

**Why the answerer declares what it produces rather than the type fixing it.** A Task type is a
name shared across owners, and it would be tidier if the type fixed the answer's shape so that one
consumer served every owner unchanged. It cannot, here: this protocol keeps no registry of Task
types, on purpose, so there is nowhere for a shape to be fixed that is not one owner's `raises` —
and a shape each owner writes for itself fixes nothing across them. What the answerer's own
declaration buys instead is the true answer to a true question: two owners of one type that ask for
the same fact under different names *are* asking for different documents, and a consumer that can
produce one and not the other should be told so rather than paired with both.

**What that establishes, and what it does not.** That the shapes agree is checkable, and it is the
difference between *the names matched* and *this Worker can understand the work*. That the Worker
will then *do* the work is not something any declaration can promise, and this file does not
pretend one can: what remains is to hand it a Task and see whether the Action arrives, which is what
the verifier already does under an arrangement, and to read its [activity](activity.md) and watch
the owner's Task close. A Worker's Skill says what it needs; its record says what it did.

The answerer's schema may ask for less than the owner sends — a consumer that needs one field of a
ten-field payload declares one — and every document the owner produces then satisfies it. It may
not ask for more, and a Tower that finds it asking for more has found the answer to the question.

**Both schemas are optional, and leaving one out means what it says.** A Worker that states
neither has claimed it answers the type and claimed nothing about how, which is where this protocol
stood before the field existed and is still a conformant thing to say — a Worker that takes
whatever arrives has no requirement to state, and inventing one so that a field is filled would be
a declaration written to satisfy a schema rather than a reader. What it costs is the check, half by
half: a Tower reads a name it can catalog and has nothing to compare on that side, so that half of
the pairing is judged when the work arrives rather than when the operator asked. That is the trade,
and it belongs to the Worker that made it.

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
TASK-31 is a root field and DESC-2 already has a Worker leave out what it does not implement. What
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

**TASK-19 (recommended). A nudge is one call from an owner to a consumer that can answer a Task
type, saying that there is work of that type and nothing else. [nudges](nudges.md) fixes the
surface; this rule fixes that it is best effort and that nothing follows from it.**

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
the protocol that runs from an owner *to* a consumer without the machinery such a direction would
otherwise need — no delivery guarantee to specify, and nothing a receiver holds afterwards.

It was an Action until this edition, declared by the consumer under a name reserved for it, and
[nudges](nudges.md) carries the argument for giving it an address of its own: a nudge's body is
fixed *here* and not by the Worker, which is the one thing an Action's input may not be. It
recommends rather than binds because a Worker that reads only on a nudge is one dropped request
away from stalling silently: the schedule is what the design rests on, and a consumer that declares
no nudge is slower and never wrong.

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

- **Who verifies that a Worker answers the Task types it declares under TASK-31.** The Tower at
  registration, the owner at claim time, or nobody. Open in [undecided](../docs/undecided.md).
- Whether a Task may carry a deadline of its own.
- **Whether a consumer can say it is working on something, without a lease.** An advisory note on
  a Task would answer most of what the counts answered and none of what the lease did. It is not
  written because nothing has asked for it, and because the shortest road back to a lease is a
  field that is nearly one.
- What a consumer reports about the cost and elapsed time of the work it did, and who consolidates
  it. Open in [undecided](../docs/undecided.md).

## Withdrawn

- **TASK-2** — required the same declaration with a *closed list* of Actions that may answer the
  type. Replaced by **TASK-32**, which names one Action and puts a Task's several endings inside its
  input as a discriminated union. An entry carrying a list satisfied TASK-2 and does not satisfy
  TASK-32, so the verdict moves and the id did not survive.

  The list was the natural first shape and it broke on the first question anybody asked of it. Once
  an answerer could declare what it produces (TASK-31), the question became *which of the N Actions
  does that fit* — and there was nowhere to answer it: the answerer cannot name the owner's Actions,
  and this protocol keeps no registry of Task types to fix outcome names in. Every option for
  declaring the mapping was a copy of something that could drift. One Action dissolves it: the
  endings are variants of one schema, the discriminator is the owner's own word for each, and
  covering some of them is a subtype of covering all — which is a fact about schemas, not a rule.

- **TASK-30** — required the same map, each entry able to declare the payload it requires. Replaced
  by **TASK-31**, which lets an entry also declare what it produces in answer. A Descriptor that
  declared `produces` was refused under TASK-30 and is accepted under TASK-31, so the verdict moves
  and the id did not survive.

  It declared one half of an exchange that has two. Knowing that a Worker can read a Task says
  nothing about whether it can produce the answer the owner's Action takes — a Worker that knows
  where a vehicle is may have no way to know whether it is reachable — and the question a Tower is
  asked at enrollment is whether the pairing works, not whether half of it does.

- **TASK-29** — required the same declaration, at the same place, as a list of Task type names.
  Replaced by **TASK-30**, which makes it a map keyed by Task type. A Descriptor carrying an array
  satisfied TASK-29 and does not satisfy TASK-30, so the verdict moves and the id did not survive.

  It was withdrawn before anything was built on it, and the reason is the one it now prevents. A
  Skill carries no declaration today, and a bare list is the right shape for that — right up to the
  first thing anybody wants to say about one, at which point the list has to become a map and every
  Worker that ever declared a Skill rewrites its Descriptor. The [Control
  Tower](../docs/architecture.md) is what this protocol is for and it does not exist yet; writing
  Workers now against a shape that is known to move when it arrives is a bill sent to the people
  this specification is trying to help. The map is what let the value arrive — the payload the
  answerer requires — without the list having to become something else first.

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

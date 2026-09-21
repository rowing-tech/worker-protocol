# Nudges

`draft`

One call, from a Worker that raised a Task to a Worker that can answer it, saying only that there
is work of a type. It carries no Task, no payload and no guarantee.

## Why this is its own surface

It was an Action until this edition, declared by the consumer and reserved under a name so that an
owner could find it. That was the cheap arrangement rather than the right one, and what it cost is
easiest to see in [actions](actions.md)'s own words: **ACT-2 exists so that a console renders a form
from a schema it did not author, and the schema is the Worker's own — this protocol has no data
model.** A nudge's body is fixed by TASK-19 and not by the Worker, so it was the one entry in that
catalog whose shape its declarer did not choose. Three things followed and all three were real.

Every Worker that wanted to be told wrote out a schema the protocol had already fixed, and a change
to what a nudge carries would have had to be made again in every one of them. A console rendering
the Actions a Worker accepts offered it as a button beside the operations a person actually
performs, which no person presses. And a verifier could not check that the declared shape was the
one TASK-19 fixes, because nothing in an `actions` entry says which names are the protocol's.

So it is an address and nothing more, which is the shape [alerts](alerts.md) and
[activity](activity.md) already have. The Worker declares where; this file fixes what arrives, and
nobody writes it down twice.

The declaration is [schemas/nudges-entry.json](../schemas/nudges-entry.json) and one nudge is
[schemas/nudge.json](../schemas/nudge.json). Rules carry ids and a class; the convention is in
[spec/README.md](README.md).

## What a Worker declares, and what a call carries

**NDG-1 (required). A `nudges` entry declares an address.**

**NDG-2 (required). A POST to that address carries one Task type and nothing else, and is answered
`204`.**

**NDG-3 (required). A Worker accepts a nudge for a Task type it declares under `skills`, and
refuses any other with `404` and the code `not_found`.**

Declaring it is optional, and the whole of what it buys is latency. TASK-19 is where that argument
lives and it recommends rather than binds: a consumer read on its own schedule is slower and never
wrong, and one that reads only when told is a single dropped request away from stalling silently.

**`204` and not a body, because there is nothing to say.** The receiver has not accepted the work,
has not promised to do it, and has not looked yet — it will read the Tasks at the address that
raised them, exactly as it would have on its next schedule. A status that carried a Task's id or a
promise to attempt it would be the receiver holding state about work it has not seen, which is the
lease [tasks](tasks.md) withdrew arriving through another door.

NDG-3 is the one obligation here a verifier can provoke without changing anything — the nudge it
sends is refused, so nothing happened — and it is a rule rather than taste because the alternative
is worse than silence: a Worker that took a nudge for a type it does not answer would be telling an
owner it had been told, and the owner would stop nudging whoever could actually help. A `404` says
*not me* in the vocabulary [endpoints](endpoints.md) already fixes for an address that does not
serve what was asked.

**The body carries the type and not the Task, and TASK-15 is why.** The owner is authoritative over
whether the condition still holds, so a Task in flight is a claim that may be false by the time it
lands. The receiver reads, and what it reads is true when it reads it.

## What this file does not fix

**Who may send one, which is not a rule here because it is already one elsewhere.** A nudge is
answered under the credential the Worker was enrolled with, exactly as every other address this
protocol defines is: REG-3 fixes how a credential is presented and REG-21 has a Worker accept the
recorded one everywhere, and a nudge address is one of them. Writing that down again as an NDG rule
would put a second copy of REG-21 in the register, to be checked twice and to disagree with itself
the day one of them was edited. Which owners may nudge which consumer is a Contract's business,
which is where every other *may this party call this address* question already lives.

**How an owner learns whom to nudge.** It reads a Descriptor: a Worker that declares `nudges` and
carries the Task type under `skills` is one that can be told. A Tower catalogs both already, and
`packages/client`'s `canAnswer` is what compares the rest of the pairing.

**How often, or whether at all.** A nudge is best effort by construction and an owner that never
sends one is conformant. Rate, batching and back-off are an owner's own business, and a Contract's
where two parties have agreed something.

## Still open here

- Whether a nudge may carry the id of the Task it is about, as a hint rather than a payload. It
  would spare a reader one list, and it reintroduces the question of what a receiver does with an
  id whose condition has stopped holding.

## Withdrawn

Nothing yet.

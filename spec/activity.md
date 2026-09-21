# Activity

`draft`

What a Worker is doing, and what it has undertaken to do. Read beside health, metrics and Alerts,
and answering the one question about a Worker those three do not: *what are you working on?*

## Why this file exists

Treat a Worker as you would a person you hired. Health says whether they turned up. Metrics say what
they got done last week. Alerts say what they want you to notice. None of them answers what any
manager asks first — *what are you on right now, and what is in your queue* — and until this file
there was nowhere in the protocol for a Worker to say so.

The need is plainest on the consumer side. A Worker contracted to scrape three sites every six
hours, or to compress the large files in a folder every night, or to take the Tasks a fleet tracker
raises and go and look at the vehicles — each of these has *taken on* something, and whoever gave
it the work wants to know that it did. Metrics will say so afterwards. Settings say what was asked.
Neither says what the Worker has actually undertaken, which is a Fact only the Worker holds and the
one this surface exists to read.

**This is not the Claim that [tasks](tasks.md) withdrew, and the difference is the direction.** A
Claim was the *owner* of a Task holding a lease on behalf of a consumer: who has it, until when,
under what token — state whose authority the owner had given away, and the primitive of a work
queue, which is orchestration and a named non-goal. An activity is the *consumer* reporting what it
itself holds. Nobody assigns, nobody locks, nobody is granted anything: the Worker derives the list
from its own Facts and is the only party that could. It is the same shape as every other surface
here, and it happens to give back most of what the Claim was ever wanted for — visibility — without
the part that made it wrong.

## Whether this is a kind of Task, or an Alert, or a metric

Against [tasks](tasks.md): a Task is a condition that requires *somebody else's* Action, exposed so
that a party holding the Skill can come and answer it. An activity is the opposite direction — work
this Worker has taken on, which nobody else answers. Putting both under one noun is the ambiguity
this file was written to remove: a reader asking *whose tasks are these* has already been told the
wrong thing.

Against [alerts](alerts.md): an Alert is a condition an operator *should act on*. An activity is
normal. A Worker with forty items pending is a Worker doing its job, and raising an Alert about
each would be a Worker crying wolf about being busy. Where a backlog *is* a problem — it stopped
draining, it grew past a bound — that is an Alert, and the Worker raises one beside its activity.
What the two share is everything about shape, which is why the rules below read like ALRT-2 to
ALRT-6 with the words changed.

Against [metrics](metrics.md): a metric is accumulated over a period and says what *was*. An
activity is a list of what *is*. A Worker that compressed fourteen files last night has a metric;
a Worker compressing the third of fourteen right now has an activity.

The declaration is [schemas/activity-entry.json](../schemas/activity-entry.json) and one activity
is [schemas/activity.json](../schemas/activity.json). Rules carry ids and a class; the convention is
in [spec/README.md](README.md).

## What a Worker declares, and what a read answers

**ACTV-1 (required). An `activity` entry declares an address.**

**ACTV-2 (required). A read of that address answers the activities the Worker holds — what it is
doing and what it has undertaken to do — in the page envelope of ENDP-20.**

**ACTV-3 (required). Each activity carries its id, its state, the instant it entered that state,
and a human-readable summary.**

**ACTV-4 (required). State is `scheduled`, `pending` or `running`, and this edition defines no
fourth value.**

The summary is human-readable and nothing parses it, for the reason ALRT-3's is not: the reader
this surface exists for is a person looking at a console, asking what a Worker is doing. What a
program acts on is the state, which is a closed vocabulary a console renders without knowing
anything about the Worker.

**Three states and not two, and this time the argument is [health](health.md)'s rather than
[alerts](alerts.md)'.** Alerts hold to two severities because the only decision an operator takes
from the field is whether to look now, and a third value would be a place to hedge. Here there are
three decisions, and each has a state with no honest spelling in the other two. A Worker that will
compress a folder at midnight and a Worker with four hundred items waiting in a queue are both *not
running*, and collapsing them would make an operator unable to tell *backing up* from *waiting for
its time*, which is exactly the thing they came to find out. So: `scheduled` is undertaken for a
later moment the Worker knows, and nothing is wrong. `pending` is undertaken and waiting to start,
and the length of that list is what an operator watches. `running` is under way.

The instant is when the activity entered its current state, and it is read the way TASK-28's and
ALRT-3's are. For `running` it is when work began. For `pending` it is when the item joined the
queue, which is what makes a stuck one visible. For `scheduled` it is when the Worker undertook the
commitment — *you gave me this three days ago* — and not when it will next run, which is a fact
about the future this file declines to fix and says why below.

## How an activity ends

**ACTV-5 (required). An activity ends when the Worker stops holding it. No party declares that, and
a Worker exposes no way to.**

An item that has finished, failed, or been dropped is gone from the list, and what became of it is
not this surface's to say: what a Worker *did* is a metric, and what it *published* about doing it
is an event. Carrying `done` and `failed` here would have made this a job log, with a retention
question, a paging question and a state machine, when the question it answers is only ever asked
in the present tense.

This is ALRT-5 and TASK-15 for the third time, and the argument does not change: the Worker
derives the list from its own Facts, so a party declaring an item over would be telling the Worker
something about that party.

## Who may read it

**ACTV-6 (required). A Worker answers the same activities to every caller it authenticates.**

The party this surface is for is whoever operates the Worker, and that is enrollment rather than a
Contract — ALRT-6's reasoning one surface along. A consumer under a Contract has no business
knowing what else the Worker is busy with, and may hold no credential for this address at all.

## What this file does not fix

**An activity carries no type and no payload, and that is deliberate for now.** A Task's payload
has a shape because its type declared one under `raises`; an activity declares no types, so a
payload here would be JSON nobody outside the Worker could validate or render — a place to put
anything, which is the thing [alerts](alerts.md) argues a protocol must not offer. When a Tower
needs to correlate activity by content rather than by id and summary, the addition is a declared
type with a schema, and it is listed below as open so that it arrives with a shape rather than as a
blob.

**A `scheduled` activity says nothing about when it will next run.** *When* is scheduling, and
scheduling is a named non-goal. The summary may say *nightly at 00:00* for a person; nothing here
carries it for a program.

**What a Worker counts as an activity is its own business.** One item per file or one for the
folder; one per Task taken or one per owner polled; nothing here enumerates kinds, requires a
minimum, or says a Worker has any. A Worker that holds nothing answers an empty page and is
conformant, exactly as one raising no Alerts is.

## Still open here

- Whether an activity may carry a type declared in the entry with the schema of a payload, as
  `raises` does for a Task type, so that a console can render it and a Tower correlate by content.
  Nothing needs it yet, and a payload without a declared schema is a blob.
- Whether an activity may name the Task it is answering — the owner's id and the Task's — so that a
  Tower can join what one Worker raised with what another has taken on, without either holding a
  lock. It would recover the last of what the Claim was wanted for. Nothing needs it yet.
- Whether `scheduled` may carry the instant it will next run. It is scheduling, and the non-goal
  says no; the summary carries it for a person until something shows that a program needs it.

## Withdrawn

Nothing yet.

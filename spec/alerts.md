# Alerts

`draft`

Conditions an operator should see, exposed beside the Tasks. An Alert may carry Actions and
requires no Skill.

## Whether this file should exist at all

It was open whether an Alert is a surface of its own or a kind of Task, and the answer decides
whether there is anything here. **It is a surface of its own, and the reason is that neither of the
two surfaces it could have folded into answers the question an Alert asks.**

Against [health](health.md): health answers *can I be relied on*. A Worker whose credential expires
in three days can be relied on completely, and saying `degraded` about it would be a lie told to
every poller in order to reach one operator. Fold Alerts into health and a Worker must either
misreport its own state or never mention the thing a person has three days to fix.

Against [tasks](tasks.md): a Task is delegation, and an Alert delegates nothing. A Task requires a
Skill and is discovered by it — TASK-3 makes the Task types a Worker answers the unit a Tower
catalogs by — and an Alert has no Skill, because its audience is whoever operates this Worker and
that is a relationship of enrollment rather than of Contract. TASK-6 follows from the same place: a
Task is shown only to the consumer whose Contract covers it, where ALRT-6 answers the same Alerts
to every caller the Worker authenticates, and the difference is not a detail — it is which party
the surface is for.

Folding them would therefore have meant a Task type carrying an exception to the rules that make a
Task a Task, which is how you can tell it is a different thing. What it borrows instead is the one
idea that does transfer, and ALRT-5 is where.

*This argument used to rest on a third leg: that a Task was claimed under an exclusive lease and an
Alert two operators can both see is working. The lease is withdrawn, and the leg with it. What is
left carries the weight on its own, which is worth saying rather than leaving somebody to notice
that a paragraph lost a third of its reasons and kept its conclusion.*

The declaration is [schemas/alerts-entry.json](../schemas/alerts-entry.json) and one Alert is
[schemas/alert.json](../schemas/alert.json). Rules carry ids and a class; the convention is in
[spec/README.md](README.md).

## What a Worker declares, and what a read answers

**ALRT-1 (required). An `alerts` entry declares an address.**

**ALRT-2 (required). A read of that address answers the Alerts whose conditions hold, in the page
envelope of ENDP-20.**

**ALRT-3 (required). Each Alert carries its id, its severity, the instant its condition began, a
human-readable summary, and the Actions it offers — which may be none.**

**ALRT-4 (required). Severity is `warning` or `critical`, and this edition defines no third value.**

**ALRT-7 (required). The Actions an Alert offers are the Worker's own, named as its `actions` entry
holds them. Performing one is ACT-5 with nothing added.**

The summary is human-readable and nothing parses it, for the same reason a health check's detail is
not parsed: the reader this surface exists for is a person looking at a console. What a program
acts on is the severity and the Actions, and both are closed vocabularies a console can render
without knowing anything about the Worker.

**Two severities and not three, which is the opposite of what [health](health.md) does, and the
contrast is the argument.** `degraded` earns its place there because a Worker that works with one
dependency down would otherwise have to lie in one direction or the other — a real state with no
honest spelling. Here there is no such gap: the only decision an operator takes from this field is
whether to look now or look later, and a third value would be a place for a Worker to hedge rather
than a state it needed to express. A protocol that offers a middle value gets middle values.

ALRT-7 is TASK-2's agreement in the other Capability, and it is checked the same way: an Alert that
offered an Action its own `actions` entry does not accept would be a Descriptor disagreeing with
itself, which is DESC-18 one level down. It carries names and not schemas because the schema is
already in the `actions` entry, and a second copy is a second thing to keep in step.

## How an Alert ends

**ALRT-5 (required). An Alert ends when its condition stops holding. No party dismisses one, and a
Worker exposes no way to.**

This is the one idea Alerts borrow from Tasks, and TASK-15 already carries the argument: the Worker
derives the condition from its own Facts, so a party declaring it over is telling the Worker
something about that party. A dismissible Alert is state the Worker holds on behalf of a console;
two consoles then disagree about whether it was dismissed, and neither is wrong.

**What an operator actually wants — to stop being shown a thing they have already seen — is real,
and it belongs to the console.** The console knows who dismissed what and until when, because it
knows who is looking; the Worker knows only that the condition still holds, which is the truth and
is all it is authoritative over. Put the snooze in the Worker and it becomes a per-viewer preference
stored by the one party with no idea who is viewing.

The instant in ALRT-3 is what makes that bearable rather than merely principled. A console that
knows when a condition began can sort by it, group by it, and tell *this is new* from *this is the
same thing as yesterday* — which is most of what dismissal was being asked to do.

## Who may read them

**ALRT-6 (required). A Worker answers the same Alerts to every caller it authenticates.**

**Reading Alerts needs no Contract, and that settles the second question this file was asked.** A
Contract is made over a Service — its Events, its Task types, its Actions — and an Alert is none of
those. The party an Alert is for is whoever operates the Worker, and that relationship is
enrollment: REG-21 already has a Worker accept the recorded credential on every address this
protocol defines, and this is one of them.

ALRT-6 is REG-8's reasoning one surface along. A list filtered per reader is a different document to
every reader, and an operator comparing notes with a colleague has no way to tell a condition that
cleared from one they were not shown.

## What this file does not fix

**An Alert is not where a consumer learns that a declared schema changed**, and saying so closes a
question [naming](naming.md) parked until this file existed. Alerts are read by whoever operates a
Worker; a consumer under a Contract is not that party and may hold no credential for this address
at all. The loud discovery naming.md describes — a `400` naming the version, under ENDP-6, with
ENDP-5's headers on every response — remains the whole of what a consumer gets, and it remains
sufficient for the reason given there: it arrives on the next call, which is before any harm.

**What a Worker raises an Alert about is its own business.** Nothing here enumerates conditions,
requires a minimum set, or says that a Worker has any. A Worker that raises none answers an empty
page and is conformant, exactly as one reporting no health checks is.

## Still open here

- Whether an Alert may name the metric or the check it is about, so that a console can link them.
  Nothing needs it yet and a reference that could dangle is worse than none.
- Whether a Worker that has raised the same Alert repeatedly exposes that count. ALRT-3's `since`
  says how long this one has held and nothing about the ones before it.

## Withdrawn

Nothing yet.

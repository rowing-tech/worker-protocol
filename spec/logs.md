# Logs

`draft`

What a Worker recorded while it was working, most recent first. Read beside health, metrics, Alerts
and activity, and answering the one question those four cannot: *what happened?*

## Why this file exists

**Until this file, nothing in this protocol answered in the past tense**, and that is a structural
hole rather than a missing convenience. Health is now. An activity is now, and vanishes when the
Worker stops holding it (ACTV-5). An Alert is now, and ends when its condition stops holding
(ALRT-5). A Task is now, for the same reason (TASK-15). A metric is an aggregate and a number never
says which occurrence it counted. An event is pushed to whoever contracted for it and is gone.

So a Worker could say what it is doing, what it wants looked at, what it needs done and how much it
managed — and nothing about anything that had finished. Every one of those surfaces is a summary,
and the moment a summary is not enough the operator's next question had no address here at all.

[activity](activity.md) names the hole in passing and declines it. ACTV-5 refused to carry `done`
and `failed` because doing so would have made that surface *a job log, with a retention question, a
paging question and a state machine*. All three of those questions are real, and this file is where
they are answered rather than answered badly somewhere they do not belong.

**What this surface gives an operator is less than the other eight give, and that is worth saying
plainly.** Every one of them carries a closed vocabulary a program acts on — a status, a severity, a
state, a unit, a granularity, a type — so a console does something with the answer. A record carries
a level and then text, and nothing outside the Worker will ever parse the text. One console over
Workers on three platforms is what this protocol is for; here that buys one place to *read* rather
than one place to *act*. It is still worth having, and it is not the same purchase.

**The objection to a `logs` Capability is that every platform already has one, and it is the same
objection [metrics](metrics.md) already survived.** Prometheus exists; so does every log pipeline a
deployment already runs. What neither gives an operator is one console over Workers that are not on
one platform. A fleet of ten Workers across three hosts is ten dashboards and ten credentials before
this surface and one after it, and that is the whole of the argument — the same one that puts health
and metrics here, applied to the surface with the largest volume and therefore the highest cost.

**It is also the surface where a Worker is most likely to publish something it did not mean to.**
Payloads, credentials, a customer's name: the things that end up in a log line are exactly the
things a Worker holds and does not serve. This specification states no rule about what goes into a
record, because nothing outside the Worker can observe the difference between a message that leaked
something and one that did not — and a rule whose violation looks exactly like compliance is an
opinion with an id.

What it says instead is where the records come from and who they are for: a Worker writes them
deliberately, and they are the operator's. Both are below, under who may read it.

## Whether this is an Alert, or activity, or metrics, or an event

Against [alerts](alerts.md), which is the pair to get wrong and the reason this contrast comes
first. Start with the case that overlaps nothing: *twelve files compressed* is a record, and there
is no reading of it that is an Alert. It is not a condition, it does not hold, nobody is meant to
act on it, and an Alert is never good news — the word means what it means. **Half of what a Worker
is worth recording is nothing going wrong at all**, and a surface for conditions an operator should
act on has no place to put any of it.

Where the two do overlap is on failure, and there the difference is whether it is still true. An
Alert is a condition that **holds**: it exists while it is, it ends when it stops (ALRT-5), nobody
dismisses one, and it offers the Actions that answer it. A record is over. It offers nothing and it
does not go away when the situation improves. *The outbox has forty events waiting* is an Alert —
still true, and there is something to do about it. *The broker refused `e-91` at 14:03* is a
record: it happened, it is finished, and an operator reading it is working out why the Alert
exists.

The test, for a Worker author choosing: **if it stops being true on its own, it is an Alert.** A
Worker that writes a record every time a condition starts holding has built a worse Alert, and one
that raises an Alert for something already over has built a condition nothing can clear.

Against [activity](activity.md): an activity is what the Worker holds *now*, and it disappears when
the Worker stops holding it. A record here is what happened, and it does not change afterwards. A
Worker compressing the third of fourteen files has an activity; the line it wrote when the second
one failed is a record.

Against [metrics](metrics.md): a metric is accumulated and says how many. A record is one occurrence
with its own text. *Fourteen uploads failed last night* is a metric; *upload of `a.pdf` failed on
the third attempt* is a record, and an operator needs the second to act on the first.

Against [events](events.md): an event is a Fact this Worker publishes to whoever contracted for it,
in an envelope other parties parse. A record is written for a person and nobody contracted for it.
The direction is what separates them — an event is pushed to a subscriber, a record is read by an
operator who came looking.

The declaration is [schemas/logs-entry.json](../schemas/logs-entry.json) and one record is
[schemas/log-record.json](../schemas/log-record.json). Rules carry ids and a class; the convention
is in [spec/README.md](README.md).

## What this takes from OpenTelemetry, and what it does not

There are two standards for what a log record is, and they agree. Syslog (RFC 5424) carries a
timestamp, a severity, a message and `STRUCTURED-DATA` — key and value, flat, strings. The
OpenTelemetry log data model carries `Timestamp`, `SeverityText` with a `SeverityNumber` beside it,
`Body`, and `Attributes`. Same four things, twice, arrived at independently. **This file takes that
model and does not invent a fifth thing**, and the level vocabulary of LOG-5 is the intersection of
OpenTelemetry's short names with what a runtime's `console` actually emits.

| Here | OpenTelemetry | Why the spelling differs |
|---|---|---|
| `at` | `Timestamp` | RFC 3339 with an offset, as every other instant in this protocol already is |
| `level` | `SeverityText`, and `SeverityNumber` 5, 9, 13, 17 | The four a `console` emits, named rather than numbered |
| `message` | `Body` | A string, where OpenTelemetry admits structure — see below |
| `fields` | `Attributes` | Flat, which is what syslog allows and what a console renders |

**What it does not take is OTLP as the wire format, and the reason is that nothing would consume
it.** An OpenTelemetry collector receives a push; it does not page an HTTP surface with a cursor. So
adopting `{"key":"file","value":{"stringValue":"a.pdf"}}` and `timeUnixNano` as a string of
nanoseconds would buy the appearance of interoperability and none of the substance, while making
this the one surface in the protocol whose instants are spelled differently from every other, and
putting `resourceLogs` and `scopeLogs` where ENDP-20 already fixes an envelope.

A deployment that wants these records in an OpenTelemetry backend sends them there directly, from
wherever the Worker already writes them. That is a different consumer with a different transport,
and serving both from one shape would serve neither. The table above is what makes the two cheap to
hold together: the mapping is mechanical and nobody has to argue about it.

## What a Worker declares, and what a read answers

**LOG-1 (required). A `logs` entry declares an address.**

**LOG-2 (required). A read of that address answers the records the Worker holds, in the page
envelope of ENDP-20.**

**LOG-3 (required). The order is most recent first.**

**LOG-4 (required). Each record carries the instant it was recorded, its level, and a human-readable
message.**

**LOG-5 (required). A level is `debug`, `info`, `warn` or `error`, and this edition defines no fifth
value.**

The message is human-readable and nothing parses it, for ACTV-3's reason rather than ALRT-3's: the
reader is a person who came looking for what happened. What a program acts on is the level, which is
a closed vocabulary a console renders without knowing anything about the Worker.

**Four levels and not five, and the two that are missing were both dropped deliberately.** `trace`
is below `debug` and no runtime this protocol expects to meet emits it separately. `fatal` is above
`error` and says something a log line cannot establish — that the Worker stopped — which is health's
to answer and is answered there. What is left is the ladder every console filters on. A runtime
whose `console` has a fifth name maps it: `console.log` is `info`, which is the only mapping anybody
needs and the one every implementation makes.

## The instant does not establish the order

**LOG-6 (required). A caller reads the order a page arrives in, and never reconstructs it from the
instant.**

This is ENDP-31's shape — a rule that binds the caller because no Worker can protect it — and it is
here because the instant is not a total order and cannot be made into one. Four lines written inside
one request routinely carry the same millisecond, and a console that sorts by `at` scrambles exactly
the group of lines a reader most needs in sequence. Finer resolution does not fix it: two records
can be written in the same tick of whatever clock the runtime exposes, and a protocol that demanded
otherwise would be demanding a clock rather than a behaviour.

The Worker's own order is therefore authoritative, ENDP-23 already requires it to hold, and ENDP-21
already makes the cursor opaque so that nobody is tempted to build one out of an instant they read
off a page.

## Filters

**LOG-7 (required). A read filters by level with `level`, which answers that level and every level
above it. A value that is not one of LOG-5's four is `400`, with the code `invalid_parameter`.**

**LOG-8 (required). A read narrows to an interval with `from` and `to`, RFC 3339 instants carrying
an offset. `from` is inclusive and `to` is exclusive.**

One parameter and not a set of them, because the filter an operator actually applies is *stop
showing me the ordinary ones*. `level=warn` is that request. Asking for `warn` while excluding
`error` is a request nobody makes, and admitting it would cost a repeated or comma-separated
parameter — a multiplicity convention no other surface in this protocol has, paid for by every
implementer.

The interval is spelled as MET-11 spells one, and it is required rather than optional for a reason
this surface has and the others do not. Without it the only way to reach a moment is to page the
whole feed, and the feed is a window that may drop its oldest records while a caller is paging
through it. Paging to an incident would then be a race the caller loses silently.

## What a read does not promise

**A read answers what the Worker still holds, and nothing here says how much that is.** A Worker
keeps a window — an hour, a day, ten thousand records, whatever its operators chose — and a Worker
that keeps nothing answers an empty page and is conformant, exactly as one holding no activity is.
Fixing a retention would be fixing a cost, and this protocol has no standing to spend somebody
else's storage.

**So the end of this collection means *the end of what I still hold*, and not *the end of what
happened*.** ENDP-20 has the cursor absent at the end; on this surface that absence carries the
weaker meaning, and it has to be read that way. A caller paging backwards through a window that is
being trimmed ahead of it reaches an empty page while records it never saw are still being written
at the other end — and the page it receives is identical to the one it would receive at a true end.

That is stated here rather than signalled in the envelope on purpose. A field that distinguished the
two would have to go in `page.json`, which six other surfaces share and none of the others needs it
for. What the reader gets instead is a defined meaning, which is enough to stop anybody building an
audit trail on top of a surface that was never one.

**Paging a feed that is being written to is ENDP-33's, and it is not this file's.** A record
arriving between two pages must not push one the caller already read into the next — and that is
true of every collection in this protocol, because all of them are derived on each read rather than
held. This file is where it was noticed, not where it belongs: it was written here as a rule of its
own for one edition's draft and moved out before publication, because a rule about the paging
mechanism stated for one surface leaves the other three with the same fault and nothing to cite.

What is worth saying here is only what is particular to a feed: it is the collection that grows
fastest, so it is where an offset cursor is wrong within seconds rather than within days. Ordered
most recent first over a position that only moves backwards, ENDP-33 costs nothing.

## What a record may carry beyond its message

**LOG-9 (required). A record may carry `fields`: a map of one level, whose values are strings,
numbers, booleans or null.**

**This is the payload [activity](activity.md) refused, admitted here on an argument that surface did
not have.** ACTV's objection is sound and unchanged: a payload with no declared schema is JSON that
nobody outside the Worker can validate or render, and a place to put anything is the thing
[alerts](alerts.md) argues a protocol must not offer. What is different is who reads it. An activity
payload would have been for a program, and a program needs a schema. `fields` is for the person
reading the console, and a flat map of scalars is renderable by anything that has ever drawn a table
— which is the shape both standards above admit: syslog allows nothing else, and OpenTelemetry's
attributes permit more while every backend that renders them reads them this way.

Flat, and scalars, is therefore the load-bearing part rather than a tidiness rule. Nesting is what
turns a rendering into a tree widget and what tempts the next reader to reach into it; a map one
level deep can be shown, filtered by eye, and copied into a ticket, and offers nothing to build a
contract on. A Worker with a structure that does not fit flattens it or writes it into the message,
and the second is not a defeat: the message is where anything a person needs to read in full
belongs.

**This protocol defines no filter over `fields`, and a console may not require one.** A Worker that
offers its own is offering something of its own, which is its business and ENDP-24 already governs
how an unrecognized one is answered.

## Who may read it

**LOG-10 (required). A Worker answers the same records to every caller it authenticates.**

ALRT-6 and ACTV-6's reasoning, one surface along. The party this surface is for is whoever operates
the Worker, which is enrollment rather than a Contract.

A list filtered per reader is the thing this rule exists to refuse. It would make every record's
visibility a judgement the Worker makes on the fly, on a surface whose whole content is unstructured
text — which is a filter nobody can verify and everybody would eventually trust.

**A record is written on purpose, which is what keeps this rule affordable.** Nothing here captures
a runtime's output: a Worker decides that something is worth a line and decides where the line is
kept, so a store that already separates one customer's work from another's separates the records
too. The alternative — patching a runtime's `console` and serving whatever it collected — is one
feed per process, blind to whose work produced each line, and this file does not ask for it.

A Worker whose records belong to its customers rather than to whoever runs it wants a different
surface from this one, and this edition does not define it.

## What this file does not fix

**A record names no request, no Task and no trace.** Correlating a line with the call that produced
it is the obvious next thing to want, and it is genuinely useful; it is also a second identifier on
every record, a way to carry it through whatever the runtime uses for context, and a question about
whether this protocol recognizes traces at all. Nothing needs it yet.

**A record carries no source, module or logger name.** Every logging library has one and no two
agree on what it means. Until something reads it, it is a string beside a string.

## Still open here

- Whether a record may name the request, Task or trace it belongs to, so that a console can group a
  page of lines by the call that wrote them. It is the single most-requested thing this file leaves
  out, and it arrives with an identifier or not at all.
- Whether the entry declares the window it keeps — a duration, a count, or neither. It would let a
  console say *the last two hours* honestly instead of leaving a caller to infer a window's edge
  from an empty page. What stops it today is that the two bounds are not interchangeable: a Worker
  holding the newest ten thousand records has no duration to declare, and one holding a day has no
  count.
- Whether a record may name the subject it belongs to — a customer, a Contract — so that a Worker
  can hand each of them their own lines. It is a different surface from this one, not a field on
  it: LOG-10 answers one feed to every caller, and varying that by reader is a weaker rule that
  would have to be argued for rather than assumed. Nothing needs it yet, and a Worker that does has
  a store that already separates them and somewhere of its own to serve them from.
- Whether a Worker that issues credentials under Contracts must refuse them at this address, and
  whether a Worker therefore needs to know which Capability a credential is being presented for.
  It is the only exposure this file creates that a verifier could observe — it already holds a
  Contract's credential in order to check TASK-6 — and it costs a change to the shape of the one
  question every SDK asks a Worker author, which is why it is here rather than written.
- Whether a Worker may answer a level filter that names a set rather than a floor, and what
  multiplicity convention this protocol would then owe every other surface.
- Whether `fields` values may be arrays of scalars, which OpenTelemetry allows and which a console
  renders as easily as a scalar.

## Withdrawn

Nothing yet.

# Metrics

`draft`

The few named quantities a Worker exposes for deciding whether it is worth running — cost, volume,
outcomes — each accumulated over periods it declares. A metric carries no valuation: it is a Fact
the Worker derived and is authoritative over, and where health says whether a Worker works, a metric
says what it did.

**No judgment is published here, and none is declared.** A Worker that decides one of its own
numbers is wrong raises an Alert, which is the surface this protocol has for a condition an operator
should see; a consumer that compares against something it agreed to does so with what it read. Why a
Worker would judge — a bound somebody configured into it, a rule in its code, anything else — is
inside the Worker, and this file could not name it without inventing a shape for settings it has no
view of. What crosses here is a quantity.

The declaration is [schemas/metrics-entry.json](../schemas/metrics-entry.json), one metric's
declaration is [schemas/metric-declaration.json](../schemas/metric-declaration.json), and what a
read answers is [schemas/metric-page.json](../schemas/metric-page.json). What follows is what no
schema can state. Rules carry ids and a class; the convention is in [spec/README.md](README.md).

## What a Worker declares

**MET-1 (required). A `metrics` entry declares an address.**

**MET-2 (required). The entry declares every metric the Worker publishes, keyed by name. The
Descriptor is the catalog: this surface answers values and never lists what exists.**

**MET-3 (required). Each metric declares a unit, whether it is additive, and at least one
granularity, from `hour`, `day`, `week`, `month` and `year`.**

**MET-4 (required). Each metric declares its dimensions, keyed by name — none, or several — and
each dimension either declares the closed set of values it takes or declares none, which means any
string.**

**MET-5 (required). A dimension is not named after a parameter this protocol defines on a read.**

MET-2 is the same division the rest of the protocol already makes: everything anyone knows about a
Worker before calling it is read from the Descriptor, so a console that renders a chart knows the
name, the unit and the periods before it asks for a number. A surface that also listed its metrics
would be a second catalog to keep in step with the first, and the two would disagree on the day a
deployment was half finished.

The unit is a string the Worker declares and nothing here parses it. This protocol has no data model
and no dimensional analysis: the unit exists so a console can put something beside a number and so
an operator reading two Workers knows whether they are counting the same thing. A Worker that writes
`tokens` and one that writes `token` are not compared by anything.

The granularities are five and closed because a period a reader cannot enumerate is a period nobody
can build a control for. A console renders a period selector from the granularities a metric
declares; an arbitrary duration — every seven minutes, every 36 hours — would make that selector a
free-text box and would make two Workers' answers incomparable for no gain anybody asked for. Five
is also where accumulation stops being a time series, which is the distinction this Capability rests
on and the reason a Prometheus scrape is a different thing.

A metric declares only the granularities it actually keeps, and that is the point rather than a
concession. A Worker whose store lets it group on demand declares all five; a Worker holding one
pre-aggregate declares the one it holds, and MET-10 refuses anything else rather than computing
something it cannot afford. Neither has to explain itself.

**Additivity is declared because a reader will otherwise assume it.** Whether buckets may be summed
is a property of the quantity and only the Worker knows it: tokens consumed over two days is the sum
of the two, and vehicles that reported over two days is not, because the same vehicle reported on
both. A reader that sums a non-additive metric produces a number that is wrong and plausible, which
is the worst kind, and nothing in the answer reveals it. Declared, a console may derive a month from
days when the metric says so and must ask the Worker for `month` when it does not. It is also
checkable in the ordinary case: where a metric declares itself additive and declares two
granularities, a verifier compares a coarse bucket against the sum of the fine ones inside it.

MET-5 is the price of spelling a dimension as a bare parameter. `metric`, `granularity`, `from`,
`to`, `by` and the parameter a caller returns a cursor in are this protocol's, and a dimension that
took one of those names would be unreachable. The list will grow, and when it does it may strand a
Worker that declared the name first — which is a real cost, accepted in exchange for a query a
person can read. It has no schema witness: expressing *not one of these names* in a JSON Schema
pattern needs a negative lookahead, which ECMA-262 has and RE2-backed validators refuse, so the
schema asserts the characters a name may use and this rule asserts the rest.

## Where a period begins and ends

**MET-6 (required). The entry declares one IANA time zone.**

**MET-20 (required). Every bucket boundary is cut in that zone. A caller with whom the Worker has
agreed nothing else receives that calendar.**

**MET-7 (required). A `week` is an ISO 8601 week, beginning Monday.**

A day is not 24 hours and a month is not 30 of them; both are calendar facts, and a calendar needs a
zone. Without one, two readers of the same Worker disagree about what *yesterday* was, and neither
is wrong. The zone belongs to the entry rather than to each metric because there is no reason for a
Worker to cut two of its own metrics on different calendars, and one zone is what makes its metrics
comparable with each other. It is written in the `metrics` entry rather than at the root of the
Descriptor because this is the only surface whose meaning depends on a calendar, and DESC-1 makes
the Descriptor the whole of what *every* Worker owes — including one that publishes no metrics at
all. If a second surface ever needs a calendar, the declaration moves up, which is what an edition
is for.

MET-20's second sentence is what a multi-tenant Worker needs. A Worker serving several consumers may
have agreed a calendar with one of them — a tenant whose day ends where its own operators say it
does — and cutting that consumer's buckets in it is a better answer than handing everyone the
deployment's zone and asking them to re-aggregate, which is the one thing accumulation exists to
avoid. The answer stays unambiguous whatever was agreed, because MET-13 has every bucket carry its
own start and end with an offset: which calendar produced a page is read off the page. What the
Descriptor declares is what a caller gets when nothing else was agreed, so a verifier holding an
ordinary credential can still check it. Where such an agreement is recorded is not settled — it
joins *what a Contract carries beyond credentials* in [undecided](../docs/undecided.md).

A day across a daylight-saving transition holds 23 or 25 hour-buckets, and that is correct rather
than a defect to paper over: the buckets cover the day, and the day was 23 or 25 hours long. This is
another reason MET-13 has every bucket carry its own end rather than leaving a reader to add a
duration to a start.

MET-7 fixes the one ambiguity in the five. Weeks begin on Monday, they are numbered by ISO 8601, and
a week belongs to the ISO week-year, which is not always the calendar year it starts in: the week
containing the 1st of January may be numbered 52 or 53 of the year before. It follows that weeks do
not nest inside months or years, and a reader must not add week-buckets to reach either.

## Reading one

**MET-8 (required). A read names one metric. It names a granularity where the metric declares more
than one, and may omit it where the metric declares exactly one.**

**MET-9 (required). A metric the entry does not declare is `404`, with the code `not_found`.**

**MET-10 (required). A granularity the metric does not declare is `400`, with the code
`invalid_parameter`. So is an omitted granularity where the metric declares more than one.**

**MET-11 (required). The interval is `from` and `to`, RFC 3339 instants carrying an offset, and it
is half-open: `[from, to)`. Absent, `from` is the start of the current bucket and `to` is the
instant the Worker answers.**

**MET-12 (required). A Worker answers the buckets whose start falls in the interval. An interval
that begins or ends inside a bucket never cuts one: a bucket is answered whole or not at all.**

**MET-13 (required). Each bucket carries its own start and end as RFC 3339 instants, and a value. A
bucket whose end has not passed is still accumulating, and the Worker answers it with what it
holds.**

**MET-14 (required). Buckets ascend by start, and where a read breaks down, by the values broken
down by within one start.**

**MET-15 (required). A bucket the Worker accumulated nothing in is absent from the answer. A bucket
the Worker no longer holds is answered with a null value, which means it cannot say and never means
zero.**

One metric per read, and the read is one series. A dashboard asking for six metrics makes six calls,
which over one connection costs little and keeps both the answer and the paging on a single axis;
naming several would put the metric's name inside every bucket, make the declared order of ENDP-23 a
compound one, and let a page cut a series in half.

MET-8's condition is read off the Descriptor before the call, which is what DESC-11 asks of any
behaviour that is conditional on a call. A Worker that holds one pre-aggregate is asked for it
without ceremony — there is nothing to choose and nothing to say — and a Worker offering several
makes the caller choose, because there is no answer the Worker could pick that would not be a guess
at which question was asked. The cost is that a client cannot write one URL for every Worker without
reading a declaration it was going to read anyway.

MET-9 and MET-10 divide by which side is wrong about what. A metric that is not declared is a
resource that does not exist, which is `404` exactly as ENDP-29 has it. A granularity is a parameter
whose value this Worker will not accept: the metric exists, the caller asked for it over a period
the Worker does not accumulate, and `invalid_parameter` says so. Both are `reject`, so ENDP-28 stops
a caller from retrying either; the difference is what the caller has to change, and that is the
whole purpose of the two codes.

MET-11's defaults are one sentence rather than four cases on purpose. A caller that sends neither
parameter is asking *how is it going*, and gets the current bucket — today, this month — which is
the question a console asks on every page load. A caller that sends `from` alone is asking for
everything since. A caller that sends `to` alone has asked for an interval that begins now and ends
in the past, and gets nothing, which is what it asked for; no special case rescues it, because a
special case here would mean guessing which end it meant.

Half-open is what makes two adjacent reads add up. A caller walking a year month by month with
closed intervals counts every boundary twice, and the error is invisible: the numbers are plausible
and slightly too large. `[from, to)` is also how the buckets themselves are cut, so a bucket's end is
the next bucket's start and nothing falls between them.

MET-12 is the rule that keeps a value honest. A Worker that answered a partial bucket for an
interval that started at noon would be reporting half a day under a label that says *day*, and no
reader could tell — the value is a number and the shape is identical. Answering whole buckets or
none means every number a caller receives covers exactly the period its own start and end describe.
A caller that wants the last six hours asks for `hour`, if the metric has it.

MET-13's end carries the current bucket's honesty. A reader comparing an end against its own clock
knows whether a bucket is closed, and needs no flag, no `asOf` beside the page and no calendar
arithmetic in a zone it may not hold. The current bucket is answered rather than withheld because
*today so far* is the most-read number on any console, and a surface that hid it would send every
console to the finer buckets to add them up — which, for a metric that is not additive, would be
wrong.

Nothing here promises that a closed bucket never changes. A Worker that learns something late, or
recomputes, is the authority on its own Facts, and a protocol that forbade the correction would be
asking a Worker to publish what it knows to be false. What a reader may rely on is the pair of
instants: the number covers that period, as the Worker understands it now.

MET-15 separates two things a reader must not confuse, and the separation is the whole reason this
surface needs no retention declaration. *Nothing happened* is an absence: a Worker that accumulates
only when there is something to accumulate holds no bucket for a quiet Tuesday, and for an additive
quantity a reader may treat that as zero — its own reading, not the Worker's claim. *I no longer
have it* is a null: the Worker kept a day for ninety days and this one is older, and no reading of
that is zero. A console draws a gap; a total that skips it is a total over a shorter period than it
was asked for, and says so.

Nothing outside the Worker can catch a Worker that discarded a bucket and answered as though it had
merely been quiet. That is the class of rule [spec/README.md](README.md) admits deliberately and
keeps small, and `conformance/` reports it unverified rather than passing it silently. What would be
seen, if anything could see it, is a console drawing a zero over a period the Worker cannot account
for — which is exactly the plausible wrong number this file spends MET-3 preventing elsewhere.

An interval with nothing in it is an empty page rather than a `404`: the metric exists and the
Worker answered, and a caller that treated a quiet period as a missing resource would stop polling a
Worker that is merely idle. The order is ascending because a series is read forward, and because
ENDP-23 requires that a collection declare one and hold it so that paging terminates. It has a
tiebreak for the same reason: a breakdown puts several buckets on one start, and an order with ties
in it is not an order a cursor can resume from without a Worker inventing the rest of it privately.
Long ranges page under ENDP-20 like every other collection here.

## Filtering, and breaking down

**MET-16 (required). A dimension is fixed with a query parameter named exactly as the dimension.**

**MET-17 (required). A value outside a dimension's declared set is `400`, with the code
`invalid_parameter`. Where a dimension declares no set, any string is accepted and may match
nothing.**

**MET-18 (required). A dimension a read neither fixes nor breaks down by is accumulated over: the
answer is the metric across every value that dimension took.**

**MET-19 (required). A read breaks down by a dimension with `by`, and only by a dimension that
declared its set of values. Each bucket then carries the values it is broken down by, and the same
period appears once per combination.**

Dimensions are how a metric answers *which kind* without becoming several metrics. A Worker that
resolves Tasks of three types publishes `tasks-resolved` with a `taskType` dimension, not three
metrics whose names a console has to pattern-match; a Worker that operates across sectors publishes
one metric with a `sector` dimension. The name is the Worker's own and NAME-7 does not reach it, for
the reason [naming](naming.md) gives about an Action: it is read only inside the Descriptor that
declared it, and nobody places two Workers' dimensions side by side. The schema keeps it to letters,
digits, `-` and `_`, which is what MET-16 needs to spell it into a parameter; a metric's own name
carries no pattern at all, because it travels as a parameter's value and is percent-encoded like any
other.

ENDP-24 applies to MET-16 with nothing added here: a parameter naming a dimension the metric does
not declare is an unrecognized filter, and is `400` with `unknown_filter` rather than quietly
ignored.

MET-17 is the whole return on declaring a set. Where the values are closed, a caller that misspells
one is told so, and a console renders a select rather than a text box; where they are not, the
Worker cannot distinguish a typo from a value it has not seen yet, and saying `400` would refuse a
value that is about to become real. So the two cases answer differently on purpose, and a metric
whose values are knowable should declare them.

**MET-19 is the second return, and it is the one that decides the shape of the answer.** Breaking
down turns one series into one per value, and whether that is a page or a flood depends entirely on
how many values there are. Over a declared set, a caller knows the number before it asks and a
Worker knows it before it answers; over a free dimension nobody does, and the Worker would be
publishing a number of series that nothing bounds. So a free dimension is filtered and never grouped. That
gives the closed set its second reason to exist and keeps the wire bounded by something a reader can
see in the Descriptor.

A free dimension is not a label, and the distinction is what keeps this Capability from turning into
the time series it is not. What a metric may not do is carry values nobody declared a *name* for —
an envelope of arbitrary key-value pairs attached where a number is emitted. The names are fixed in
the Descriptor, so a reader knows every dimension before it calls. The values of a free dimension
are unbounded, and with MET-19 refusing to group them their cost stays entirely the Worker's:
because a read names the value it wants, the answer is one series whatever the Worker holds behind
it. What a Worker can afford to accumulate is its own business, exactly as its storage is.

A caller filtering a free dimension already knows the value, because the value came from its own
domain — a Task type it raises, a sector it operates in. This surface promises no way to discover
which values exist; a Worker that wants them discoverable declares the set.

MET-18 is what makes a number readable at all. Without it, a caller that fixed no dimension could
not tell whether it had been handed the total or some slice the Worker chose, and two Workers would
answer differently with nothing to distinguish them. It is checkable from outside in the ordinary
case: on a metric that only accumulates upward, an unfiltered answer that is smaller than one of its
own filtered answers over the same interval has broken this rule.

## What this file does not fix

**What a Worker counts, and how it derives it.** Which quantities are worth publishing, what a
Worker considers a hire or a failure, whether a number comes from a table it keeps or a count it
recomputes — all of it is inside the Worker, which [the architecture](../docs/architecture.md) makes
authoritative over its own state.

**How far back a Worker keeps each granularity.** Nothing here requires a Worker to keep anything
and nothing has it declare what it keeps. A retention declared in a Descriptor would be a promise no
reader could check — nothing outside can tell a bucket that was dropped from one that was always
empty — and MET-15 answers the question it was wanted for, in the answer itself and at the moment it
matters, by having the Worker say *I no longer have this* where it knows.

**What a Worker is configured with.** A Worker's settings are its own and are written through the
`configure` Action, whose shape is [actions](actions.md)'s. Nothing here says that a setting exists,
that one bears on a metric, or that a Worker has any settings at all — a setting that changes what a
Worker counts changes the numbers and nothing else, and this surface would not know.

**A Prometheus-style `/metrics` endpoint is not this Capability.** A Worker may serve one — like
anything else it serves undeclared, it is invisible here — and the two answer different questions.
This Capability is a few named quantities over periods each of them declares, read by a console and
by an operator; a scrape is a time series over whatever window the reader chooses, read by a
monitoring system. The period is the distinction.

## Still open here

- **Whether a metric is broken down by Contract.** It would be a dimension like any other, and the
  Worker is authoritative over the value: it sees the credential on every request, so it knows which
  Contract each Claim, Action and Response came under. What is undecided is whether this protocol
  names that dimension, which would make one name mean the same thing across Workers, or leaves each
  Worker to declare its own. Open in [undecided](../docs/undecided.md).

## Withdrawn

Nothing yet.

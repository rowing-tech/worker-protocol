# Health

`draft`

The answer a Worker gives when polled: one status for the Worker, and a map of named checks behind
it. This is the cheapest Capability in the protocol and the file is short on purpose — almost
everything about health is a schema, and what a Worker reports on is the Worker's business.

Its shape is [schemas/health.json](../schemas/health.json), the three status values are
[schemas/health-status.json](../schemas/health-status.json), and the Capability entry that declares
it is [schemas/health-entry.json](../schemas/health-entry.json). What follows is what no schema can
state. Rules carry ids and a class; the convention is in [spec/README.md](README.md).

`health` is a Capability like any other, so DESC-2 applies without qualification: a Worker that
declares none is conformant. DESC-1's argument already says what stands in for it — the Tower
fetches the Descriptor on a schedule anyway, and a fetch that fails is the same fact a failed poll
would have been.

## Declaring it

**HLTH-1 (required). A `health` entry declares an address.**

This is the extension DESC-22 promised each Capability's own file would define, and it is the first
one. The shared entry leaves the address optional for exactly one reason — `events` is answered
over a broker and has no HTTP surface — and every Capability answered over HTTP takes it back. A
verifier sees the missing address in the Descriptor and fails the Worker without calling anything.

## The answer

**HLTH-2 (required). The answer carries one status for the Worker and a map of named checks, each
with a status of its own. Both statuses are drawn from the same three values.**

**HLTH-3 (required). A Worker does not answer `healthy` while any check it reports is not
`healthy`.**

**HLTH-4 (required). A Worker that has not yet established its state answers `unhealthy`, never
`healthy`.**

**HLTH-5 (required). A Worker answers its health address `200` whatever it reports. The status is
read from the body, and a response that is not `200` means the Worker did not answer, not that it
is unwell.**

Three values rather than two, because two would force a Worker that works with one dependency down
to lie in one direction or the other. `unhealthy` means do not rely on me; `degraded` means I am
working and something behind me is not; and the difference is a judgement only the Worker can make,
which is why this file fixes the vocabulary and not the thresholds. What makes a Worker `degraded`
is the Worker's to declare.

HLTH-3 is what stops the summary from being decorative. Without it a Worker may answer `healthy`
with a failing check beside it, and the one field every console renders first means nothing —
a reader would have to walk the map to learn what the summary was supposed to tell it, and the map
is the part that differs between every Worker. It is deliberately one-directional: it forbids
`healthy` over a failing check and says nothing about choosing between `degraded` and `unhealthy`,
because that choice is exactly the judgement the third value exists to carry.

HLTH-4 is the same rule applied to the one moment a Worker knows least. A process that has just
started has checked nothing, and `healthy` is a claim it has no basis for — it is not reporting a
state, it is reporting a default. The Tower records that answer, the console shows it, and the one
window in which a Worker is most likely to be broken is the window it reports itself best.
Answering `unhealthy` costs nothing, because ENDP-29 classes the condition `retry` and a poller
comes round again.

HLTH-5 departs from a widespread convention on purpose, and the reason is which reader this
protocol is written for.

An infrastructure probe — a load balancer deciding whether to send traffic, a platform's liveness
check deciding whether to restart a process — reads a status code and nothing else. It has no
parser, no schema and no interest in a map of checks. For **that** reader `503` is exactly right,
and nothing here says otherwise: the convention is sound for the reader it was invented for.

This protocol's reader is a different one. The Tower polls health to fill a console, so it reads
the body in every case — the summary and the named checks are the whole point of asking. For that
reader `503` is not merely unnecessary, it is actively wrong, because ENDP-29 classes `503` as
`retry` with the code `unavailable`, and ENDP-28 and ENDP-30 then have the poller back off from a
Worker that answered it correctly and completely. The Worker said *I am unwell*; the poller heard
*I could not answer you* and went away to try later. The one distinction a health surface exists to
draw — between a Worker that is unwell and one that is unreachable — is the distinction `503`
destroys, because an unreachable Worker produces the same code.

So `200` means *I answered*, and anything else means *I did not*, which is what those codes mean on
every other surface in this protocol. Both facts stay legible, and a poller needs no special case
for one address.

**A Worker that needs the infrastructure behaviour serves that probe outside the protocol.**
descriptor.md already permits it in as many words — a Worker serves whatever else it likes at
whatever address it likes, and nothing undeclared is visible here. A liveness endpoint answering
`503` at a path of the Worker's choosing is an ordinary thing to have and costs this specification
nothing; what it must not do is answer the address its `health` entry declared.

Nothing about HLTH-5 exempts a Worker's *other* surfaces. A Worker reporting `unhealthy` is very
likely to answer `503` with the code `unavailable` on the addresses that do its work, which is
ENDP-29's row read exactly as written. Health is the one address where being unwell is the content
of the answer rather than the reason there is not one.

What a check carries beyond its status and a short human-readable detail — an observed value, a
unit, a threshold — is [open](../docs/undecided.md), and the schema is deliberately loose there so
that an answer can land without breaking documents already written. Whether check names are shared
across Workers is open in the same place; the key carries no pattern today, and if they come to be
shared they become a name that crosses between Workers and NAME-7 reaches them without this file
changing.

## What this file does not fix

**The cadence the Tower polls at is the Tower's, and this protocol does not state one.** A number
here would be a number every Worker in every deployment was measured against, invented by somebody
who had seen neither. What a Worker can afford to do inside a check follows from the cadence its
own operators chose, and a Worker that cannot answer in time answers ENDP-29's `408` or `503` like
any other surface.

**What a Worker checks is not this protocol's business either.** A Worker reports on what it
depends on; nothing here enumerates dependencies, requires a minimum set, or says what a check must
probe. A Worker that reports no checks at all answers `{}` and is conformant — its summary is then
the whole of what it has to say, which for a Worker with no dependencies is true.

## Still open here

- What a check carries beyond status and detail. Open in [undecided](../docs/undecided.md).
- Whether common checks share names across Workers, or every Worker names its own. Open in
  [undecided](../docs/undecided.md).

## Withdrawn

Nothing yet.

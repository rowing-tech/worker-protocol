# spec

Normative for **behavior**: the endpoints, the lifecycles and the status codes that no schema can
state. What a request and a response carry is normative in `schemas/`, and where a sentence here
disagrees with a schema, the schema wins.

One file per subject, each opening with its maturity marker — `stable`, `draft` or `open`. A file
marked `open` lists what it will answer. Where one of those questions is one of meaning and has an
entry in [deliberately undecided](../docs/undecided.md), the bullet links there and the entry
links back, so that when the answer lands both places know; the rest is mechanics, merely
unwritten.

Cross-cutting — every Worker meets these, whatever else it implements:

| File | Subject |
|---|---|
| [descriptor.md](descriptor.md) | What a Worker says it implements: its id, its Capabilities, its versions |
| [endpoints.md](endpoints.md) | Paths, verbs, versioning, errors, idempotency, paging |
| [registration.md](registration.md) | How a Worker is enrolled, and how both sides authenticate |
| [naming.md](naming.md) | Identity, namespaces, and what a schema change breaks |

Capabilities — each a part of the protocol a Worker declares in its Descriptor or leaves out, with
a version of its own:

| Capability | File | Subject |
|---|---|---|
| `health` | [health.md](health.md) | The answer to a poll: one status, named checks |
| `indicators` | [indicators.md](indicators.md) | Named quantities over a declared period |
| `actions` | [actions.md](actions.md) | Declaring and performing an operation, `configure` and settings included |
| `alerts` | [alerts.md](alerts.md) | Conditions an operator should see |
| `tasks` | [tasks-and-claims.md](tasks-and-claims.md) | Exposing Tasks, claiming under a lease, answering |
| `events` | [events.md](events.md) | The envelope, the broker, deduplication |

The Capability names in that table are a reading aid. The normative list is
[schemas/capability-name.json](../schemas/capability-name.json), and where the two differ the
schema wins — see [descriptor.md](descriptor.md).

[descriptor.md](descriptor.md) and [endpoints.md](endpoints.md) are `draft`: they were answered
first because every other file leans on them — the Descriptor route, the addresses, the versioning
rule and the error envelope. The rest are `open`: their subjects are settled, their answers are
not.

## Rule ids

Every obligation in this directory carries an id, so that a conformance report can say *fails
ENDP-11* rather than *fails endpoints*, and so that the same sentence is written once and cited
everywhere else.

**A rule is a bold statement that carries an id. Bold without an id is emphasis, not obligation,
and no obligation is stated outside a bold, id-carrying statement.** That is the whole boundary,
and it is deliberately mechanical: everything else in a file — the argument, the worked example,
the reason a rule is shaped the way it is — binds nobody and can be rewritten freely. A writer who
wants to add an obligation adds an id, and a reader extracting what a Worker must do reads the
bold lines and nothing else.

An id is `PREFIX-N`. Every file has a prefix from the day it exists, whatever its maturity marker,
so that two files never race for the same one:

| File | Prefix | File | Prefix |
|---|---|---|---|
| [descriptor.md](descriptor.md) | `DESC` | [health.md](health.md) | `HLTH` |
| [endpoints.md](endpoints.md) | `ENDP` | [indicators.md](indicators.md) | `IND` |
| [registration.md](registration.md) | `REG` | [actions.md](actions.md) | `ACT` |
| [naming.md](naming.md) | `NAME` | [alerts.md](alerts.md) | `ALRT` |
| | | [tasks-and-claims.md](tasks-and-claims.md) | `TASK` |
| | | [events.md](events.md) | `EVT` |

Numbers are issued in the order rules are written, not in the order they appear, so a file's ids
need not read in sequence. **The number never restarts, and an id is never reused and never
renumbered.** A conformance report is read long after it was produced, and often against a Worker
built to an older edition; an id that silently changed meaning between editions is worse than no id
at all, because it turns a report that was true into a report that is false without either side
noticing.

So:

- **A rule that is deleted keeps its id, withdrawn.** Its number is never issued again. Each file
  ends with a `Withdrawn` list — the id, what it required, and what replaced it if anything — and
  that list is the only place a withdrawn id is written.
- **A rule that is rewritten keeps its id if no verdict could change, and takes a new one if any
  could.** That is the test, and it is about implementations rather than words: rewording, a
  clearer example, a correction of grammar, all keep the id; narrowing what is allowed, widening
  it, or changing a status code all retire the old id and issue a new one.
- **A rule that moves to another file takes a new id in the new file** and leaves the old one
  withdrawn, pointing at it.

An id belongs to one independently checkable obligation. Where a paragraph states three things a
verifier would check separately, it carries three ids, because a report naming one of them is the
point of having them at all.

The subject of a rule is whoever the sentence names — most are obligations on a Worker, and some
are on a verifier, a Control Tower or a consumer, which is why a report says which of these it was
checking. And not every id is checkable from outside: a rule about what a Worker serves *nowhere
else*, or about what a Tower must not forget, has no black-box witness. `conformance/` reports
those as unverified rather than passing them silently, on the same reasoning that makes a generated
artifact nobody compares a claim nobody verifies.

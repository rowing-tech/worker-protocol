# Endpoints

`draft`

The shape of the Worker API itself, before any one surface: which paths a Worker serves, which
verbs, which content types, and how a Worker says which version of this protocol it speaks.

Two shapes are shared by every surface and have schemas of their own: the error envelope,
[schemas/error.json](../schemas/error.json), and the page envelope,
[schemas/page.json](../schemas/page.json). Three header names are fixed by this file and by nothing
else, because a JSON Schema describes a body and not a header:
`Worker-Protocol-Edition`, `Worker-Protocol-Capability-Version` and `Idempotency-Key`. What follows
is what no schema can state. Rules carry ids; the convention is in [spec/README.md](README.md).

## One fixed route, and no fixed prefix

**ENDP-1. Every address other than the Descriptor's own route is declared in the
[Descriptor](descriptor.md). This protocol reserves no path prefix.**

That is a decision against the obvious alternative, and the reason is the Workers people use. A
Worker is often an application that already owns its own routes, and reserving `/health`, `/tasks`
and `/actions` across every Worker in the network takes those names from applications that had them
first — for a gain that turns out to be imaginary, because nobody assembles these URLs by hand.
Every reader starts from the Descriptor: the Tower reads it to build its registry, a consumer reads
it to find the surface a Contract covers, a verifier reads it to know what to check. A reader that
already holds a document listing every address has no use for a rule that would let it guess one.

What the protocol buys with that is a Worker on any platform: one that mounts its protocol surfaces
under a path of its own, one that answers them from a second deployment, one that is a thin proxy
in front of a system that has no notion of any of this. A Worker states where each surface is; the
obligation that the statement is complete is DESC-10.

A Worker is free to group its surfaces under a prefix, and most will. It is a convention between a
Worker and its own maintainers, and no reader depends on it.

## Verbs, and what a read is allowed to do

**ENDP-2. Reading is GET, and a GET changes nothing a later reader could observe.**

**ENDP-3. Everything that changes state is POST, on an address declared for the purpose. This
protocol defines no PUT, PATCH or DELETE.**

**ENDP-4. Bodies and responses are JSON, UTF-8, `application/json`.**

ENDP-2 is not a courtesy to caches; it is what makes a surface safe to point a console, a verifier
and a curious operator at on the same afternoon. Listing a Worker's open Tasks does not consume
them, reading its Alerts does not dismiss them, reading its settings does not reset anything. A
read endpoint that empties what it read turns every act of looking into an act of taking, and the
operator who was only looking finds out later, from the absence.

Where answering requires changing state — claiming a Task takes an exclusive lease, and the answer
is only true because the state changed — it is not a read and it is not a GET. That is the line: if
a caller could not run it twice and get the same answer, it is not on the read side of this
protocol.

Serving PUT, PATCH or DELETE outside this protocol is a Worker's own business, and invisible to it.

## Versions on a call

**ENDP-5. Every protocol response carries `Worker-Protocol-Edition` and
`Worker-Protocol-Capability-Version`, stating what produced it.**

**ENDP-6. A caller may send `Worker-Protocol-Capability-Version` on a request. A Worker that cannot
answer that version refuses the request whole with `400`, and never substitutes its own.**

Nothing is negotiated on a call, because the [Descriptor](descriptor.md) already named the edition
the Worker speaks and the version of each Capability, and the address it gives for a Capability
already answers the version it declared. A caller reads the Descriptor, finds a version it
understands, and calls the address beside it. There is no path segment to compute.

What remains is drift: a caller holding a Descriptor read an hour ago, calling a Worker that has
been redeployed since. That is what ENDP-5 is for — a caller that sees a version it did not expect
re-reads the Descriptor rather than parsing the body. The cost is two headers; the alternative is a
caller that decodes a shape it does not know.

The refusal is whole for the same reason. A client that guesses at a shape it does not know is
worse than one that says so, and a Worker that silently answers its own version instead has
arranged for the guess and left the caller to notice. The refusal is permanent — `reject`, below —
and the caller's recourse is to re-read the Descriptor, which is where the answer was all along.

## Errors: which responses mean stop, and which mean try again

**ENDP-7. Every response that is not a success carries the shared error envelope: a stable
machine-readable code, a human-readable message, and an explicit class, one of `reject` or
`retry`.**

**ENDP-8. A caller does not repeat a `reject`.** The request is wrong and will be wrong again; the
caller changes something, or raises the failure where a person will see it, and stops.

**ENDP-9. A caller backs off and repeats a `retry` unchanged.** The Worker could not answer now and
the same request may succeed later.

The class is stated rather than inferred because inferring it is where this goes wrong in practice.
A caller that treats every unhappy answer as a reason to wait and repeat will, on a wrong path or a
credential missing a scope, retry with backoff for as long as its budget allows and then drop the
work — leaving a log line and no other trace. A contract mismatch becomes slow, quiet data loss,
discovered by whoever eventually goes looking for records that were never written. The distinction
between "you are wrong" and "I am busy" is the single most load-bearing thing this file says, and a
specification that leaves it to be guessed from a status code has chosen that outcome.

**ENDP-10. A Worker answers with the status codes below, and states beside each the class named
here.**

| Status | Class | What it means |
|---|---|---|
| `400` | `reject` | The request could not be understood: unparseable body, wrong content type, missing or malformed parameter, a version the Worker does not answer, a required idempotency key absent |
| `401` | `reject` | No credential, or one the Worker cannot read |
| `403` | `reject` | The credential is understood and does not carry the right — a scope it lacks, a Contract it is not covered by |
| `404` | `reject` | No such address, or no such resource |
| `408` | `retry` | The request did not arrive in time to be answered |
| `409` | `reject` | The request conflicts with the current state — a Task already claimed, an idempotency key reused with a different body |
| `422` | `reject` | The body is well-formed and matches the schema, and this Worker will not accept its content |
| `429` | `retry` | Too many requests. Carries `Retry-After` |
| `500` | `retry` | The Worker failed for its own reasons |
| `503` | `retry` | The Worker cannot serve right now — starting, `unhealthy`, a dependency down |
| `502`, `504` | `retry` | Something the Worker depends on did not answer |

Three rules hold the table together:

- **ENDP-11. A Worker does not answer 5xx for a condition that will not change.** A bad body
  answered with a 500 is an instruction to redeliver an unusable payload forever, and the sender
  will comply.
- **ENDP-12. A Worker distinguishes `400` from `422`.** 400 is *I cannot read this*; 422 is *I read
  it and I will not have it*. A caller can fix the first by looking at its serializer and the
  second only by looking at its content, and collapsing them into one code makes both look like the
  other.
- **ENDP-13. A caller that cannot classify an answer treats it as `reject`.** Stopping loudly on
  something that would have succeeded costs an alert. Retrying on something that never will costs
  the work, and costs it silently.

**ENDP-14. Where the class and the status code disagree, the class in the envelope wins when an
envelope is present and parses; the status code wins when it is not; and an answer that can be
classified by neither is `reject`.**

The envelope is the Worker's statement about itself and the status code is whatever reached the
caller last. A proxy that rewrites a `422` into a `502` has not changed what the Worker meant, and
a caller that follows the proxy redelivers a body the Worker has already refused — which is the
exact failure ENDP-12 exists to prevent, reintroduced by the one participant that knows least about
the request.

`401` is `reject` for the request as sent, and a caller holding a credential it can refresh may
refresh it and send the request again. That is a different request with a different credential, not
a retry of this one, and nothing about it licenses a loop. When a credential expires, how it is
refreshed, and what an unrecognized caller is told rather than shown are
[registration](registration.md)'s.

## Posting an Action, and saying it is the same call again

**ENDP-15. An Action declares in the [Descriptor](descriptor.md) whether it requires an idempotency
key; if it does, it declares where the key is read from — the `Idempotency-Key` header or a named
field of the payload — and how long the Worker honors one.**

**ENDP-16. Within that window, a repeat under the same key is not a second performance: the Worker
answers the outcome it recorded.**

**ENDP-17. A key reused with a different body is `409`.**

**ENDP-18. A required key that is absent is `400`.**

**ENDP-19. An Action that declares no key is at-least-once under retry, and a caller that retries
one accepts that it may happen twice.** This file orders retries — that is what ENDP-9 is — so it
owes the plain statement of what a retry costs where nothing protects it. A specification that
orders a retry and offers no safe way to perform one is incoherent; this one offers the way and
says where it does not apply.

Only the caller can tell a retry from a genuine repeat. Two byte-identical posts may be one
intention sent twice because an answer was lost, or two intentions that happen to look alike, and
nothing in the request distinguishes them — which is why, where the guarantee is wanted, the key
comes from the caller rather than from anything the Worker can compute.

But many Actions do not want it. An Action that sets absolute state — a threshold to 30 — is
naturally idempotent, and ceremony around it buys nothing. And a payload that already carries its
own identity needs no header: a Worker taking readings keyed by vehicle, kind and instant already
has the key in the body, and declaring that field is more honest than asking a caller to invent a
second one beside it. A key in a declared field is the Worker's own data and means whatever the
Action says it means; a key in the header is opaque, and the Worker records it without parsing it.

The window is declared because the guarantee is worthless without it. *A repeat returns the
recorded outcome* is unimplementable as an open promise — no Worker remembers forever, and one that
has forgotten performs the Action again while the caller still believes it is protected. Declaring
the window turns that from a silent assumption into a fact a caller can read and design against
before it sends anything.

Retrying is then narrow. A caller repeats only a `retry`, only unchanged, and only under the same
key; a caller that invents a new key for a repeat has asked for the Action twice and will
correctly get it twice.

How an Action expresses these declarations, what it answers on success, and whether performing one
is synchronous at all are [actions](actions.md)'s.

## Collections

**ENDP-20. Every surface that answers a list answers it in the shared page envelope: the items, and
a cursor for the next page which is absent at the end.**

**ENDP-21. A cursor is opaque, is produced only by the Worker, and is never constructed by a
caller.**

**ENDP-22. A Worker caps the page size it answers, rather than negotiating it, and a caller reads
how many items it received rather than how many it asked for.**

**ENDP-23. A collection declares an order and holds it**, so that paging through it terminates.

**ENDP-24. An unrecognized filter parameter is `400`, and is never ignored.**

Filters belong to the surfaces that have them — which Tasks a consumer may claim, which period an
indicator covers — and each file names its own. ENDP-24 is about the one a Worker does not know,
and it is strict for a reason: a filter that is dropped silently answers with more than the caller
asked for, in a shape it will happily parse. A caller that filtered in order to stay inside a
Contract, or to avoid work it may not take, is handed exactly what it excluded and no sign that
anything happened.

## Still open here

- **Whether an idempotency key is scoped to the caller that presented it, or is global to the
  Action.** A key a caller invents is its own; a key read from a declared field of the payload is
  often a natural identity any caller would send for the same fact. Open in
  [undecided](../docs/undecided.md).
- Whether the error envelope carries structured detail beyond code, message and class — a field
  path for a schema failure, a `Retry-After` echoed into the body — or whether that stays per
  surface.
- Whether a caller may ask for a page *before* a cursor, which every console that renders a
  previous-page control eventually wants.

## Withdrawn

None.

# Endpoints

`draft`

The shape of the Worker API itself, before any one surface: which paths a Worker serves, which
verbs, which content types, and how a Worker says which version of this protocol it speaks.

Two shapes are shared by every surface and have schemas of their own: the error envelope,
[schemas/error.json](../schemas/error.json), and the page envelope,
[schemas/page.json](../schemas/page.json). Four header names are fixed by this specification,
because a JSON Schema describes a body and not a header. Three are this file's:
`Worker-Protocol-Edition`, `Worker-Protocol-Capability-Version` and `Idempotency-Key`. The fourth,
`Worker-Protocol-Claim`, is [tasks and claims](tasks-and-claims.md)'s, and TASK-20 says what it
carries. What follows is what no schema can state. Rules carry ids; the convention is in
[spec/README.md](README.md).

## One fixed route, and no fixed prefix

**ENDP-1 (required). Every address other than the Descriptor's own route is declared in the
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
obligation that the statement is complete is DESC-22.

A Worker is free to group its surfaces under a prefix, and most will. It is a convention between a
Worker and its own maintainers, and no reader depends on it.

## Verbs, and what a read is allowed to do

**ENDP-2 (required). Reading is GET, and a GET changes nothing a later reader could observe.**

**ENDP-3 (required). Everything that changes state is POST, on an address declared for the purpose.
This protocol defines no PUT, PATCH or DELETE.**

**ENDP-4 (required). Bodies and responses are JSON, UTF-8, `application/json`.**

ENDP-2 is not a courtesy to caches; it is what makes a surface safe to point a console, a verifier
and a curious operator at on the same afternoon. Listing a Worker's open Tasks does not consume
them, reading its Alerts does not dismiss them, reading its settings does not reset anything. A
read endpoint that empties what it read turns every act of looking into an act of taking, and the
operator who was only looking finds out later, from the absence.

Where answering requires changing state — claiming a Task takes an exclusive lease, and the answer
is only true because the state changed — it is not a read and it is not a GET. That is the line: if
a caller could not run it twice and get the same answer, it is not on the read side of this
protocol.

One verb on the writing side, because the reader that matters never chose it. A console renders a
form from a schema it did not author and posts the result to an address it does not understand;
so does a teams app, and so does any consumer acting under a Contract. Give a Worker four verbs to
choose between and every one of those readers must be told which, which means the Descriptor
carries a verb per address and every client branches on it — a field, a branch and a way to get it
wrong, bought in exchange for a distinction no reader of this protocol acts on. The address already
says what the call does, because ENDP-1 makes every address declared for one purpose.

ENDP-3's second sentence is about this protocol and not about a Worker: serving PUT, PATCH or
DELETE outside it is a Worker's own business, and invisible to it.

ENDP-4 is narrower than it looks and follows from where the normative weight sits. Every shape this
protocol fixes is a JSON Schema in [schemas/](../schemas/), so a body that is not JSON has no
declared shape, cannot be validated, and cannot be rendered into a form — it would be a payload the
protocol can carry and say nothing about. What it costs is honest to name: an Action that takes a
file carries it base64-encoded inside a JSON body, or takes a URL and fetches it, because multipart
is not available. That is a real price on a real case, paid so that one rule holds everywhere
rather than holding except where somebody needed an exception.

## Versions on a call

**ENDP-5 (required). Every protocol response carries `Worker-Protocol-Edition` and
`Worker-Protocol-Capability-Version`, stating what produced it.**

**ENDP-6 (required). A caller may send `Worker-Protocol-Capability-Version` on a request. A Worker
that cannot answer that version refuses the request whole with `400`, and never substitutes its
own.**

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

**ENDP-25 (required). Every response that is not a success carries the shared error envelope: a
code from the closed enumeration in [schemas/error.json](../schemas/error.json), a human-readable
message, and an explicit class, one of `reject` or `retry`.**

**ENDP-26 (required). A code fixes one status and one class. A Worker answers a code with the
status that code names and the class that code carries, and never the same code under two
statuses.**

**ENDP-27 (required). Where a code and a status code disagree, the code wins when an envelope is
present and parses, and the status when it is not** — the same answer, and for the same reason, as
ENDP-14.

**ENDP-28 (required). A caller does not retry a `reject`: it does not send the request again in the
belief that the same request may yet succeed.** The request is wrong and will be wrong again; the
caller changes something, or raises the failure where a person will see it, and stops.

**ENDP-30 (recommended). A caller backs off and repeats a `retry` unchanged.** The Worker could not
answer now and the same request may succeed later.

The two rules are not the same kind of statement, and the asymmetry is deliberate. ENDP-28 binds
because a caller that retries a `reject` hammers a Worker with a request that will never succeed
and buries the failure; both parties are worse off and one of them did not choose it. ENDP-30
recommends because a caller that declines to retry a `retry` has only dropped its own work — the
Worker answered correctly, nothing is misread, and how much a caller is willing to spend chasing a
busy dependency is a judgement about that caller's own budget. What this file owes is the class, so
that the choice is informed; the choice itself is not the protocol's.

ENDP-28 forbids a retry and not a later request, and the two are told apart by what the caller
believes rather than by the bytes. A poller coming round on its own schedule is asking a fresh
question about the present, and a credential replaced between two polls should be noticed; a caller
that changed something is sending a different request whatever it looks like. What is forbidden is
the loop — backing off and sending the same thing again because the answer might change on its own,
when the answer has already said it will not. The earlier form of this rule forbade *repeating* a
reject at all, which would have stopped the Control Tower from ever polling an enrolled Worker
again after one refused credential, and that is exactly backwards: the poll is how the operator
finds out the credential was fixed. It is withdrawn below.

The class is stated rather than inferred because inferring it is where this goes wrong in practice.
A caller that treats every unhappy answer as a reason to wait and repeat will, on a wrong path or a
credential missing a scope, retry with backoff for as long as its budget allows and then drop the
work — leaving a log line and no other trace. A contract mismatch becomes slow, quiet data loss,
discovered by whoever eventually goes looking for records that were never written. The distinction
between "you are wrong" and "I am busy" is the single most load-bearing thing this file says, and a
specification that leaves it to be guessed from a status code has chosen that outcome.

**ENDP-29 (required). A response that is not a success carries one of the status codes below, and
the class named beside it. This protocol does not fix the status of a success.**

| Status | Class | What it means |
|---|---|---|
| `400` | `reject` | The request could not be understood: unparseable body, wrong content type, missing or malformed parameter, a body that does not match a declared schema, a version the Worker does not answer, a required idempotency key absent |
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

The table is closed and the success side is not, because the two sides are read by different
readers for different reasons. A failure has to be classified by a caller that cannot see inside
the Worker, which is the whole argument for ENDP-25 and the reason a code may not wander between
statuses. A success is read by a caller that already knows what it asked for, and whether an
accepted Action answers `200` with its outcome, `201` with a resource or `202` because it will
happen later is a question about that Action and belongs to [actions](actions.md). The earlier form
of this rule said a Worker answers with the status codes below, and a table with no 2xx row in it
therefore forbade every success a Worker could give; it is withdrawn below.

Three rules hold the table together:

- **ENDP-11 (required). A Worker does not answer 5xx for a condition that will not change.** A bad
  body answered with a 500 is an instruction to redeliver an unusable payload forever, and the
  sender will comply.
- **ENDP-12 (required). A Worker distinguishes `400` from `422`.** 400 is *I cannot read this*; 422
  is *I read it and I will not have it*. A caller can fix the first by looking at its serializer
  and the second only by looking at its content, and collapsing them into one code makes both look
  like the other.
- **ENDP-13 (required). A caller that cannot classify an answer treats it as `reject`.** Stopping
  loudly on something that would have succeeded costs an alert. Retrying on something that never
  will costs the work, and costs it silently.

**ENDP-14 (required). Where the class and the status code disagree, the class in the envelope wins
when an envelope is present and parses; the status code wins when it is not; and an answer that can
be classified by neither is `reject`.**

The codes, and the status each one is answered with — which is the half of ENDP-26 no schema can
state, because a status code is not in the body.

**This table is a reading aid.** [schemas/error.json](../schemas/error.json) is normative for the
code and the class it carries, and [openapi/](../openapi/) is normative for the status, generated
from the Hono routes in `packages/hono/src/surfaces.ts`. It is written out here because
the argument beneath each code — why `502` and `504` are two of them, why `schema_mismatch` is not
`malformed_request` — is worth a reader's time, and because a reader without a toolchain, whom
`schemas/` exists to serve, would otherwise not be able to read the vocabulary at all.

| Code | Status | Class | The condition, and the rule that already commits to it |
|---|---|---|---|
| `malformed_request` | `400` | `reject` | A body that will not parse, or a content type that is not `application/json` — ENDP-4, ENDP-29 |
| `schema_mismatch` | `400` | `reject` | A body that parses and does not match the schema the surface declared — ACT-8 |
| `invalid_parameter` | `400` | `reject` | A parameter missing or malformed — ENDP-29 |
| `unknown_filter` | `400` | `reject` | A filter parameter the Worker does not recognize — ENDP-24 |
| `unsupported_version` | `400` | `reject` | A requested Capability version the Worker cannot answer — ENDP-6 |
| `idempotency_key_required` | `400` | `reject` | An Action requires a key and none was sent — ENDP-18 |
| `unauthenticated` | `401` | `reject` | No credential, or one the Worker cannot read — ENDP-29 |
| `forbidden` | `403` | `reject` | The credential is understood and does not carry the right — ENDP-29 |
| `not_found` | `404` | `reject` | No such address, or no such resource — ENDP-29, DESC-30 |
| `request_timeout` | `408` | `retry` | The request did not arrive in time to be answered — ENDP-29 |
| `conflict` | `409` | `reject` | The request conflicts with the current state — ENDP-29 |
| `idempotency_key_reused` | `409` | `reject` | A key reused with a different body — ENDP-17 |
| `unprocessable_content` | `422` | `reject` | Well-formed, schema-valid, and refused on the Worker's own rules — ENDP-29, ENDP-12 |
| `rate_limited` | `429` | `retry` | Too many requests — ENDP-29 |
| `internal_error` | `500` | `retry` | The Worker failed for its own reasons — ENDP-29 |
| `unavailable` | `503` | `retry` | Starting, `unhealthy`, or a dependency down — ENDP-29 |
| `upstream_error` | `502` | `retry` | Something the Worker depends on answered badly — ENDP-29 |
| `upstream_timeout` | `504` | `retry` | Something the Worker depends on did not answer in time — ENDP-29 |

Every code above names a condition some rule already states. None was invented to fill a gap, and
where the text has not committed to a condition there is deliberately no code for it: `conflict` is
the only broad one, because ENDP-29 names *a Task already claimed* among its 409s and
[tasks-and-claims](tasks-and-claims.md) had not been written. It has been since, and it wanted no
code of its own: TASK-10, TASK-11 and TASK-17 all answer `conflict`, which is the same broad
condition under three names for it. The price below was therefore not spent there.

[actions](actions.md) is the first file to have spent that price. `schema_mismatch` is not
`malformed_request`, and the difference is what a caller does next: a body that will not parse
at all is a serializer bug in the caller, and a body that parses and does not match is a caller
built against a declaration that has since moved — it re-reads the Descriptor, which is where
the answer is, and ENDP-5's headers already told it the version changed. One code for both
would have sent every caller to the wrong half of its own code, which is ENDP-12's argument
one layer down.

**Closing the vocabulary costs something, and it was taken knowingly: a new code now requires a new
edition.** A caller validating against `error.json` refuses a code that file does not list, which
is precisely what makes a code worth reading — and it means the set cannot grow quietly. The
alternative was an open string, where a conformance check can verify that a code is *present* and
never that it *means* what it says, which is to check almost nothing on the one surface every other
surface leans on.

ENDP-26 forbids one code under two statuses for a reason worth stating: if a code could arrive with
either of two statuses, a caller reading the code would still have to read the status to know what
had happened, and the code would have bought nothing. That rule is what splits ENDP-29's one
`502, 504` row into two codes here. They are genuinely two conditions — a dependency that answered
badly, and one that did not answer at all — and a Worker that could not tell them apart was not
going to send either code accurately.

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

**ENDP-15 (required). An Action declares in the [Descriptor](descriptor.md) whether it requires an
idempotency key; if it does, it declares where the key is read from — the `Idempotency-Key` header
or a named field of the payload — and how long the Worker honors one.**

**ENDP-16 (required). Within that window, a repeat under the same key is not a second performance:
the Worker answers the outcome it recorded.**

**ENDP-17 (required). A key reused with a different body is `409`.**

**ENDP-18 (required). A required key that is absent is `400`.**

**An Action that declares no key is at-least-once under retry, and a caller that retries one
accepts that it may happen twice.** That is emphasis and not an obligation, deliberately: it
forbids nothing and requires nothing of anybody, it states what guarantee a caller is buying. It
was written as a rule and carried an id until somebody asked what a conformance check would observe
when it was broken, and the answer was that nothing can break it. This file orders retries — that
is what ENDP-30 is — so it owes the plain statement of what a retry costs where nothing protects
it, and owes it in prose. A specification that orders a retry and offers no safe way to perform one
is incoherent; this one offers the way and says where it does not apply.

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

**ENDP-20 (required). Every surface that answers a list answers it in the shared page envelope: the
items, and a cursor for the next page which is absent at the end.**

**ENDP-21 (required). A cursor is opaque, is produced only by the Worker, and is never constructed
by a caller.**

**ENDP-31 (required). A caller reads how many items it received, never how many it asked for.**

**ENDP-19 (recommended). A Worker caps the page size it answers rather than negotiating it.**

**ENDP-23 (required). A collection declares an order and holds it**, so that paging through it
terminates.

**ENDP-24 (required). An unrecognized filter parameter is `400`, and is never ignored.**

One envelope for every collection is the same purchase as one verb: a client that can page through
a Worker's Tasks can page through its Alerts and its metrics without being told how, and a
verifier checks paging once for the whole protocol rather than once per surface. ENDP-21 keeps that
cheap. A cursor a caller may construct is a cursor whose format the Worker can never change and
whose meaning it must honor forever, because somewhere a client is building one out of a timestamp
and an id it read off a page; opaque, it is a token the Worker may re-mean between releases and
nobody notices. What the caller gives up is the ability to resume from a position it computed
itself, which no reader of this protocol has asked for.

ENDP-31 and ENDP-19 were one rule and are two, because only the first half of it binds. A caller
that assumes it received the page size it asked for reads a short page as the end of a collection
and stops early — it has silently lost the rest, and no Worker can prevent it. That is a contract
between the two and it has to hold whatever the Worker does about sizes.

What the Worker does about sizes is advice. Negotiating buys nothing a caller could rely on, since
the cap wins regardless and ENDP-31 makes the caller read what arrived anyway; and it is not free,
because a parameter one Worker honors is a parameter every other Worker must recognize or answer
`400` under ENDP-24, so the cost of the hint is paid by every implementer and collected by none.
That is a good reason and it is not a contract: a Worker that does honor a requested size, up to
its cap, breaks nothing and no caller can tell. It answers to its own operators for the choice.

Filters belong to the surfaces that have them — which Tasks a consumer may claim, which period a
metric covers — and each file names its own. ENDP-24 is about the one a Worker does not know,
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

- **ENDP-9** — required a caller to back off and repeat a `retry` unchanged. Replaced by
  **ENDP-30**, the same sentence as a recommendation. A caller that declines to retry drops its own
  work and nobody else's; the Worker answered correctly, nothing is misread, and how long a caller
  chases a busy dependency is a judgement about its own budget. A caller that gave up failed ENDP-9
  and now merely does not follow ENDP-30, so the id did not survive.
- **ENDP-22** — required that a Worker cap the page size rather than negotiating it, *and* that a
  caller read how many items it received. Replaced by **ENDP-31**, which keeps the caller's half as
  an obligation, and **ENDP-19**, which makes the Worker's half a recommendation. Only the first
  half is a contract: a caller that assumes it got the size it asked for stops early and loses the
  rest of a collection. A Worker that honors a requested size up to its cap breaks nothing and no
  caller can tell, so it failed ENDP-22 and now merely does not follow ENDP-19.
- **ENDP-8** — required that a caller not *repeat* a `reject`. Replaced by **ENDP-28**, which
  forbids retrying one. The argument beneath it was always about a caller that backs off and sends
  the same thing again because the answer might change on its own; read literally it also forbade
  the Control Tower from polling an enrolled Worker on its schedule after one refused credential,
  which is how the operator learns the credential was fixed (REG-19). A poller that came round
  again failed ENDP-8 and satisfies ENDP-28, so the rewrite widens what is allowed and the id did
  not survive.
- **ENDP-10** — required that a Worker answer with the status codes in the table beneath it.
  Replaced by **ENDP-29**, which scopes that to responses that are not a success and says that this
  protocol does not fix the status of a success. The table has never had a 2xx row, so ENDP-10 read
  literally forbade every success a Worker could give — including the `202` an asynchronous Action
  wants, which [actions](actions.md) has yet to decide about. A Worker answering `201` failed
  ENDP-10 and satisfies ENDP-29, so the id did not survive.
- **ENDP-7** — required that every unsuccessful response carry a code, a message and a class, with
  the code an unconstrained "stable machine-readable" string. Replaced by **ENDP-25**, which draws
  the code from the closed enumeration in [schemas/error.json](../schemas/error.json). A code of
  `banana` satisfied ENDP-7 and does not satisfy ENDP-25, so the rewrite could change a verdict and
  took a new id. ENDP-26 and ENDP-27, which say how a code relates to a status and a class, are new
  and retire nothing.

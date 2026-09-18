# Verifiability inventory

Every rule in the seven `draft` files, classified by what a check would observe. This is the audit
[spec/README.md](../spec/README.md) demands of itself — *a rule earns its place only if you can name
what a conformance check would observe when it is broken* — run for the first time, and it is also
the specification of what `packages/conformance` implements.

## The four classes

**The line between `W` and `H` is arrangement, not data.** A rule is `W` when a violation is visible
to a tool holding one ordinary credential against a Worker in whatever state it happens to be in; a
Worker with no metric buckets yet exercises no bucket rule, and that is the `not exercised` verdict
in [README.md](README.md) rather than a different class. A rule is `H` only when the Worker has to
be *arranged* for the check to be possible at all — a second credential issued, a boot window left
pollable, an address that refuses a body on its content. The two were one line in the first pass of
this document, and separating them moved six rules.

| Class | Meaning | Count |
|---|---|---|
| **W** | Observable against a Worker at its base URL with one ordinary credential. Nothing else needed. | 65 |
| **H** | Observable only against a Worker arranged to be observed, and described to the verifier: the arrangement is handed in out of band, exactly as a base URL and a credential are. | 12 |
| **P** | The subject is not a Worker. The rule binds a verifier, a Control Tower, a consumer, an issuer, or this specification. No tool pointed at a base URL can reach it. | 21 |
| **N** | No witness anywhere. Three are the exception [spec/README.md](../spec/README.md) admits; fourteen are not on that list. | 17 |
| **—** | Blocked: the surface the rule is about belongs to a file that is still `open`. | 2 |

## descriptor.md — 25

| Rule | Class | What a check observes, or why nothing does |
|---|---|---|
| DESC-1 | W | `GET {base}/.well-known/worker-protocol` answers a document that validates |
| DESC-2 | P | Binds a verifier and a Tower: neither may require a Capability. No Worker witness — a Worker declaring none is the passing case |
| DESC-3 | W | The route resolves beneath the enrolled base URL, scheme is `https` |
| DESC-5 | W | GET answers; a second GET answers the same |
| DESC-6 | W | The id compared against the base URL the Descriptor was read from |
| DESC-8 | W | Every undotted name is in `capability-name.json` |
| DESC-9 | W | A single integer, read off the entry |
| DESC-11 | W | The condition, read off the entry. ACT-12 is the first case and gives it a shape, so this no longer needs a Worker arranged for it |
| DESC-12 | W | Each address is absolute `https` or resolves relative |
| DESC-13 | P | Binds a client. Observable only in the client's own behaviour |
| DESC-14 | W | Dotted vs undotted, read off the declaration |
| DESC-15 | P | Binds a verifier — checkable, against the verifier |
| DESC-16 | P | Binds a verifier |
| DESC-18 | W | A declared address that answers `404` |
| DESC-19 | P | Binds a verifier |
| DESC-20 | N | Admitted exception. A fact inside the Tower |
| DESC-21 | P | Binds a consumer |
| DESC-22 | W | `capabilities` is a map, each entry carries a version |
| DESC-23 | W | Exactly one edition, `MAJOR.MINOR`, parses and orders |
| DESC-24 | N | Binds whoever edits this specification across editions. No single-Worker witness |
| DESC-25 | P | Binds a verifier |
| DESC-26 | N | Admitted exception. A second Descriptor at an address nobody enumerated |
| DESC-27 | N | Derivation is invisible from outside, and a move is two deployments. Split from DESC-6 so that the clause with a witness can be reported on its own |
| DESC-28 | N | Opacity, stability and freedom from ambient context are properties of an id's behaviour over time, not of the string a reader holds |
| DESC-29 | N | What a version counts is a claim about the Worker's own history. Split from DESC-9 for the same reason as above |

## endpoints.md — 26

| Rule | Class | What a check observes, or why nothing does |
|---|---|---|
| ENDP-1 | W | Every address called is one the Descriptor declared. The negative — that no undeclared surface exists — is unreachable and is not what the rule says |
| ENDP-2 | W | A GET, repeated, leaves the readable state unchanged |
| ENDP-3 | W | Declared write addresses accept POST |
| ENDP-4 | W | `application/json`, UTF-8, parses |
| ENDP-5 | W | Both headers on every response. Cheapest strong check in the protocol |
| ENDP-6 | W | Send an unanswerable Capability version, expect `400` + `unsupported_version` |
| ENDP-11 | W | Judged over the transcript. Every probe this verifier sends is deliberately and permanently wrong — an Action no entry declares, a filter no surface knows, a credential never issued — so a `5xx` to any of them is the rule broken, and no arrangement is needed to provoke one |
| ENDP-12 | H | The Worker must offer an address that parses a body and refuses it on its content |
| ENDP-13 | P | Binds a caller |
| ENDP-14 | P | Binds a caller |
| ENDP-15 | W | The declaration itself, read off an Action's entry; ACT-12 gives it a shape |
| ENDP-16 | H | Needs a performance, repeated under the same key, against a Worker that offers one that is safe to perform |
| ENDP-17 | H | Needs one performance to record a key, then a second body under it |
| ENDP-18 | W | An Action that requires a key, posted without one, is `400` and performs nothing |
| ENDP-19 | W | Recommended. A collection longer than the cap answers a capped page |
| ENDP-20 | W | Every list answers the page envelope |
| ENDP-21 | P | *Opaque* is unfalsifiable from outside; *never constructed by a caller* binds the caller |
| ENDP-23 | W | Page twice, check the order holds and paging terminates |
| ENDP-24 | W | An invented filter parameter is `400` + `unknown_filter` |
| ENDP-25 | W | Every non-success carries code, message, class |
| ENDP-26 | W | Across every response collected, no code under two statuses |
| ENDP-27 | P | Binds a caller |
| ENDP-28 | P | Binds a caller |
| ENDP-29 | W | Every non-success status is in the table with the class beside it |
| ENDP-30 | P | Binds a caller |
| ENDP-31 | P | Binds a caller |

## registration.md — 17

| Rule | Class | What a check observes, or why nothing does |
|---|---|---|
| REG-3 | W | `Authorization: Bearer` is accepted; another scheme is not required to work |
| REG-7 | W | A declared address with a bad credential answers `401`/`403`, never `404` |
| REG-8 | H | Two credentials must exist; the two Descriptors are compared |
| REG-13 | P | Binds a Tower |
| REG-14 | P | Binds a Tower |
| REG-16 | P | Binds a Tower and an operator. The origin list is state outside the Worker |
| REG-19 | P | Binds a Tower |
| REG-21 | W | The recorded credential is accepted on every declared address and on the Descriptor route |
| REG-24 | N | Nothing outside can see whether the owner called the Tower. Running with the Tower down is an arrangement of the whole deployment, not an observation of this Worker |
| REG-26 | N | The file says it: no Worker can tell how it got into a registry |
| REG-27 | N | The file says it: it binds an issuer who is party to no call |
| REG-28 | H | Recommended. Two credentials must be issued to one holder, both live at once |
| REG-29 | P | Binds a Tower |
| REG-30 | P | Binds a Tower |
| REG-31 | W | Recommended. A POST to the Actions address with no credential. `actions` gives this rule the state-changing address it was waiting for |
| REG-32 | H | Recommended. A credential must exist that authenticates and lacks a right, so two refusals can be compared |
| REG-33 | N | Who issued a credential is not in the credential |

## actions.md — 15

| Rule | Class | What a check observes, or why nothing does |
|---|---|---|
| ACT-1 | W | The `actions` entry carries an address and a map of Actions |
| ACT-2 | W | Each Action carries the schema of its input |
| ACT-3 | W | Each Action says what it answers on success |
| ACT-4 | W | Each Action says whether it completes within the call |
| ACT-5 | H | A successful POST *performs* something. Only a Worker arranged with an Action that is safe to perform can be asked, which is why this is the one rule about performing that a verifier may not provoke on its own |
| ACT-6 | W | An Action name no entry declares is `404` + `not_found`, and nothing is performed |
| ACT-7 | W | A request naming no Action is `400` + `invalid_parameter`, and nothing is performed |
| ACT-8 | W | An input no declared schema could accept is `400` + `schema_mismatch`, and nothing is performed |
| ACT-9 | H | The Worker must offer an input that is schema-valid and that it refuses on its own rules |
| ACT-10 | H | Needs a performance that succeeds |
| ACT-11 | H | Needs an Action that declares it does not complete, and a performance of it |
| ACT-12 | W | The idempotency declaration ENDP-15 requires, read off the entry |
| ACT-13 | N | A Worker that declares `configure` meaning something else is indistinguishable from one that means this. What a name is reserved FOR has no witness; what a Worker must then serve does, and that is ACT-15's |
| ACT-14 | H | Replacing a Worker's settings is the most consequential thing this protocol can do to one |
| ACT-15 | W | A GET of the declared reading address answers a document `configure` would accept |

## naming.md — 9

| Rule | Class | What a check observes, or why nothing does |
|---|---|---|
| NAME-1 | W | Any declared name carrying an uppercase letter — a dimension, an Action, a metric — sent back folded and expected not to match. A Worker whose declarations are all lowercase exercises nothing, which is `not exercised` and not a weaker class |
| NAME-2 | N | The file says it: this protocol has no mechanism that would catch it |
| NAME-3 | P | Recommended. Binds this specification, not a Worker |
| NAME-4 | — | `tasks` and `alerts` are `open`; there is no surface to expose an Alarm on |
| NAME-5 | N | The file says it: part of the test needs a person |
| NAME-6 | N | Same |
| NAME-7 | — | The three names that cross — Task type, Skill, event type — all live in `open` files. Nothing serves one today |
| NAME-8 | N | The file says it: no verifier can report it |
| NAME-9 | N | Not checkable against one Worker. Needs a corpus |

**No rule in this file is checkable against a Worker without arranging one.**

## health.md — 5

| Rule | Class | What a check observes, or why nothing does |
|---|---|---|
| HLTH-1 | W | The `health` entry carries an address. Fails without calling anything |
| HLTH-2 | W | One status, a map of checks, both from the three values |
| HLTH-3 | W | A body answering `healthy` with a check that is not. Visible whenever it occurs, in any poll |
| HLTH-4 | H | The Worker must leave the window between start and first evaluation pollable |
| HLTH-5 | W | The health address answers `200` whatever it reports |

## metrics.md — 20

| Rule | Class | What a check observes, or why nothing does |
|---|---|---|
| MET-1 | W | The entry carries an address |
| MET-2 | W | Every metric read is one the entry declared, and the surface lists none |
| MET-3 | W | Unit, additivity, at least one granularity, from the five |
| MET-4 | W | Dimensions keyed by name, closed set or none |
| MET-5 | W | No dimension named `metric`, `granularity`, `from`, `to`, `by` or the cursor parameter. The rule the file says has no schema witness — it has a verifier witness |
| MET-6 | W | The entry declares one IANA zone |
| MET-7 | W | A `week` bucket beginning on a Monday, numbered by ISO 8601 |
| MET-8 | W | Granularity required where more than one is declared |
| MET-9 | W | An undeclared metric is `404` + `not_found` |
| MET-10 | W | An undeclared granularity is `400` + `invalid_parameter` |
| MET-11 | W | Two adjacent reads share a boundary instant and no bucket twice |
| MET-12 | W | An interval starting mid-bucket returns whole buckets |
| MET-13 | W | Every bucket carries start, end and a value |
| MET-14 | W | Buckets ascend, with the tiebreak under `by` |
| MET-15 | N | Admitted exception. Nothing outside distinguishes a dropped bucket from a quiet one |
| MET-16 | W | A dimension is spelled as a parameter of the same name |
| MET-17 | W | A value outside a declared set is `400` + `invalid_parameter` |
| MET-18 | W | The file names the check: an unfiltered answer smaller than one of its own filtered answers over the same interval, on a metric that only accumulates upward |
| MET-19 | W | `by` on a free dimension is refused |
| MET-20 | W | Every bucket's start and end land on a boundary cut in the declared zone. Split from MET-6, whose two halves a report could otherwise only pass or fail together |

**The most checkable file in the specification**: 19 of 20, and the twentieth is an admitted
exception. Several need buckets to exist before they say anything, which is `not exercised` and not
a weaker class.

## What this audit found

**1. Twenty-one rules bind somebody other than a Worker, and a tool pointed at a base URL reaches
none of them.** `packages/conformance` is described as *point it at a worker's base URL, get a
report of what it complies with*. [spec/README.md](../spec/README.md) already anticipates the
consequence — *the subject of a rule is whoever the sentence names … which is why a report says
which of these it was checking* — but no tool has ever had to act on it. Settled: the verifier's
subject stays the Worker, and the report carries a verdict for these rather than omitting them.
[README.md](README.md) holds the vocabulary.

**2. Nine rules need a Worker built to be observed, and they are a short, specific shopping list.**
Two credentials for one holder (REG-8, REG-28, REG-32, one of them authenticating without a right);
a boot window left pollable (HLTH-4); a condition that will not change, induced (ENDP-11); an
address that parses a body and refuses it on content (ENDP-12); a state-changing address (REG-31); a
declared name with a capital in it (NAME-1); a Capability whose behaviour on a call is conditional
(DESC-11). That is what the reference Worker is *for* — it is a conformance fixture, not a demo, and
everything on this list is a deliberate arrangement rather than a feature anybody would otherwise
build.

**3. Thirteen rules have no witness and are not on the admitted list.** The exception
[spec/README.md](../spec/README.md) admits names DESC-26 and DESC-20 only. DESC-24, DESC-27,
DESC-28, DESC-29, REG-24, REG-26, REG-27, REG-33, NAME-2, NAME-5, NAME-6, NAME-8 and NAME-9 are
equally unreachable. Most already say so in their own prose, which is the obligation met — but the
list in the README is incomplete, and a reader extracting the bold lines cannot tell. This document
is the exhaustive register whether or not the README ever becomes one.

**4. Three ids carried more than one obligation, and have been split.** DESC-6 bundled four,
DESC-9 two and MET-6 two, against [spec/README.md](../spec/README.md)'s *an id belongs to one
independently checkable obligation*. DESC-6 now says only that the id is not the URL, which is the
clause a verifier can reach, and DESC-27 and DESC-28 carry the rest; DESC-9 keeps the integer and
DESC-29 takes what it counts; MET-6 keeps the declaration and MET-20 takes the cutting. No edition
is published, so under [spec/README.md](../spec/README.md) each rule was edited in place and
nothing was withdrawn — which is the cheapest this correction will ever be.

**5. `naming.md` has nothing a tool can check and `registration.md` has three.** Zero and three of
seventeen. Neither is a defect on its own — naming is largely about names that only exist in `open`
files, and registration deliberately pushed lifecycle out to an identity provider — but a report
against those two files will be almost entirely *unverified* and *other subject*, and that should be
a known outcome rather than a surprise in the first run.

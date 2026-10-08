# Verifiability inventory

Every rule in the fourteen `draft` files — all of them — classified by what a check would observe.
This is the audit [spec/README.md](../spec/README.md) demands of itself — *a rule earns its place
only if you can name what a conformance check would observe when it is broken* — run for the first
time, and it is also the specification of what `packages/conformance` implements.

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
| **W** | Observable against a Worker at its base URL with one ordinary credential. Nothing else needed. | 105 |
| **H** | Observable only against a Worker arranged to be observed, and described to the verifier: the arrangement is handed in out of band, exactly as a base URL and a credential are. | 37 |
| **P** | The subject is not a Worker. The rule binds a verifier, a Control Tower, a consumer, an issuer, a subscriber, or this specification. No tool pointed at a base URL can reach it. | 28 |
| **N** | No witness anywhere, and the subject is the Worker — where the subject is somebody else the class is `P`, because that is what a report has to say. [spec/README.md](../spec/README.md) names two of these as its worked examples; this table is the register of all of them. | 22 |
| **—** | Blocked: the surface the rule is about belongs to a file that is still `open`. | 0 |

## Where a `P` rule has a witness anyway

**`P` says what a report may claim, and not that nothing anywhere checks the rule.** The class is
about the subject: a tool pointed at a Worker's base URL never contacted a consumer, a Tower or an
issuer, so it says *other subject* rather than passing one — and that stays true whatever else
exists in this repository. What changes is that some of those parties now exist here, and a rule
with a party has somewhere to be true.

| Subject | Rules | Where they are checked |
|---|---|---|
| A consumer or a caller | DESC-13, DESC-38, ENDP-13, ENDP-14, ENDP-21, ENDP-27, ENDP-28, ENDP-30, ENDP-31 | `packages/client`, one test per id, against a Worker made to misbehave |
| A Control Tower | DESC-19, DESC-20, REG-35, REG-14, REG-16, REG-19, REG-29, REG-30, REG-36 | `packages/conformance/src/__tests__/tower.test.ts`, a Tower simulated over the example Workers; REG-36's comparison is `compare` in `packages/client` |
| A verifier | DESC-34, DESC-15, DESC-16, DESC-19, DESC-33 | `packages/conformance` itself, which is the verifier they bind |
| An issuer, a subscriber, this specification | REG-27, REG-33, EVT-5, EVT-6, EVT-7, NAME-3 | Nowhere, and the subject is the reason: no party here issues a credential or subscribes to a broker |

The nine consumer rules had no witness anywhere until `@worker-protocol/client` existed, which is
the honest reason to say so here: they were required, they were unobservable, and nobody had ever
written the party they oblige. What the Tower rules have is weaker and worth naming as such — a
simulation is a party this repository wrote to its own reading of the rules, so it demonstrates
that the role is implementable and vouches for no product.

## The edition a rule arrived in

**Every row says which edition introduced its rule, because DESC-31 has a verifier judge a Worker
only by the rules its declared edition contains.** A Worker built to 0.2 and correct in it is
correct, and a verifier holding 0.3 that failed it for a rule 0.3 added would be blaming it for an
edition it never claimed. The column is the source the verifier's universe is generated from, and
it is written here rather than read off git, because `spec/README.md` will not let a rule turn on
what was pushed where. The first load was derived once from the published tags: the 11 rules edition
0.2 added are ENDP-33 and the ten of `logs.md`, and every other rule that was in force at 0.2 dates
from 0.1. A withdrawn rule has no row here; its `Withdrawn` entry carries both of its editions.

## descriptor.md — 26

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| DESC-1 | W | 0.1 | `GET {base}/.well-known/worker-protocol` answers a document that validates |
| DESC-35 | W | 0.4 | The base URL is absolute and `https`, or `http` on a loopback host |
| DESC-5 | W | 0.1 | GET answers; a second GET answers the same |
| DESC-6 | W | 0.1 | The id compared against the base URL the Descriptor was read from |
| DESC-8 | W | 0.1 | Every undotted name is in `capability-name.json` |
| DESC-9 | W | 0.1 | A single integer, read off the entry |
| DESC-37 | W | 0.4 | Where what a caller sends or whether it may repeat a call depends on a condition, the entry declares it; an idempotency declaration is the first case |
| DESC-36 | W | 0.4 | Every absolute address is `https`, or `http` on a loopback host |
| DESC-13 | P | 0.1 | Binds a client. Observable only in the client's own behaviour |
| DESC-14 | W | 0.1 | Dotted vs undotted, read off the declaration |
| DESC-15 | P | 0.1 | Binds a verifier — checkable, against the verifier |
| DESC-16 | P | 0.1 | Binds a verifier |
| DESC-18 | W | 0.1 | A declared address that answers `404` |
| DESC-19 | P | 0.1 | Binds a verifier |
| DESC-20 | P | 0.1 | Binds a Tower. It is also unobservable, as every Tower rule is, and the class goes to the SUBJECT: `unverified` is what a report says about a rule whose subject is the Worker, and saying it here would vouch for a party the tool never contacted |
| DESC-38 | P | 0.4 | Binds a consumer |
| DESC-22 | W | 0.1 | `capabilities` is a map, each entry carries a version |
| DESC-23 | W | 0.1 | Exactly one edition, `MAJOR.MINOR`, parses and orders |
| DESC-31 | P | 0.3 | Binds a verifier, and `packages/conformance` obeys it: against a Worker that declares an earlier MINOR it judges only the rules that edition contains, and reports every later one as not exercised, naming the edition that introduced it |
| DESC-32 | N | 0.4 | Binds whoever edits this specification across editions, including the `0.x` clause. No single-Worker witness |
| DESC-33 | P | 0.4 | Binds a verifier, and `packages/conformance` obeys it: it stops the run and reports itself older when it does not hold the declared MAJOR, or, while the MAJOR is 0, when the Worker declares a later MINOR |
| DESC-34 | P | 0.4 | Binds a verifier and a Tower: neither may require a Capability. No Worker witness — a Worker declaring none is the passing case |
| DESC-26 | N | 0.1 | Admitted exception. A second Descriptor at an address nobody enumerated |
| DESC-27 | N | 0.1 | Derivation is invisible from outside, and a move is two deployments. Split from DESC-6 so that the clause with a witness can be reported on its own |
| DESC-28 | N | 0.1 | Opacity, stability and freedom from ambient context are properties of an id's behaviour over time, not of the string a reader holds |
| DESC-29 | N | 0.1 | What a version counts is a claim about the Worker's own history. Split from DESC-9 for the same reason as above |

## endpoints.md — 31

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| ENDP-1 | W | 0.1 | Every address called is one the Descriptor declared. The negative — that no undeclared surface exists — is unreachable and is not what the rule says |
| ENDP-2 | W | 0.1 | A GET, repeated, leaves the readable state unchanged |
| ENDP-4 | W | 0.1 | `application/json`, UTF-8, parses |
| ENDP-37 | W | 0.4 | Every response carries the edition; every response from a declared Capability address also carries its version, and the Descriptor's does not need one |
| ENDP-6 | W | 0.1 | Send an unanswerable Capability version, expect `400` + `unsupported_version` |
| ENDP-11 | W | 0.1 | Judged over the transcript. Every probe this verifier sends is deliberately and permanently wrong — an Action no entry declares, a filter no surface knows, a credential never issued — so a `5xx` to any of them is the rule broken, and no arrangement is needed to provoke one |
| ENDP-12 | H | 0.1 | The Worker must offer an address that parses a body and refuses it on its content |
| ENDP-13 | P | 0.1 | Binds a caller |
| ENDP-14 | P | 0.1 | Binds a caller |
| ENDP-38 | W | 0.4 | The declaration itself, read off an Action's entry: the header, or one or more named members, and the window; ACT-19 gives it a shape |
| ENDP-16 | H | 0.1 | Needs a performance, repeated under the same key, against a Worker that offers one that is safe to perform |
| ENDP-17 | H | 0.1 | Needs one performance to record a key, then a second body under it |
| ENDP-18 | W | 0.1 | An Action that requires a key, posted without one, is `400` and performs nothing |
| ENDP-19 | W | 0.1 | Recommended. A collection longer than the cap answers a capped page |
| ENDP-20 | W | 0.1 | Every list answers the page envelope |
| ENDP-21 | P | 0.1 | *Opaque* is unfalsifiable from outside; *never constructed by a caller* binds the caller |
| ENDP-23 | W | 0.1 | Page twice, check the order holds and paging terminates |
| ENDP-24 | W | 0.1 | An invented filter parameter is `400` + `unknown_filter` |
| ENDP-33 | H | 0.2 | Page twice while the collection is being added to, and check the second page repeats nothing from the first. It needs a Worker whose collection changes on demand, which is `logs` with a Worker that records when it is read — under an offset the arrivals push the collection along and the repeat is the failure |
| ENDP-39 | W | 0.4 | Every 4xx and 5xx response carries code, message and class |
| ENDP-26 | W | 0.1 | Across every response collected, no code under two statuses |
| ENDP-27 | P | 0.1 | Binds a caller |
| ENDP-28 | P | 0.1 | Binds a caller |
| ENDP-40 | W | 0.4 | Every 4xx and 5xx status is in the table with the class beside it |
| ENDP-41 | W | 0.4 | Judged over the transcript: no request this verifier sends is answered with a redirect, and a `304` comes only to a conditional read |
| ENDP-30 | P | 0.1 | Binds a caller |
| ENDP-31 | P | 0.1 | Binds a caller |
| ENDP-32 | H | 0.1 | Two requests must overlap under one key, which needs an Action safe to perform and slow enough that the second arrives before the first has recorded |
| ENDP-34 | H | 0.3 | Needs a credential the Worker attributes to another caller, a header-keyed Action safe to perform and a second input for it: one caller performs, the other posts the other input under the same key, and it must be performed — not `409`, and not the first caller's outcome |
| ENDP-35 | H | 0.3 | Needs the same credential and an input-keyed Action safe to perform with a second input: one caller performs, the other posts the other input carrying the same key, and it must be `409` |
| ENDP-36 | W | 0.4 | The Actions address answers a POST, and does not serve the same operation to a GET |

## registration.md — 18

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| REG-3 | W | 0.1 | `Authorization: Bearer` is accepted; another scheme is not required to work |
| REG-7 | W | 0.1 | A declared address with a bad credential answers `401`/`403`, never `404` |
| REG-8 | H | 0.1 | Two credentials must exist; the two Descriptors are compared |
| REG-35 | P | 0.4 | Binds a Tower |
| REG-14 | P | 0.1 | Binds a Tower |
| REG-16 | P | 0.1 | Binds a Tower and an operator. The origin list is state outside the Worker |
| REG-19 | P | 0.1 | Binds a Tower |
| REG-34 | W | 0.4 | The recorded credential is accepted on the Descriptor route and on every declared reading address; a write may refuse it, with `403` and never `401` |
| REG-24 | N | 0.1 | Nothing outside can see whether the owner called the Tower. Running with the Tower down is an arrangement of the whole deployment, not an observation of this Worker |
| REG-26 | N | 0.1 | The file says it: no Worker can tell how it got into a registry |
| REG-27 | N | 0.1 | The file says it: it binds an issuer who is party to no call |
| REG-28 | H | 0.1 | Recommended. Two credentials must be issued to one holder, both live at once |
| REG-29 | P | 0.1 | Binds a Tower |
| REG-30 | P | 0.1 | Binds a Tower |
| REG-31 | W | 0.1 | Recommended. A POST to the Actions address with no credential. `actions` gives this rule the state-changing address it was waiting for |
| REG-32 | H | 0.1 | Recommended. A credential must exist that authenticates and lacks a right, so two refusals can be compared |
| REG-33 | N | 0.1 | Who issued a credential is not in the credential |
| REG-36 | P | 0.4 | Recommended. Binds a Tower, and needs two moments of one Worker that no verifier holds |

## actions.md — 15

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| ACT-16 | W | 0.1 | The `actions` entry carries an address and an `accepts` map of Actions |
| ACT-2 | W | 0.1 | Each Action carries the schema of its input |
| ACT-3 | W | 0.1 | Each Action says what it answers on success |
| ACT-4 | W | 0.1 | Each Action says whether it completes within the call |
| ACT-5 | H | 0.1 | A successful POST *performs* something. Only a Worker arranged with an Action that is safe to perform can be asked, which is why this is the one rule about performing that a verifier may not provoke on its own |
| ACT-6 | W | 0.1 | An Action name no entry declares is `404` + `not_found`, and nothing is performed |
| ACT-7 | W | 0.1 | A request naming no Action is `400` + `invalid_parameter`, and nothing is performed |
| ACT-8 | W | 0.1 | An input no declared schema could accept is `400` + `schema_mismatch`, and nothing is performed |
| ACT-17 | H | 0.4 | The Worker must offer an input that is schema-valid and that it refuses on its own rules |
| ACT-10 | H | 0.1 | Needs a performance that succeeds |
| ACT-18 | H | 0.4 | An Action declared not to complete within the call answers `202`, with its declared result as the body where it declares one |
| ACT-19 | W | 0.4 | The idempotency declaration ENDP-38 requires, read off the entry |
| ACT-13 | N | 0.1 | A Worker that declares `configure` meaning something else is indistinguishable from one that means this. What a name is reserved FOR has no witness; what a Worker must then serve does, and that is ACT-21's |
| ACT-20 | H | 0.4 | Replacing a Worker's settings is the most consequential thing this protocol can do to one |
| ACT-21 | W | 0.4 | `configure` has a reading address, and it answers a document its own input schema would accept, without the members marked `writeOnly` |

## tasks.md — 12

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| TASK-27 | W | 0.1 | The entry carries one address, which a read answers Tasks from |
| TASK-35 | W | 0.5 | Every Task type it raises, with a payload schema and the Actions that answer it — none, one or several — each of which its `actions` entry accepts |
| TASK-36 | W | 0.5 | The Task types it answers, read off the Descriptor root under `skills`, keyed by type, with what it produces keyed by answering Action. The schemas an entry may declare are validated by the schema and not otherwise reached: whether a Worker requires or produces the right thing has no witness against that Worker alone, and `packages/client`'s `canAnswer` is where two Descriptors are compared |
| TASK-4 | W | 0.1 | Every Task type name is a qualified name |
| TASK-5 | W | 0.1 | A read answers the page envelope. A Worker with no condition holding exercises nothing, which is `not exercised` |
| TASK-6 | H | 0.1 | Two credentials covering different Tasks must exist before two lists can be compared |
| TASK-8 | W | 0.1 | A type the entry does not declare is `400` + `invalid_parameter` |
| TASK-15 | N | 0.1 | A Task that disappears may have had its condition stop holding at that moment for reasons of its own. Nothing outside can tell — which is exactly why the rule matters |
| TASK-19 | N | 0.1 | Recommended. What a nudge IS has no witness: an owner notifying by some other means is indistinguishable from one that does not notify at all |
| TASK-37 | W | 0.5 | Each Task read that carries `inputs` fills in only Actions its type names, members their inputs declare, and values those members accept. A page where no Task carries it is `not exercised`. The value is judged against what the member's schema fixes — `type`, `const`, `enum` — and no further, as TASK-28's payload is not validated against its declared schema either |
| TASK-38 | W | 0.5 | Each Task read that carries `available` names only Actions its type names. Whether the Worker then accepts them is a statement about the moment of the read, and a later `409` does not contradict it |
| TASK-28 | W | 0.1 | Each Task carries its id, type, payload and the instant its condition began |

**Sixteen rules of the Claim lifecycle were withdrawn**, and with them the only checks in this tool
that changed a Worker: taking a lease, renewing it, closing it, and the fencing token that refused a
stale Response. `spec/tasks.md` carries the argument. Every check that is left is a GET.

## alerts.md — 8

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| ALRT-1 | W | 0.1 | The `alerts` entry carries an address |
| ALRT-2 | W | 0.1 | A read answers the page envelope. A Worker with no condition holding exercises nothing, which is `not exercised` |
| ALRT-3 | W | 0.1 | Each Alert carries its id, severity, the instant it began, a summary and its Actions |
| ALRT-4 | W | 0.1 | Every severity is one of the two |
| ALRT-8 | N | 0.4 | An Alert that disappears may have had its condition stop holding, or may have been dismissed by somebody the verifier never saw. Nothing outside can tell — which is the same shape as TASK-15 and the same reason it matters |
| ALRT-6 | H | 0.1 | Two credentials must exist before two lists can be compared |
| ALRT-7 | W | 0.1 | Every Action an Alert offers is one the Worker's own `actions` entry accepts. An agreement between two entries, which no schema reaches |
| ALRT-9 | W | 0.5 | Each Alert read that carries `inputs` fills in only Actions it offers, members their inputs declare, and values those members accept. The value is judged against what the member's schema fixes — `type`, `const`, `enum` — and no further, as TASK-28's payload is not validated against its declared schema either |

## activity.md — 6

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| ACTV-1 | W | 0.1 | The `activity` entry carries an address |
| ACTV-2 | W | 0.1 | A read answers the page envelope. A Worker holding nothing exercises nothing, which is `not exercised` |
| ACTV-3 | W | 0.1 | Each activity carries its id, its state, the instant it entered that state, and a summary |
| ACTV-4 | W | 0.1 | Every state is one of the three |
| ACTV-7 | N | 0.4 | An activity that disappears may have finished, failed or been dropped. Nothing outside can tell — the same shape as ALRT-8 and TASK-15, and the same reason it matters |
| ACTV-6 | H | 0.1 | Two credentials must exist before two lists can be compared |

## nudges.md — 3

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| NDG-1 | W | 0.1 | The `nudges` entry carries an address |
| NDG-2 | H | 0.1 | A nudge that is accepted sends the Worker to read somebody's Tasks, so it needs a Worker arranged to be told — the same position ACT-5 is in, and the same permission |
| NDG-3 | W | 0.1 | A nudge for a type the Worker declares no Skill for is `404` + `not_found`, and nothing happened. The same shape as ACT-6, and W for the same reason: the witness is a refusal |

## events.md — 11

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| EVT-1 | H | 0.1 | The verifier holds no broker and sees no event. An arrangement would have to hand it one the Worker published |
| EVT-13 | W | 0.4 | The entry declares the broker, the `protocolBinding` and the destination together, or none of them |
| EVT-14 | W | 0.4 | A Worker that declares `events` declares a broker, `subscriptions`, or both — read off the two entries |
| EVT-15 | H | 0.4 | Observed at an arranged sink, when the Action that publishes publishes a lifecycle type: the resource's id in `subject`, its property as the named extension |
| EVT-12 | W | 0.1 | Every event type it publishes under `publishes`, each with the schema of its data |
| EVT-4 | W | 0.1 | Every event type name is a qualified name |
| EVT-5 | P | 0.1 | Binds the Tower, which brokers the Contract, and states a negative about what does NOT travel here |
| EVT-6 | P | 0.1 | Recommended. Binds a consumer, about a component this protocol does not see |
| EVT-7 | P | 0.1 | Binds a subscriber — a party this protocol does not otherwise name, sitting between two that both did everything right |
| EVT-8 | W | 0.1 | The republish window, read off the entry |
| EVT-16 | N | 0.4 | A subscriber sees the topic it was given and not the Worker's other uses of the same cluster. What would be seen, if anything could, is a deduplication store filling with ids for documents that were never events |

## naming.md — 10

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| NAME-1 | W | 0.1 | Any declared name carrying an uppercase letter — a dimension, an Action, a metric — sent back folded and expected not to match. A Worker whose declarations are all lowercase exercises nothing, which is `not exercised` and not a weaker class |
| NAME-2 | N | 0.1 | A verifier holds one Descriptor and never the one before it. REG-36 has a Tower compare two copies, which is a Tower's rule, and it reaches the structural half of a reuse and not the half that needs a person |
| NAME-3 | P | 0.1 | Recommended. Binds this specification, not a Worker |
| NAME-4 | N | 0.1 | A Task whose condition nothing outside the Worker can affect is indistinguishable from one whose condition nobody has met yet. The fence is real and only the implementer can see which side of it they are on |
| NAME-5 | N | 0.1 | The file says it: part of the test needs a person |
| NAME-6 | N | 0.1 | Same |
| NAME-7 | W | 0.1 | A Task type, a Skill and an event type are all declared now, and all three are matched by a party that did not mint them. The `tasks` and `events` entries carry them under a qualified-name key, so the pattern is asserted where they are declared |
| NAME-8 | N | 0.1 | The file says it: no verifier can report it |
| NAME-9 | N | 0.1 | Not checkable against one Worker. Needs a corpus |
| NAME-10 | W | 0.4 | The Descriptor alone: every `supersededBy` in `accepts`, `raises` and `publishes` names another member of the same map, and following it from any member ends at one that carries none |

**Three rules here are checkable and seven are not**, which is the thinnest showing of any file and
is a property of the subject: almost everything naming.md decides is about names that are declared
and then echoed, where no party's correctness turns on the spelling and nothing is left to observe.

## health.md — 5

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| HLTH-1 | W | 0.1 | The `health` entry carries an address. Fails without calling anything |
| HLTH-2 | W | 0.1 | One status, a map of checks, both from the three values |
| HLTH-3 | W | 0.1 | A body answering `healthy` with a check that is not. Visible whenever it occurs, in any poll |
| HLTH-4 | H | 0.1 | The Worker must leave the window between start and first evaluation pollable |
| HLTH-5 | W | 0.1 | The health address answers `200` whatever it reports |

## metrics.md — 20

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| MET-1 | W | 0.1 | The entry carries an address |
| MET-21 | W | 0.1 | Every metric read is one the entry declared under `publishes`, and the surface lists none |
| MET-3 | W | 0.1 | Unit, additivity, at least one granularity, from the five |
| MET-4 | W | 0.1 | Dimensions keyed by name, closed set or none |
| MET-5 | W | 0.1 | No dimension named `metric`, `granularity`, `from`, `to`, `by` or the cursor parameter. The rule the file says has no schema witness — it has a verifier witness |
| MET-6 | W | 0.1 | The entry declares one IANA zone |
| MET-7 | W | 0.1 | A `week` bucket beginning on a Monday, numbered by ISO 8601 |
| MET-8 | W | 0.1 | Granularity required where more than one is declared |
| MET-9 | W | 0.1 | An undeclared metric is `404` + `not_found` |
| MET-10 | W | 0.1 | An undeclared granularity is `400` + `invalid_parameter` |
| MET-11 | W | 0.1 | Two adjacent reads share a boundary instant and no bucket twice |
| MET-12 | W | 0.1 | An interval starting mid-bucket returns whole buckets |
| MET-13 | W | 0.1 | Every bucket carries start, end and a value |
| MET-14 | W | 0.1 | Buckets ascend, with the tiebreak under `by` |
| MET-15 | N | 0.1 | Admitted exception. Nothing outside distinguishes a dropped bucket from a quiet one |
| MET-16 | W | 0.1 | A dimension is spelled as a parameter of the same name |
| MET-17 | W | 0.1 | A value outside a declared set is `400` + `invalid_parameter` |
| MET-18 | W | 0.1 | The file names the check: an unfiltered answer smaller than one of its own filtered answers over the same interval, on a metric that only accumulates upward |
| MET-19 | W | 0.1 | `by` on a free dimension is refused |
| MET-22 | W | 0.4 | Every bucket's start and end land on a boundary cut in the declared zone, for a caller with no other agreement — which the verifier is |

**The most checkable file in the specification**: 19 of 20, and the twentieth is an admitted
exception. Several need buckets to exist before they say anything, which is `not exercised` and not
a weaker class.

## logs.md — 10

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| LOG-1 | W | 0.2 | The `logs` entry carries an address |
| LOG-2 | W | 0.2 | A read answers the page envelope. A Worker holding nothing exercises nothing, which is `not exercised` |
| LOG-3 | H | 0.2 | The record that was first stops being first once a newer one exists. It needs a Worker that writes when it is read, because LOG-6 forbids reading the order off the instants and there is nothing in an arbitrary page to compare |
| LOG-4 | W | 0.2 | Each record carries its instant, its level and a message |
| LOG-5 | W | 0.2 | Every level is one of the four |
| LOG-6 | P | 0.2 | Binds a caller |
| LOG-7 | W | 0.2 | `level=warn` answers `warn` and `error` and nothing below it; a name outside the four is `400` + `invalid_parameter` |
| LOG-8 | W | 0.2 | Two adjacent intervals share a boundary instant and carry no record twice, which is MET-11's check one surface along |
| LOG-9 | W | 0.2 | Every `fields` map is one level deep and scalar-valued |
| LOG-10 | H | 0.2 | Two credentials must exist before two lists can be compared |

**The newest file, and the one whose `H` rules named a new arrangement.** LOG-3 is only reachable
against a Worker that records something when it is read, and so is ENDP-33 over in `endpoints.md`:
a feed is the one collection a verifier can make change on demand, so it is where the paging rule
that binds all four surfaces is actually observed. LOG-10 needed no new arrangement — it is ALRT-6
and ACTV-6's comparison, pinned with LOG-8's `to` so that a feed being written to can be compared
at all.

## subscriptions.md — 17

| Rule | Class | Introduced in | What a check observes, or why nothing does |
|---|---|---|---|
| SUB-1 | W | 0.4 | The entry declares an address and `abandonAfterSeconds` |
| SUB-2 | H | 0.4 | Subscribing to an arranged sink answers `201` with an id. It needs a sink the Worker can reach |
| SUB-3 | W | 0.4 | A subscription to a type the entry does not publish is `422` with `unprocessable_content` |
| SUB-4 | H | 0.4 | Needs a credential whose Contract does not let it consume a type the Worker publishes. No check yet |
| SUB-5 | W | 0.4 | A sink in plaintext is `400` with `schema_mismatch` |
| SUB-6 | W | 0.4 | Recommended. A loopback sink is `422` |
| SUB-7 | H | 0.4 | The same caller, sink, types and filters answer `200` with the same id |
| SUB-8 | H | 0.4 | The caller's list carries its subscription, and another caller's does not — which needs a credential of another caller |
| SUB-9 | H | 0.4 | Another caller ending it is `404`, and its owner ending it is `204` |
| SUB-10 | H | 0.4 | The arranged sink saw the webhook handshake naming the Worker's id before the subscription was answered |
| SUB-11 | H | 0.4 | A delivery reached the arranged sink in structured mode, with the sink's own credential, after the Action that publishes was performed |
| SUB-12 | H | 0.4 | Needs a sink that fails and then answers, and a window long enough to watch a retry. No check yet |
| SUB-13 | H | 0.4 | A subscription whose filter nothing satisfies receives nothing, while one beside it does |
| SUB-14 | H | 0.4 | Needs a sink that fails for the whole of `abandonAfterSeconds`, or a caller the Worker stops accepting. No check yet |
| SUB-15 | H | 0.4 | Needs a subscription that ended without its subscriber ending it, which SUB-14's arrangement would provoke. No check yet |
| SUB-16 | H | 0.4 | After a delivery, the caller's list shows when it last succeeded |
| SUB-17 | H | 0.4 | Recommended. Another caller ending a subscription it does not own is `404`, the same as one that does not exist |

## Where this stands

192 rules across fourteen files, none of them `open`, under edition 0.4. Every rule the register
marks `W` or `H` has a check in `packages/conformance` that has run against a Worker answering over
a real socket, so nothing here is a claim about what a check *could* observe and everything is a
claim about what one did.

What no tool reaches is 50 rules, and the two kinds are not the same thing. There are 28 that bind
a party who is not a Worker — a verifier, a Tower, a consumer, an issuer, a subscriber, or this
specification — and a report calls those *another subject's* because it never contacted whoever
they oblige. The other 22 have the Worker as their subject and no witness anywhere, and a report
calls those *unverified*. Counting either as compliance would be vouching for something nobody
checked, which is the whole reason this file exists.

`naming.md` has three rules a tool can check — NAME-1 by folding a declared name, NAME-7 now that a
Task type is a name that actually crosses, NAME-10 by resolving every `supersededBy` — and had none
until `tasks.md` was written.
`registration.md` has four. Those two files are the thinnest here, and that is a property of their
subjects rather than a gap: naming is mostly about names nobody types, and registration pushed
credential lifecycle out to whatever identity provider a deployment already runs.

## What the first pass found, on 2026-09-18

**The numbers below are the state on the day the register was first written, when `spec/` held six
files and 98 rules.** They are left as they were rather than updated, because what they record is
an audit — the first time anybody put the question to every rule in turn — and an audit rewritten
to match today is not a record of anything. The current state is the section above and the tables
above that, which are gated.

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
(DESC-37). That is what the reference Worker is *for* — it is a conformance fixture, not a demo, and
everything on this list is a deliberate arrangement rather than a feature anybody would otherwise
build.

**3. Thirteen rules have no witness and are not on the admitted list.** The exception
[spec/README.md](../spec/README.md) admits names DESC-26 and DESC-20 only. DESC-32 (under its
earlier id), DESC-27,
DESC-28, DESC-29, REG-24, REG-26, REG-27, REG-33, NAME-2, NAME-5, NAME-6, NAME-8 and NAME-9 are
equally unreachable. Most already say so in their own prose, which is the obligation met — but the
list in the README is incomplete, and a reader extracting the bold lines cannot tell. This document
is the exhaustive register whether or not the README ever becomes one.

**4. Three ids carried more than one obligation, and have been split.** DESC-6 bundled four,
DESC-9 two and MET-6 two, against [spec/README.md](../spec/README.md)'s *an id belongs to one
independently checkable obligation*. DESC-6 now says only that the id is not the URL, which is the
clause a verifier can reach, and DESC-27 and DESC-28 carry the rest; DESC-9 keeps the integer and
DESC-29 takes what it counts; MET-6 keeps the declaration and MET-22 takes the cutting. No edition
is published, so under [spec/README.md](../spec/README.md) each rule was edited in place and
nothing was withdrawn — which is the cheapest this correction will ever be.

**5. `naming.md` has nothing a tool can check and `registration.md` has three.** Zero and three of
seventeen. Neither is a defect on its own — naming is largely about names that only exist in `open`
files, and registration deliberately pushed lifecycle out to an identity provider — but a report
against those two files will be almost entirely *unverified* and *other subject*, and that should be
a known outcome rather than a surprise in the first run.

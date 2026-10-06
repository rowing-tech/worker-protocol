# Events

`draft`

What a Worker publishes for anyone to consume: Facts with no addressee, including the lifecycle
transitions of its Tasks and Alerts.

**This is the only Capability with no address, and almost everything else about it follows from
that.** An event does not travel over the Worker API; it travels over a broker this protocol
deliberately does not name, or it is pushed by the Worker itself to whoever subscribed through
[subscriptions](subscriptions.md) — and this entry declares *what* is published, whichever way it
leaves. DESC-22 makes the shared entry's address optional for exactly this one case. What that
costs is stated up front rather than discovered: what crosses a broker cannot be observed by any
tool pointed at a Worker, and a protocol that declines to own a transport declines to see what
crosses it. [conformance/verifiability.md](../conformance/verifiability.md) records that as a fact
rather than a gap somebody will close; what a Worker pushes itself is the part a verifier holding a
sink can see.

The declaration is [schemas/events-entry.json](../schemas/events-entry.json) and one event type's is
[schemas/event-type-declaration.json](../schemas/event-type-declaration.json). Rules carry ids and a
class; the convention is in [spec/README.md](README.md).

## The envelope

**EVT-1 (required). An event a Worker publishes is a CloudEvents 1.0 event. Its `type` is one the
entry declares, its `source` is the Worker's id, and `source` with `id` identifies one event
uniquely.**

**EVT-13 (required). For a broker, this protocol fixes no protocol binding, names none and defines
no destination. An entry that publishes through a broker declares the broker, the
`protocolBinding`, and where on it every event type lands — once for the entry, or per type — and
nothing here parses any of them; an entry that publishes through no broker declares none of
them.**

**EVT-14 (required). A Worker that declares `events` declares a broker, the `subscriptions`
Capability, or both.**

CloudEvents was listed as the candidate and it is adopted, for one reason that outweighs the cost of
depending on a second specification: it already answers the question this file could not answer
alone. Delivery is at least once, so a consumer has to deduplicate, and deduplicating requires
knowing *where the id is* — which is a question about an envelope, and inventing an envelope to
answer it would have been this protocol writing CloudEvents badly. `source` with `id` is that
standard's own uniqueness rule, and EVT-1 does nothing but say which of its fields carry what this
protocol already names: the event type, and the Worker whose Fact it is.

`source` is the Worker's id and not its URL, which is DESC-6 read one document along. A consumer
holding an event long after the fact needs to know which Worker derived it, and a Worker that moved
kept its id (DESC-27) and did not keep its address.

**The protocol binding is not fixed, and that is the same refusal that names no broker.** A protocol
binding is a property of a transport — how the attributes sit on a Kafka record, an MQTT message, an
HTTP POST — and this protocol has no transport to have an opinion about. Fixing one would mean
either naming a broker or publishing a list of the ones we had thought of, which is a registry under
another name. So the broker and the protocol binding are strings, and nothing here parses them,
exactly as [metrics](metrics.md) declares a unit nothing parses.

**A broker is one way out and not the only one, which is what EVT-14 says.** A Worker whose
consumers hold no consumer group — a Convex app, an automation, a Tower — and that runs no broker
of its own has nowhere to declare, and before [subscriptions](subscriptions.md) existed the honest
reading of this file was that such a Worker published nothing. Now it pushes over the Worker API,
and the entry still says what it publishes and how long a consumer must remember. Declaring the
three broker fields together or not at all keeps a half-declared broker — a cluster with no
destination — from reading as a way to subscribe.

**It is spelled `protocolBinding` rather than `binding`, and the extra word is not decoration.**
CloudEvents calls it a protocol binding and so does everyone who implements one; `binding` alone is
the short form, and the short form collides. On the platform this protocol's architecture names
first, a binding is the name a deployment gives a resource it was handed — a queue, a namespace, a
store — which is a different kind of thing that appears a few lines away in the same file. A reader
who has to work out which sense is meant is paying for a word we saved.

**The destination is the third, and it is an object rather than a string because a string would
have flattened things that are not alike.** Where a message lands is not a property of the
transport — it is a property of *this publication*, and every broker has a name for it: a Kafka
topic, a NATS subject, an Event Hub in a namespace, an SNS ARN with a region in it. One string
would have made each consumer parse this Worker's own convention for packing several facts into
one, which is the work a catalog exists to remove. So the destination carries whatever that broker
needs, under keys the Worker chooses, and nothing here reads them — the same move an Action's input
already makes, and for the same reason: this protocol has no data model.

**What it costs is that two Workers on one broker may spell it differently**, and nothing here
stops them. Making them agree would mean either a registry of brokers or a namespaced name under
NAME-7 — and NAME-8 asks that a namespace be a domain the minting team controls, which nobody
here does for Kafka or for Azure. The names would be false or they would be local, and a local name
is one nothing else matches. What makes it work instead is convention inside a network, and a Tower
that renders what it recognises and shows the rest as it read it — which is what DESC-15 already
has a verifier do with a Capability it does not know.

A consumer that does not recognise what it reads does not subscribe, which is the correct outcome
and needs no machinery. **Without the destination it could not subscribe even when it did
recognise everything**, which is why the entry owes it: a Tower holding a cluster, an envelope
layout and a list of type names still cannot say what to attach to.

## What a Worker declares

**EVT-12 (required). The entry declares under `publishes` every event type the Worker publishes,
keyed by name, each with the JSON Schema of its data.**

**EVT-4 (required). An event type is a qualified name under NAME-7.**

**EVT-8 (required). The entry declares the window within which the Worker may publish the same
event again. A consumer that remembers `source` and `id` for at least that long sees each event
once.**

EVT-4 is NAME-7 applied, and an event type is the third name that genuinely crosses: a subscriber
matches it against what it decided to consume, having never met the team that minted it.

**EVT-8 is where *how long must a consumer remember* stops being unanswerable.** The honest form of
that question is not a duration this specification could invent — it would be a number every
deployment was measured against, invented by somebody who had seen none of them, which is the same
refusal [health](health.md) makes about a poll cadence. What turns it into something a consumer can
design against is the same move ENDP-38
already makes for an idempotency key: **the producer declares the window, and the guarantee is
worthless without one.** *Remember forever* is not implementable, and a consumer that forgot too
early would process an event twice while believing it was protected. Declared, the consumer sizes
its own store against a number it read before it subscribed.

What a Worker may republish inside that window is its own business — a retry, a recovery, a replay
after a deploy. What the window promises is only that outside it, the same `source` and `id` will
not come round again.

**EVT-16 (required). Nothing but the events this entry declares lands at a destination it
declares.**

A broker a Worker also uses for its own internal traffic hands every subscriber documents it cannot
read, and a subscriber has no way to tell one of those from an event type it simply does not know
yet. Nothing outside can observe this — a subscriber sees the topic it was given and not the
Worker's other uses of the same cluster — which puts it in the class
[spec/README.md](README.md) admits. What would be seen, if anything could see it,
is a consumer's deduplication store filling with ids for documents that were never events.

## Reaching the broker

**EVT-5 (required). A Contract names which event types a consumer may consume. No credential for a
broker travels through this protocol.**

This settles how a consumer obtains access to a broker that is not its own, and it settles it by
splitting the question. *Which events a consumer may have* is an agreement, and an agreement is
exactly what a Contract is. *How it reaches the broker* is a credential shaped like the broker — a
SASL mechanism, a subscription policy on a queue, a credential file — and carrying one here would
require this protocol to model the authentication of every transport it refused to name. REG-3
fixes how a credential is presented on the addresses this protocol defines, and a broker is not one
of them.

So the people who run the broker arrange the access, the Contract says what may be consumed, and
neither has to know how the other works. What that costs is that a Contract alone does not make a
consumer able to subscribe — which is true and is better said than papered over.

**EVT-6 (recommended). A consumer that cannot hold a long-lived subscription to a broker runs a
subscriber beside it that posts each event into it as an Action.**

**EVT-7 (required). A subscriber that relays an event into a Worker carries `source` and `id`
through unchanged.**

A Worker on a platform with no long-lived process — and the [architecture](../docs/architecture.md)
is explicit that those are the Workers people use — cannot hold a consumer group. The answer needs
no new surface, and it is the same answer [tasks](tasks.md) gives the nudge:
**an Action is already a declared, schema-carrying, credentialed way to push something into a
Worker.** The subscriber is the consumer's own component, this protocol does not see it, and the
Worker on the other side of it is receiving an ordinary Action.

**Where the Worker serves [subscriptions](subscriptions.md), none of this is needed**: the consumer
subscribes over the Worker API and the Worker pushes each event to it, `source` and `id` intact. The
relay is for the Worker that publishes only to a broker.

EVT-7 is what the subscriber owes, and it is one sentence because everything else about it is the
consumer's. A relay that renumbered, or that dropped the identity of the Worker whose Fact this
was, has destroyed the only thing a consumer needed in order to deduplicate — and it destroyed it
in a component that sits between two parties who both did everything right. It binds a party this
protocol does not otherwise name, which is why `conformance/` reports it against a subject that is
not a Worker.

## The lifecycle of Tasks and Alerts

**EVT-15 (required). A Worker that publishes the lifecycle of its Tasks or Alerts publishes it under
the four types below, each declared under `publishes` like any other, with the `subject` and the
extension attribute the table gives and a `data` carrying at least its members.**

| Type | `subject` | Extension | `data` |
|---|---|---|---|
| `tech.rowing.worker-protocol.task-raised` | the Task's id | `tasktype`: the Task type | the Task, as `schemas/task.json` |
| `tech.rowing.worker-protocol.task-ended` | the Task's id | `tasktype`: the Task type | `{ id, type }` |
| `tech.rowing.worker-protocol.alert-raised` | the Alert's id | `alertseverity`: its severity | the Alert, as `schemas/alert.json` |
| `tech.rowing.worker-protocol.alert-ended` | the Alert's id | `alertseverity`: its severity | `{ id, severity }` |

**Publishing them is not required, and naming them is.** A Worker may publish events of its own
about its work besides these; what it may not do is publish the four transitions under other
names, or with less than the table gives — the `data` carries at least those members, and may
carry more of the Worker's own. A Worker owes no lifecycle events at all;
one that publishes them owes these names, because the typical subscription is *a Task of type X was
raised* and it has to mean the same thing on every Worker a consumer meets. They are qualified names
under NAME-7, in a namespace this specification's own domain controls, which is what NAME-8 asks.

**`subject` is the resource, and what a subscriber filters on is an extension.** CloudEvents means
`subject` as the thing an event is about, within its `source`, and that is the Task or the Alert —
not its type and not its severity, which are properties of it. Properties travel as extension
attributes, which every filter dialect in [subscriptions](subscriptions.md) reaches, so
`{ "exact": { "tasktype": "…" } }` is how a consumer asks for one Task type and nobody parses a
string format to do it. An Alert has no type today; if it gains one, it arrives as one more
extension, and nothing already published changes.

***Ended* is ALRT-8's word, and it says nothing about why.** A Task ends when its condition stops
holding (TASK-15): because somebody answered it, because a Fact changed upstream, or because the
work is simply no longer needed. The event says only that it ended, carries no reason, and implies
no party — nobody closes a Task, and nobody dismisses an Alert. An ended event carries what a Worker
still holds once something stops existing, which is its id and the property it was filtered by, and
not a last full document the Worker may no longer have.

**When a Task was raised is the Worker's to know.** A Task is derived on every read, so no read
witnesses one being born; only the Worker's own logic does, at the moment a Fact changes. Nothing
here says when to publish, and a Worker that compares snapshots of its Tasks to find out has chosen
to miss whatever came and went between two of them.

## What this file does not fix

**What a Worker publishes, and when.** Nothing here enumerates events, requires any, or says that a
Worker has any to publish. A Worker that publishes none declares no `events` and is conformant, and
DESC-34 needs no qualification for it.

**Ordering.** No rule here promises that two events arrive in the order they were published, and
none could without an opinion about the transport. A consumer that needs order takes it from
something in the data, which is the Worker's own.

**Exactly-once delivery.** Delivery is at least once and this protocol offers nothing stronger. A
consumer that has not remembered an id will see an event twice; EVT-8 is what bounds how long it
has to care.

## Still open here

- Whether a Worker declares more than one broker, for a deployment migrating between two. A
  destination per event type answers *which types go where* on one broker; a second broker is a
  different question and nothing needs it yet.

## Withdrawn

- **EVT-9** (required, N, 0.1–0.4) — required that nothing but declared events cross the declared
  broker. Replaced by **EVT-16**, which reaches the declared destinations; a Worker using the same
  cluster for its own traffic on another topic failed EVT-9 and satisfies EVT-16, so the verdict
  moves and the id did not survive.

  The argument was what a subscriber is handed: the topic it was given. Who may reach the rest of a
  cluster is the business of whoever runs it (EVT-5).

- **EVT-11** (required, W, 0.1–0.4) — required that the entry declare the broker, the
  `protocolBinding` and the destination. Replaced by **EVT-13**, which requires the three together
  or none of them, and **EVT-14**, which requires a broker, `subscriptions`, or both. An entry with
  no broker failed EVT-11 and satisfies EVT-13, so the verdict moves and the id did not survive.

  A broker was the only way out when EVT-11 was written, so requiring one was requiring that a
  Worker could publish at all. [subscriptions](subscriptions.md) is a second way out, and a Worker
  that uses only it has no broker to name.

- **EVT-3** — required the same declaration, keyed by name under `events`. Replaced by **EVT-12**,
  which puts it under `publishes`. A Descriptor written against EVT-3 fails EVT-12 and the other way
  round, so the verdict moves and the id did not survive.

  The old name repeated the Capability's own name one level down, which names a container instead of
  making a claim. `publishes` is the verb EVT-3's own sentence already used, and it is the same word
  [metrics](metrics.md) now uses for the same reason, against the `accepts` that
  [actions](actions.md) uses for the traffic going the other way.

- **EVT-10** — required that the entry declare the broker, the binding and the destination.
  Replaced by **EVT-11**, which is the same requirement with the second field spelled
  `protocolBinding`. An entry carrying `binding` satisfied EVT-10 and does not satisfy EVT-11, so
  the verdict moves and the id did not survive.

  The paragraph above says why the extra word is worth an edition's worth of churn. What is worth
  adding here is that the collision was invisible from inside this file: read beside `broker` and
  `destination`, `binding` is unambiguous, and it stops being so the moment the entry is written in
  a deployment's own config file next to the bindings that deployment was handed. A name is
  ambiguous where it is read, not where it is defined.

- **EVT-2** — required that the entry declare the broker and the binding, and that nothing here
  parse either. Replaced by **EVT-10**, which required a third thing: where on that broker the
  events land. An entry declaring only a broker and a binding satisfied EVT-2 and does not satisfy
  EVT-10, so the verdict moves and the id did not survive.

  What the old rule left out was the one fact a consumer cannot proceed without. A Tower could
  catalog the cluster, the envelope layout and every type name a Worker published, and still not
  tell anybody what to subscribe to — so the catalog answered every question but the one somebody
  had. The gap was easy to miss because the entry's `broker` reads as though it might already carry
  it: *where this Worker publishes* is true of a cluster and of a topic alike, and the example in
  this repository filled it with a server URL while nothing said it had to.

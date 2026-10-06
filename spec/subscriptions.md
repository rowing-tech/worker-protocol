# Subscriptions

`draft`

A consumer subscribes to a Worker over the Worker API, and the Worker keeps the subscription and
pushes every event that matches it to the consumer's sink. It is how [events](events.md) reach a
consumer that holds no consumer group, from a Worker that may run no broker at all.

## Why this is not the transport this protocol refuses

[events](events.md) names no broker and fixes no binding, because doing either would mean naming
one transport or keeping a registry of the ones somebody had thought of. HTTP is not one of those:
it is the Worker API's own, with the credential REG-3 already fixes and the agreement a Contract
already is (EVT-5). A Worker that pushes over it uses the transport this protocol owns, and nothing
here names Kafka, an Event Hub or anything else.

The consumers this network actually has are why it is needed. A Convex app, a Control Tower and an
automation hold no consumer group, so EVT-6's relay is a component each of them would have to build
and run — and the Worker they want events from usually runs no broker either, so there would be
nothing to relay from.

**What it costs is exactly what [tasks](tasks.md) says a nudge avoids**: a delivery guarantee to
specify, and something the receiving side holds afterwards. It is specified here rather than
avoided, because the push is worthless without it. A nudge can be lost because a Task can be read
again; an event cannot be derived again by reading, so one that is lost is gone.

*The owner knows nobody* ([architecture](../docs/architecture.md)) still holds where it matters. The
Worker's domain logic publishes Facts and names no subscriber; the list of subscribers belongs to
the delivery machinery, which is what a broker is.

The declaration is [schemas/subscriptions-entry.json](../schemas/subscriptions-entry.json), a
request is [schemas/subscription-request.json](../schemas/subscription-request.json) and a listed
subscription is [schemas/subscription.json](../schemas/subscription.json). Rules carry ids and a
class; the convention is in [spec/README.md](README.md).

## What a Worker declares, and how a consumer subscribes

**SUB-1 (required). A `subscriptions` entry declares an address, and `abandonAfterSeconds`: how long
a sink may fail without interruption before its subscription ends.**

**SUB-2 (required). A POST to that address subscribes. Its body carries the event types, optionally
filters, the sink and the credential the sink expects, and nothing else; a new subscription is
answered `201` with its id.**

**SUB-3 (required). A type that the `events` entry does not publish is refused with `422` and the
code `unprocessable_content`.**

**SUB-4 (required). A type that the caller's Contract does not let it consume is refused with `403`
and the code `forbidden`.**

**SUB-5 (required). The sink is an absolute `https` URL.**

**SUB-6 (recommended). A Worker refuses a sink that resolves to a loopback, private or link-local
address, with `422` and the code `unprocessable_content`.**

**SUB-7 (required). Subscribing is idempotent: the same caller naming the same sink, types and
filters is answered `200` with the subscription that already exists and has not ended.**

The request is the consumer's whole intention, and *nothing else* is what keeps it that. SUB-7 makes
the content the identity, so a member the identity ignored would make two different requests one
subscription, and one it counted would make the identity turn on something the Worker does not
understand. The sink's credential is required because it is the only thing that lets a sink tell
this Worker's deliveries from anybody's who learned its URL; a sink without one is an open door. The
request carries no key of its own, because it does not need one. Subscribing twice to the same thing
means the same thing, so the content is the identity, and an orchestrator *ensures* its subscription
on every deploy without keeping an id anywhere — the shape the consumers this file exists for can
actually maintain.

SUB-3 and SUB-4 are two lists and two refusals, and they are not the same fault. A type the Worker
does not publish is a request it read and cannot satisfy, which ENDP-12 makes a `422`. A type it
publishes and the caller may not have is the Contract speaking, which is what `403` is for, and it
is refused rather than quietly dropped from the subscription: a consumer told nothing would wait
for events that will never come.

SUB-5 is DESC-35 one direction along. The sink credential travels on every delivery, and a sink in
plaintext hands it to every party on the path. SUB-6 recommends rather than binds because whether
an address is private can only be checked where it is resolved, and on some platforms the Worker
cannot reach such an address at all; where it can, a credentialed caller could otherwise point the
Worker at the inside of its own network.

**Development is the one place SUB-5 and SUB-6 are set aside, and only by name.** The subscriber a
Worker most often meets in development is a local backend on a loopback address over plain HTTP. An
SDK may let a Worker's operators name the origins they exempt, and a Worker running with such a
list breaks both rules on purpose for those origins and no others — as a test over loopback breaks
DESC-35, and is reported as breaking it.

## Who a subscription belongs to

**SUB-8 (required). A subscription belongs to the caller that created it, the same caller ENDP-34
scopes a key to. A GET of the address lists that caller's subscriptions in the page envelope, and
never another Contract holder's.**

**SUB-9 (required). A DELETE to that address naming a subscription in the `subscription` parameter
ends it and is answered `204`; one that does not exist, or that belongs to another caller, is
refused, and nothing ends.**

**SUB-17 (recommended). That refusal is `404` with the code `not_found`, whether the subscription
does not exist or belongs to another caller.**

SUB-17 recommends `404` for another caller's subscription, and not `403`, for REG-32's reason: a
refusal that distinguishes *exists and is not yours* from *does not exist* tells a caller which ids
are real. It recommends rather than binds for REG-32's reason too — a Worker whose ids are
unguessable may reasonably prefer the clearer answer, and nothing breaks for any caller.
Nothing here gives the Worker's operator a view of every subscription. A console would want one,
and SUB-8 is worded so that it would be an addition rather than a change — it forbids showing one
Contract holder another's, not showing the operator its own Worker — so it waits until a Tower asks
for it.

Ending one is a DELETE, because this protocol fixes the operation and so may fix its verb
(ENDP-36), and HTTP already says what that verb means: a client, a proxy or a retry library that
sends it twice knows the second is harmless. The subscription is named in a parameter on the
declared address rather than in a path of its own, because ENDP-1 lets a caller use only addresses
the Descriptor declared, and a path built from an id is one a caller assembled.

## The sink

**SUB-10 (required). Before a subscription is stored, the Worker validates its sink with the
abuse-protection handshake of the CloudEvents webhook specification: an `OPTIONS` carrying
`WebHook-Request-Origin`, answered with `WebHook-Allowed-Origin`. A sink that does not allow it is
refused with `422` and the code `unprocessable_content`, and nothing is stored.**

**SUB-11 (required). Each delivery is a CloudEvent in the HTTP binding's structured mode, carrying
`Authorization: Bearer` with the sink's credential, and the event's `source` and `id` unchanged.**

The handshake is what stops a credentialed caller from aiming the Worker at somebody else's URL: an
address that never asked for events does not answer it. It is adopted from CloudEvents rather than
invented, as EVT-1 adopted the envelope, and it runs while the subscription is being created so that
an orchestrator learns the sink is wrong the moment it asks, with no pending state to discover
later. A subscription answered `201` and then found dead at its first delivery would be the silent
failure this file is shaped against.

The credential is the sink's own, chosen by the subscriber and presented by the Worker: REG-3 in the
other direction. A signature would need a secret generated, returned and rotated per subscription,
and would not stop the flooding the handshake stops. Structured mode puts the whole event in one
JSON body, which a receiver reads in one call, and `source` with `id` is what its deduplication
needs (EVT-8) — a push that renumbered would destroy it, as EVT-7 says of a relay.

## Delivery

**SUB-12 (required). Delivery is at least once. A `2xx` is a delivery. A network failure, a `5xx`,
a `408` or a `429` is retried with backoff, honouring `Retry-After`, and only within the window
EVT-8 declares; any other answer is final for that event.**

**SUB-13 (required). A subscription with filters receives only the events for which every filter
holds. A filter is one of six dialects — `exact`, `prefix`, `suffix`, `all`, `any`, `not` — over
the event's context attributes, extensions included.**

The answers worth retrying are the ones ENDP-40 classes `retry`, read in the other direction: a sink
answers the Worker as a Worker answers a caller, and an answer that says *try again* or *not now*
is the one a later attempt can change. Anything else — a sink that refuses, has moved, or says it
will never take this — is not fixed by repeating it. Every retry is a republication, so the window a
consumer already sizes its deduplication store against (EVT-8) is the one that bounds them, and no
second window is invented. Outside it, the same
`source` and `id` will not come round again, which is the promise EVT-8 already makes. No order is
promised, as [events](events.md) promises none.

The six dialects are the ones the CloudEvents Subscriptions API requires every implementation to
support, with its JSON shape: `exact`, `prefix` and `suffix` each name one or more attributes with
a string apiece, and hold when every named attribute's value equals, starts with or ends with its
string, case sensitive; `all` holds when every nested filter holds and `any` when one does, each
nesting at least one, and `not` holds when its one nested filter does not. An attribute the event
does not carry matches nothing, which the CloudEvents text leaves unsaid.
They are written out here rather than cited because that API is a working draft and may move. Its
`sql` dialect is left out: nothing needs it yet, and adding it later is an addition. **The six are
the whole language, and not a floor**, because the subscribers this file exists for ensure the same
subscription on every Worker they meet: a filter one Worker took and another refused would make one
request mean two things across a network, which is the thing a fixed vocabulary is for.

## How a subscription ends

**SUB-14 (required). A subscription is never renewed by its subscriber. It ends when the subscriber
ends it, when its sink has failed without interruption for `abandonAfterSeconds`, when the Worker
no longer accepts its caller, or when the Worker withdraws it — and nothing ends it silently.**

**SUB-15 (required). A subscription that ended for any reason but its subscriber's is announced and
kept. The Worker makes at least one attempt to deliver
`tech.rowing.worker-protocol.subscription-ended`, with the subscription's id in `subject` and the
reason and the instant in `data`, whatever types and filters it named; and it stays in the caller's
list for `abandonAfterSeconds`, carrying when and why it ended, receiving nothing.**

**SUB-16 (required). Each listed subscription carries when a delivery last succeeded, and, while
its sink is failing, since when.**

**No lease, because the subscribers are orchestrators and automations.** A lease needs a periodic
renewal somebody has to remember to build, and when it is forgotten the subscription stops and
nobody is told — the commonest way a consumer of this protocol would lose events without knowing.
Here a subscription ends only when its sink was already not receiving, when its Contract was
revoked, or when somebody ended it, and none of those is silent. Abandoned subscriptions are
cleaned up by `abandonAfterSeconds`, which is the work a lease did.

SUB-15 keeps the subscription listed because the likeliest ending is the one in which the final
event does not arrive: a sink that was down for a week is still down when its subscription is
abandoned. A consumer that looks finds out why. The final event is addressed to one subscriber and
not published, so it is declared under no `publishes` (EVT-12 is about the Facts a Worker publishes
for anyone). Subscribing again with the same sink, types and filters creates a new subscription.

*Withdraws it* is the Worker's own ending — it stopped publishing a type the subscription names, or
its operators ended it — and it is in the list because the alternative was pretending it cannot
happen. What the rule forbids is not the reason but the silence.

SUB-16 is what turns abandonment from a surprise into something a consumer can see coming: a
subscription that has been failing since Tuesday says so before `abandonAfterSeconds` runs out, to
anyone who looks, while there is still time to fix the sink.

*No longer accepts its caller* is how a revoked Contract reaches a subscription. Who the caller is,
and whether it is still entitled, is the Worker's to decide, as everything about the credential is
([registration](registration.md)); a Worker that cannot tell has subscriptions that end only by
their subscriber or by abandonment.

## What this file does not fix

**What a Worker publishes, and when.** That is [events](events.md)'s, including the names of the
lifecycle events of Tasks and Alerts (EVT-15).

**Order, exactly-once delivery and batching.** None is promised. A consumer that needs order takes
it from the data, and one that has not remembered an id within EVT-8's window sees an event twice.

**How many subscriptions a caller may hold, and how fast a Worker delivers.** A Worker's own limits,
and a Contract's where two parties have agreed something.

## Still open here

- Whether a Worker's operator lists every subscription, with its caller, for a console to show who
  is subscribed to what.

## Withdrawn

Nothing yet.

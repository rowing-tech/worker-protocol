# Registration and credentials

`draft`

How a Worker comes to be known by the Control Tower, and how the two sides of every call prove who
they are.

**This file does not describe a security model, and the distinction is worth stating before the
first rule.** What binds here is how a credential is *presented*, because a client and a Worker
cannot complete a call without agreeing on it. What a credential is made of, who issued it, how
long it lives, how it is rotated and when a revocation takes effect belong to whatever identity
provider a deployment already runs, and every one of those is a decision this protocol would be
the wrong place to take. A specification that legislated them would be requiring a corporate
identity story of the cron job in Python it exists to admit, and would be doing it in a document
nobody consults when choosing a provider. The shape to have in mind is OpenAPI: it fixes that a
credential arrives in a named place in a named form, and says nothing whatever about the lifecycle
behind it.

So this file divides about evenly. Nine rules bind — how a credential is presented, that a Worker
accepts the one recorded for it, that a refusal is not disguised, and what the Tower owes the
operator reading its catalog. Eight recommend, and they are almost exactly the lifecycle: who holds
a credential, how it is rotated, how much a refusal says. A recommendation carries an id and is
marked `(recommended)`; the convention, and what a conformance report does with one, is in
[spec/README.md](README.md).

This file defines no new header. A credential travels in `Authorization`, which RFC 9110 already
fixes; what is decided here is which scheme is used inside it, and that is a sentence no schema can
state. It owes no schema at all: the enrollment record is the Tower's own state and crosses no
wire, and the refusals are already codes in [schemas/error.json](../schemas/error.json).

## Enrollment

**REG-26 (recommended). A Worker is enrolled by a person, who records a base URL and a credential
against it. No Worker enrolls itself, and nothing a Worker serves puts it in a registry.**

There is no handshake and no registration endpoint, and the absence is the design. A protocol where
a Worker announces itself needs some other thing to decide whether the announcement is true, and
that thing is either a shared secret the announcer already has — in which case a person handed it
over and the handshake was ceremony — or nothing, in which case the registry holds whoever asked.
Recording a URL and a credential is the shorter route to the same trust, and it puts the decision
where it can be argued with: a named person did it, on a day, and it is in the Tower's log.

It recommends rather than binds because no Worker can tell how it got into a registry, and nothing
in a call turns on the answer. A Tower that automates enrollment against a directory it already
trusts has made a choice about its own operations; the Workers it enrolls are conformant or not
entirely independently of it. DESC-3 fixes what the recorded URL is — one absolute `https` URL,
with or without a path — and that half does bind, because it is where a reader looks.

## One presentation, and no opinion about the token

**REG-3 (required). A credential is presented as `Authorization: Bearer <token>`. This protocol
fixes nothing about the token's contents: to whoever presents it, it is an opaque string.**

**REG-21 (required). A Worker accepts the credential recorded for it on every address this protocol
defines, the Descriptor's route included.**

These two are the binding core of the file, and between them they are the whole of what a client
and a Worker must agree on. A client that presents a token somewhere else, or a Worker that will
not read one where the protocol says it arrives, produces a call that cannot complete no matter how
good either party's intentions are.

What a Worker does to decide whether a token is good is entirely its own, and that is the whole
point of saying so little. A Worker that validates an API key against an identity provider and
reads a subject and a set of scopes out of it satisfies REG-3. So does a Worker that compares the
string against one secret it was deployed with, and has no notion of a subject at all. Both present
identically on the wire, and a Tower written against one works against the other with no per-Worker
configuration — which is the same property that lets the console render a form from a schema it did
not author.

REG-3 binds what a client *presents*, and that is the limit of it. A Worker is free to sit behind
mutual TLS, an IP allowlist, a signed proxy or anything else it likes; what it may not do is make
one of those the only way in, because a Tower that had to hold and select a client certificate per
Worker has per-Worker configuration under another name, and that is the one thing this file is
buying. One scheme rather than a negotiated set, for the same reason: a caller that must discover
how to authenticate before it can authenticate needs a surface it can reach without a credential,
and inventing one to avoid fixing a scheme is a poor trade.

What a Worker answers a caller it cannot read is ENDP-29's — `401`, with the code
`unauthenticated` — and what it answers one it reads that does not carry the right is `403`, with
`forbidden`. Both are `reject`: ENDP-28 forbids the caller from retrying either.

A Worker may answer more than REG-21 requires. Nothing here forbids serving a Descriptor, a health
answer or a set of indicators to a caller presenting nothing at all: a Worker that owns its origin
root and serves the well-known URI of RFC 8615 openly is discoverable from a bare hostname, which
DESC-3 makes possible and which is worth something, at the cost of publishing the address of every
surface it has. That trade belongs to the Worker.

**REG-31 (recommended). A Worker requires a credential on every address that changes state.**

The line falls where ENDP-2 and ENDP-3 already put it, so it needs no machinery of its own. A read
published to the world discloses something, and the Worker knows what. A write accepted from the
world is an operation performed by anyone who asks — and this protocol has published the address
and the schema of every one of them in the Descriptor, which is to say it has done the hard half of
the attacker's work.

It recommends because it is advice about a deployment's exposure and not a contract between two
parties. Every call to a Worker that ignores it succeeds; nobody misreads anything; the Worker has
simply decided something about itself that this specification has no standing to decide for it.
Saying so plainly is better than a rule a conformance report would have to fail a Worker over.

## What a Worker tells a caller it does not recognize

**REG-7 (required). A Worker does not answer `404` in place of `401` or `403` on an address it
serves.**

REG-7 refuses a habit that is ordinarily good practice, and the reason is specific to this
protocol. DESC-21 makes a consumer that meets `404` on a declared surface stop permanently and
report a contract error, because a declared surface answering `404` means the Descriptor is wrong.
A Worker that hides an authentication failure behind a `404` has therefore told every consumer that
the surface does not exist, and sent its operator looking for a missing endpoint while the
credential that actually failed is never examined. The work stops, the diagnosis points at the
wrong half of the system, and the Descriptor takes the blame for the credential.

That is why it binds where the rest of this section does not: two parties disagree about what an
answer meant, and the consumer acts on the wrong one. The thing the habit protects is not available
here anyway — whether an address exists was published in the Descriptor, to everyone holding a
credential to read it and possibly to everyone at all.

**REG-32 (recommended). A Worker's refusal does not distinguish among the reasons it refused:
nothing in it tells the caller which credential, which scope or which address would have changed
the answer.**

A refusal that explains itself is an oracle. A caller told *that key is expired* rather than *no*
has learned that the key exists, and one told *the Tower's credential would work here* has learned
what to go looking for; neither is information anyone legitimate needed, because the party who can
fix a refused credential is not the party holding it. It is a recommendation because it is exactly
the kind of hardening a deployment decides for itself against its own threat model — a Worker on a
private network among services it trusts may reasonably prefer the better error message, and no
caller of it is worse off. REG-32 constrains what a refusal *distinguishes*, not what the envelope
may carry; whether the envelope holds structured detail at all is [endpoints](endpoints.md)'s open
question.

**REG-8 (required). A Worker serves the same Descriptor to every caller it authenticates.**

A Descriptor filtered per reader is a different document to every reader, and two rules break at
once. DESC-20 has the Tower catalog what the Descriptor declared — so a filtered Descriptor makes
the registry a statement about what the Tower is allowed to see rather than about what the Worker
implements, and nothing anywhere says which it is. And a consumer under a Contract that reads a
short Descriptor cannot tell a Capability it may not use from a Capability the Worker withdrew;
DESC-18 through DESC-21 exist to make that distinction, and per-reader filtering erases it. That is
a misreading by a party who cannot detect it, which is what puts this rule on the binding side.

Which Capabilities a given caller may *use* is a real question, and the answer is `403` on the
address, not a shorter document.

## Credentials over time

Everything in this section is a recommendation, and it is the part of the file the correction above
was aimed at. Credential lifecycle is what an identity provider is for. These are stated because
they are worth knowing and because a Worker built without thinking about them tends to discover
them at a bad moment — not because a conformance report should fail anybody over them.

**REG-27 (recommended). A credential is issued to one holder and is never shared between two.**

**REG-28 (recommended). A Worker accepts more than one valid credential for one holder at a time,
so that replacing one is an overlap and not an outage.**

REG-27 is what makes every other statement about credentials mean anything: revocation is per
holder or it is a flag day, and a refusal in a log names who was refused or it names nothing. It
binds an *issuer*, who is not a party to any call, which is precisely why it cannot be an
obligation here — no Worker can observe it and no request depends on it.

REG-28 is the one that costs a simple Worker something. Without it rotation is a flag day: the old
credential stops working at the instant the new one starts, and every caller holding the old one
fails in the window between. Comparing against two secrets instead of one is the cheapest version
that works, and a Worker reading a subject out of a token gets it for free. A Worker that does not
follow it still answers every call correctly — it has only made one of its own future afternoons
worse, which is exactly the shape of advice rather than obligation.

What happens to a Task already claimed under a credential revoked mid-flight is
[open](../docs/undecided.md), and it is open in [tasks and claims](tasks-and-claims.md)'s territory
rather than here.

## When the id at an enrolled URL changes

**REG-13 (required). A Tower does not rebind an enrollment from the Worker id it recorded to a
different one.**

**REG-14 (required). A Tower that reads a Descriptor whose id differs from the one recorded records
the mismatch, and does not drop the entry.**

**REG-29 (recommended). A Tower stops presenting that enrollment's credentials at that URL until a
person resolves the mismatch.**

DESC-6 makes the id the thing a Worker keeps when it moves, and the thing its Contracts hang off. A
URL that starts answering with a different id is therefore not that Worker moving — a move keeps
the id and changes the URL, which is the opposite event. It is a different Worker at an address the
first one used to hold, and the causes are ordinary: a path redeployed to something else, a
hostname that lapsed and was taken, a copy-pasted base URL that was always wrong and only now
answers.

REG-13 binds because silent rebinding turns any of those into a grant: the new occupant inherits
every Contract made with the previous one, and every consumer holding one of those Contracts now
believes it is talking to a Worker it is not. That is a misreading by parties who cannot detect it,
and no amount of care at either end of the call prevents it.

REG-14 binds for the same reason DESC-20 does, one reader further along. An entry that disappears
because the Tower could not explain it tells the operator the Worker was never enrolled, and that
is the one conclusion nothing will correct: they will not go looking for a mismatch they have no
reason to believe exists. The operator is a party to this specification — the party it was written
for — and the catalog is what they read.

REG-29 is the odd one of the three and stays a recommendation. It is caution with a secret the
Tower holds, and the Tower is the only one who can weigh how much caution its own secrets are
worth; a Tower that keeps polling through an unresolved mismatch has taken a risk with something of
its own, and no operator is misinformed by it, because REG-14 has already put the mismatch in front
of them.

A person resolves it, because a person is what created the binding. That is not ceremony: the only
fact that would settle it — whether this is the same system under new management or a stranger — is
not in any document either party serves.

## Which origins are a Worker's own

**REG-16 (required). A Worker's own origins are the origin of its enrolled base URL, together with
every origin a person separately recorded against that enrollment. A Worker adds none by declaring
an address at one.**

**REG-30 (recommended). An origin is recorded together with the credential to present to it, and a
client presents at an address the credential recorded for that address's origin.**

REG-16 binds because DESC-13 is undecidable without it. DESC-13 forbids a client from presenting a
credential at an origin the operator did not record as the Worker's own, and a client cannot apply
that rule unless *the Worker's own* has one meaning both parties share. An origin is scheme, host
and port in the sense of RFC 6454; DESC-3 fixes the scheme to `https`, so in practice it is host
and port.

REG-16 also refuses the obvious shortcut, and the shortcut is why DESC-13 exists. A Descriptor is a
document the Worker controls. If declaring an address at an origin made that origin the Worker's
own, DESC-13 would forbid nothing at all: a Worker could authorize the Tower to send its credential
anywhere simply by writing the address down, which is the attack stated as a feature. The list has
to come from outside the document it constrains, and the only thing outside it is the person who
enrolled the Worker.

REG-30 is how a careful Tower stores that list, and it recommends because the storage is the
Tower's own. Letting a second origin inherit the enrollment's credential sends that credential to a
deployment nobody told it was going there — a second system, with its own operators and its own
logs, now holding a secret that grants access to the first. An operator who genuinely wants one
string across two origins pastes it twice and has said so. But a Tower that decides otherwise has
made a choice about its own secrets; the prohibition that protects the *Worker* is DESC-13's, and
it binds.

What a client does at an address it may not authenticate against is settled in descriptor.md's
argument for DESC-12: it reads it unauthenticated or not at all, and reports the entry as
unverifiable rather than failing quietly.

## An operator learning that a credential is wrong

**REG-19 (required). A Tower whose poll is refused `401` or `403` records that the credential was
refused, and distinguishes it, in what it shows an operator, from an address that did not answer.**

DESC-20 already has the Tower record that an address did not answer and when. A refused credential
arrives looking almost the same — the poll did not produce a Descriptor, the entry goes stale — and
it is a different problem with a different owner. A Worker that is down belongs to whoever builds
that Worker and will usually fix itself. A credential that is refused belongs to whoever enrolled
it, will never fix itself, and is fixed by one edit in the place the operator is already looking.
Showing both as *not responding* files the one problem a person can solve into the queue of
problems they are waiting out.

This is the other half of a failure already observed in production. A caller that reads `401` and
`403` as reasons to wait and try again turns an authorization mistake into hours of backoff and
then dropped work, with a log line and no other trace. ENDP-28 closes the caller's half, and REG-19
closes this one. Both bind, and it took a wrong answer to see why. This rule was briefly written as
a recommendation on the ground that no call fails differently whatever the console shows — which is
true and beside the point. The operator is a party, and the specification says so from its first
line: it exists for people who operate Workers they did not build. A Tower that reports *not
responding* when the cause was a refused credential has produced something, and that party has read
it wrongly, and will go and look at a network that is working perfectly. There is no other reader
who can fix it. That is the same fault as a Worker answering `404` for `401` — REG-7 — with the
console in place of the wire.

The Tower keeps polling, and ENDP-28 is the reason it may: a poller on its own schedule is asking a
fresh question about the present, not retrying a refusal it has been told will hold, and a
credential replaced between two polls is exactly what the next poll should discover. What ENDP-28
forbids is a Tower that keeps polling *instead of* telling somebody, which is the gap REG-19 fills.

## What a consumer presents under a Contract

**REG-33 (recommended). The credential a Contract carries is issued by the owner.**

**REG-24 (required). An owner validates the credential a Contract carries without calling the
Control Tower. What else it consults in order to decide — its own store, an identity provider,
anything it chose — is its own.**

A Contract's credential is a credential like any other: presented by REG-3, and everything about
its life recommended rather than required, for the reasons the section above gives. REG-33 says
where it comes from, and it goes to the owner because the alternative excludes the Worker this
protocol exists to reach. Had the Tower minted it and signed it, every owner would need to verify a
signature from an issuer — a key to fetch, a token to parse, a clock to trust — and the Worker
holding one static secret could not have been an owner at all. Issued by the owner, the credential
is whatever the owner already knows how to check. What tooling surfaces the step is product, and
`spec/` has no business naming it.

REG-24 is the one rule in this file's second half that binds, and it binds because it is a promise
the protocol makes on every owner's behalf to consumers who cannot verify it. **Work already under
Contract runs with the Tower down** is a claim a consumer designs against — it decides how much of
its own availability to stake on a Contract — and an owner that quietly asks the Tower on every
call has falsified that claim with nothing anywhere to show it. The distinction is not between
validating locally and validating remotely; it is between one shared chokepoint the whole network
depends on and a dependency each owner chose for itself. An owner calling its own identity provider
has a dependency, and when it fails that owner is down: its own problem, its own page, its own
blast radius, and its consumers see an ordinary outage. An owner calling the Tower makes the
Tower's availability a precondition of every claim and every Response in the network, which is the
one thing the Tower's design rests on not being true.

An owner may of course have learned something from the Tower earlier — that is what brokering a
Contract is. The rule is about the call, not about the history.

## Still open here

- Whether the rights a credential carries have any shape this protocol sees. Today they have none:
  `403` is the entire vocabulary, and everything behind it — a scope, a Contract's list of Task
  types, a wildcard — is the Worker's own. What a Contract carries is open in
  [undecided](../docs/undecided.md).
- Whether taking a Claim and acting on one already held are authorized by the same right. They pull
  apart in practice — taking work is a grant about a Task type, acting is a fact about a lease you
  already hold — and the distinction belongs to [tasks and claims](tasks-and-claims.md), which is
  still `open`.
- The credential a `nudge` carries, which is listed in [tasks and claims](tasks-and-claims.md) and
  is that file's to answer, because only it knows who sends one and to what address.
- Whether a Tower exposes an enrollment surface at all. This protocol defines what a Worker serves;
  a Tower's own API is not in it.

## Withdrawn

The first four entries are from the audit that read every rule against the argument beneath it. The
rest are from the sort that followed, which read every rule against a different question: *must a
client and a Worker agree on this for a call to work, or does breaking it only make one deployment
worse?* Thirteen rules in this file answered the second way. They are listed individually rather
than summarized because a file that quietly loosened would be worse than one with a long list.

Three left with no replacement at all, and that is the more honest outcome where it applies: a
sentence that is neither a contract nor advice this protocol has standing to give is better deleted
than demoted.

- **REG-2** — required the Tower to read the Descriptor with the credential recorded at enrollment.
  Withdrawn with no replacement. It is REG-30 restricted to one client and one address, and it was
  written before REG-30 existed; as a separate rule it said nothing that REG-3, REG-21 and REG-30
  do not already say between them.
- **REG-10** — required a verifier holding two credentials for one Worker to check that each is
  refused what only the other may do, and to report a Worker that does not distinguish them.
  Withdrawn with no replacement. It existed to make REG-9's failure visible in a report, and the
  recommendation marker now does that directly: a report says *does not follow REG-27
  (recommended)* and an operator reads it before granting a second Contract. A rule whose whole job
  was to work around the absence of a graded class is machinery the graded class replaces.
- **REG-12** — required a revoked credential to be refused from the next request it is presented
  on. Withdrawn with no replacement. Revocation timing is the identity provider's, it is
  unobservable from outside — no verifier can know when a revocation was issued — and the second
  sentence, that this protocol defines no notification of revocation, was a statement about the
  protocol rather than an obligation on anyone. A holder learns by being refused; that remains
  true and needs no rule.
- **REG-1** — required that a Worker be enrolled by a person. Replaced by **REG-26**, the same
  sentence as a recommendation. No Worker can tell how it got into a registry.
- **REG-9** — required a credential to be issued to one holder. Replaced by **REG-27**, as a
  recommendation. It binds an issuer who is not a party to any call.
- **REG-11** — required a Worker to accept more than one valid credential for one holder. Replaced
  by **REG-28**, as a recommendation. A Worker that does not still answers every call correctly.
- **REG-15** — required a Tower to stop presenting credentials at a URL whose id changed. Replaced
  by **REG-29**, as a recommendation. It is caution with a secret the Tower holds, and no Worker's
  conformance turns on it.
- **REG-17** — required that an origin be recorded together with the credential to present to it.
  Replaced by **REG-30**, as a recommendation, which carries this and REG-18 in one sentence. The
  prohibition that protects a Worker is DESC-13's and still binds; what REG-17 added was how a
  Tower stores its own secrets.
- **REG-18** — required that a client present at an address the credential recorded for that
  address's origin, and none at an unrecorded origin. Replaced by **REG-30** for the first half.
  The second half was DESC-13 restated, and DESC-13 is where it belongs.
- **REG-25** — required that a Contract's credential be issued by the owner and recorded by a
  person. Replaced by **REG-33**, which keeps the first half as a recommendation and drops the
  second as product rather than protocol.
- **REG-4** — required a credential on every address this protocol defines. Replaced by **REG-21**,
  which requires a Worker to *accept* the credential recorded for it and says nothing about
  refusing anyone else. The argument beneath REG-4 was about the Tower and a consumer being able to
  get in, and never reached the further claim that nobody else may.
- **REG-5** — permitted an uncredentialed Descriptor route and forbade an uncredentialed anything
  else. Replaced by **REG-31**, which recommends a credential on every address that changes state
  and leaves reads to the Worker. REG-5 was the carve-out REG-4 needed; with REG-4 gone the line
  falls where ENDP-2 and ENDP-3 already draw it, between disclosing and doing.
- **REG-6** — required that a refusal carry the envelope and nothing else: no Descriptor, no
  address, no statement about which credential would have worked. Replaced by **REG-32**, which
  keeps the last clause, generalizes it to every reason a refusal might distinguish, and drops the
  first two. Under REG-31 a Worker may publish its Descriptor and its addresses to everyone, so a
  rule forbidding a refusal to mention what the Worker gives away freely protected nothing.
- **REG-20** — required that an owner validate a Contract's credential itself *and call nothing in
  order to do it*. Replaced by **REG-24**, which forbids calling the Control Tower and leaves an
  owner free to consult whatever authority it chose. The argument beneath REG-20 was entirely about
  the Tower being a shared dependency of every call in the network, and earned nothing about an
  owner's own identity provider — which is how a real deployment validates.
- **REG-22** — permitted an uncredentialed GET and required a credential on every address that
  changes state. Replaced by **REG-31**, which keeps the second half as a recommendation and puts
  the first in prose, where a permission belongs: a rule that permits obliges nobody. Issued in the
  audit and superseded in the sort that followed, because a deployment's decision about its own
  exposure is not a contract between two parties.
- **REG-23** — required that a refusal not distinguish among the reasons it refused. Replaced by
  **REG-32**, the same sentence as a recommendation. Issued in the audit and superseded in the sort
  for the same reason: how much a Worker says in an error message is a judgement about its own
  threat model, and every caller of it reads the refusal correctly either way.

# Security: what each party owes, and what the protocol already carries

> [spec/README.md](../spec/README.md) names a security model as a non-goal: a deployment's
> exposure, its threat model and how much an error message gives away are its own, and the
> protocol has standing to advise and none to enforce. This document is that advice, collected in
> one place. It binds nobody. Where it cites a rule id, the rule is the normative part and the
> sentence around it is the reason to follow it; where it cites a line of `packages/`, that is
> what the code does today and may change.
>
> It is written for three readers who hold different secrets: whoever **writes a Worker**,
> whoever **operates a Control Tower**, and whoever **consumes** a Worker under a Contract. A
> fourth section is for anyone installing the packages. How to report a weakness in this
> repository is in [SECURITY.md](../SECURITY.md).

## Where the line falls

The protocol fixes the parts of security that two parties must agree on for a call to work, and
leaves the rest to whoever runs each side. Knowing which is which is most of what this document
has to say.

| Fixed by the protocol | Left to the deployment |
|---|---|
| A credential arrives as `Authorization: Bearer` (REG-3) and the recorded one is accepted on every reading address (REG-37) | What a credential is made of, who issues it, how long it lives, how it is rotated (REG-27, REG-28 only recommend) |
| A refusal is `401` or `403`, never a `404` that hides it (REG-7) | Whether a refusal explains itself (REG-32 recommends it does not) |
| A credential issued for a grant covers only what the grant names and dies with it (GRANT-8, GRANT-9, GRANT-10) | What any other credential covers: a Worker's `covers` hooks, roles, scopes |
| A client sends a credential only to origins a person recorded (DESC-13, REG-16) | Which origins those are (REG-30 recommends recording one credential per origin) |
| Addresses and sinks are `https` (DESC-36, SUB-5); a sink must answer the webhook handshake (SUB-10) | Whether a sink that resolves to a private address is refused (SUB-6 recommends it) |
| A write wants a credential (REG-31 recommends) | Body limits, rate limits, quotas, TLS termination, caching headers, CORS |

Everything in the right-hand column is a decision somebody makes once per deployment, and the
sections below are the decisions this project would make.

## Writing a Worker

### Fail closed when the secret is missing

`mount()` hands `authenticate` whatever the request carried, and when it carried no
`Authorization` header that is `undefined`
([packages/hono/src/mount.ts](../packages/hono/src/mount.ts), `bearer`). A comparison written as
`token === env.CREDENTIAL` is therefore true for every caller the moment `CREDENTIAL` is unset:
`undefined === undefined`. A Worker deployed without its secret then answers `configure`,
`grants`, `subscriptions` and every Action to anyone who sends no header at all, while a test with
a wrong token still gets `401` and hides the hole.

Write the comparison so that an absent secret refuses everyone:

```ts
authenticate: (token) =>
  env.CREDENTIAL !== undefined && token === env.CREDENTIAL ? "accepted" : "unauthenticated",
```

A Worker that genuinely wants to be read openly says so by declaring no `authenticate` at all,
which `mount()` supports; what it must never do is arrive there by forgetting to set a secret.
The same applies to any route a Worker serves beside the protocol's: decide once what an absent
credential means and make every route agree.

### Compare without leaking the length

`===` on two strings stops at the first byte that differs. Over a network the difference is
rarely measurable, but the templates are copied, and the fix costs one line. On Cloudflare
`crypto.subtle.timingSafeEqual` compares two buffers of equal length, and Node has
`timingSafeEqual` in `node:crypto`; the cheapest portable form is to compare SHA-256 digests of
the two strings, which is what
[packages/hono/src/grants.ts](../packages/hono/src/grants.ts) already does for the credentials it
issues. A Worker reading a subject out of a token from an identity provider does not have this
problem; one holding a static secret does.

### Name the caller

`authenticate` may answer a bare `"accepted"` or `{ verdict: "accepted", caller }`, and the
difference is larger than it looks. With no caller named:

- every holder of a valid credential shares one idempotency scope (ENDP-34), so a key one
  caller used answers another caller's repeat with the first one's recorded outcome, and
  `idempotency_key_reused` tells a caller which keys exist;
- every holder shares one subscription scope (SUB-8), so any of them can list and end any
  subscription;
- nobody is an applicant, so `grants` refuses everyone (GRANT-2).

A Worker with one operator and one credential loses little by this. A Worker that admits more
than one holder names each — a stable string the identity provider gives it, or the digest of
the credential presented — and must not name one in the form `grantCaller` produces, which
`mount()` refuses with `500` because the alternative is impersonating a grant.

### One credential per holder, and two valid at once

REG-27 and REG-28 are recommendations, and both are cheap for a static-secret Worker: read two
environment variables instead of one, accept either, and rotation becomes an overlap rather than
an outage. A credential shared between two holders cannot be revoked for one of them, and a
refusal in a log names nobody.

### Never log the credential

The raw token reaches Worker code in three places: `authenticate(token)`, the `token` member of
an `ActionCall`, and `covers(token)`. None of them should reach a log line, an error message or
an Alert summary. Be careful with errors thrown from `authenticate` in particular: `mount()`
answers the caller with a fixed message and writes the thrown error to `console.error`, so an
identity-provider client that embeds the request URL in its error puts the token in the Worker's
log. On Cloudflare the Tail Worker in `@worker-protocol/cloudflare` serves uncaught exception
messages at `/logs` to every authenticated reader (LOG-10), so the same error would leave the
machine.

### Decide what every authenticated reader may see

REG-8, ALRT-6, ACTV-6 and LOG-10 make the Descriptor, Alerts, activity and logs one document for
every caller the Worker accepts; a credential either reads the surface or is refused it whole. So
anything that must not reach every enrolled reader does not go there:

- **Settings.** The reading address of `configure` answers the whole document. A member that
  holds a secret is declared `writeOnly`, which `mount()` never reads back and preserves when a
  form omits it; better still, the setting holds a reference into a vault and the secret never
  enters the document at all.
- **Logs.** Records are written on purpose, so write nothing into a message or a `fields` value
  that the operator of another team's Tower should not read.
- **Task payloads and Alert summaries.** A Task is read by whoever holds a credential covering its
  type (TASK-6), which under a Contract is another organization's Worker. The payload carries
  what the answerer needs and nothing it does not.

### Cover what each credential may do

With no `covers` hooks, every credential the Worker accepts reads every Task and performs every
Action. A Worker with more than one holder decides, per holder, which Task types it reads and
which Actions it performs, and lets `mount()` refuse the rest with `403` (TASK-6, ACT-22). A
credential issued through `grants` is already bounded by its grant and the Worker may only
narrow inside that (GRANT-8); nothing a Worker does may widen one.

### Treat `grants` as issuing credentials, because it is

Three things about the surface are worth knowing before admitting an applicant:

- **`applicants` is a list of who may mint credentials on this Worker.** Admit the Tower that
  brokers Contracts on it and nobody else. A Tower that only watches a Worker is enrolled with a
  recorded credential and needs no entry here (REG-37, GRANT-2).
- **Applying again without `rotate` widens a live credential.** GRANT-5 keeps the credential a
  consumer already holds and gives it the new lists from the response on. That is by design, and
  it means the applicant is the trust boundary: an applicant that can be talked into widening a
  grant has widened a credential it never sees.
- **`all` widens when the Worker declares something new.** A grant over `all` Actions covers the
  Action deployed next week. A grant that must not widen names its lists.

A leaked grant credential is mended by the applicant applying again with `rotate: true`: the old
credential is `401` from the response on and every subscription it created ends (GRANT-9).

### Expose only what is meant to be reached

- **TLS.** DESC-35 fixes `https` on the enrolled URL and `mount()` enforces nothing on the
  listening side, so termination belongs to the platform or the proxy in front. Loopback over
  plain HTTP is for tests, and a verifier reports it as a break.
- **Require a credential on every write** (REG-31). Serving the Descriptor openly is a trade a
  Worker may choose; serving an Action openly is publishing its address and schema to whoever
  wants to call it.
- **Caching.** `mount()` sets `content-type` and the two protocol headers and nothing else. A
  shared cache or a CDN in front of an authenticated Worker should see `Cache-Control: no-store`
  on every protocol response; add it at the edge or in a middleware before `mount()`.
- **CORS.** `mount()` sets no CORS headers, which is the safe default: a browser cannot read these
  responses cross-origin. Add them only for an origin you mean to serve a console from.
- **Size and rate.** `mount()` reads the whole body of an Action and stores it in the outcome
  record for the idempotency window, sets no body limit, and answers no `rate_limited`. Put a
  body limit and a per-credential rate limit in front — Hono's `bodyLimit` middleware, or the
  platform's — before exposing a keyed Action to a Contract holder.

### Choose stores for a deployment, not for a demo

`memoryOutcomes()`, `memorySubscriptions()` and `memoryGrants()` live in one process and are
lost with it. The outcome store in particular keeps every completed row until the process ends,
with the raw body of the request that produced it, so a caller allowed to perform a keyed Action
can grow memory with a fresh key per call. They are what the examples use so that the examples
run anywhere; a deployment uses the Durable Object stores in `@worker-protocol/cloudflare`, which
sweep expired rows on every reservation, or stores of its own with the same shape.

Whatever store a deployment uses holds two kinds of secret at rest: each subscription's
`sinkCredential`, in clear because the Worker must present it on every delivery (SUB-11), and the
digest of every grant credential. Protect the store as the credentials in it deserve, and do not
let its contents into a backup that travels further than the Worker does.

### Do not let a caller aim the Worker at the inside of the network

A subscription's sink is a URL a credentialed caller chose, and the Worker will make an `OPTIONS`
request to it before storing the subscription (SUB-10) and a `POST` for every matching event
(SUB-11). What `mount()` does: requires `https`; refuses a hostname that is a loopback, private or
link-local address as far as the name shows it (SUB-6); runs the handshake first, so an address
that never asked for events answers nothing; never reads a response body; times out each
delivery. What it cannot do: resolve the name, so a public name pointing at `10.0.0.5` passes;
and it does not yet pin redirects, so a sink may answer `307` towards an internal address.

A Worker inside a private network therefore does one of two things: egresses through a proxy
that refuses internal ranges and redirects, which is what most platforms offer; or resolves the
sink itself and checks the addresses before and after the handshake. On Cloudflare the first is
the platform's default — a Worker cannot reach a private address at all — which is why SUB-6
recommends rather than binds.

`insecureSinkOrigins` exists so that a local backend over plain HTTP can subscribe during
development. It names origins, not a switch, and a deployment never sets it.

### Keep `nudges` cheap

A nudge is answered under the enrollment credential like every other address (REG-37), and a
credential issued for a grant is not refused there. A handler that does real work on a nudge can
be made to do it by any caller the Worker accepts; the handler schedules a read and returns.

## Operating a Control Tower

A Tower holds a credential for every Worker it watches, which makes it the most valuable thing
to compromise in the network. The rules below are mostly already written for it.

- **Enrollment is a person's act** (REG-26). A base URL and a credential are recorded by somebody,
  on a day, in a log. A Tower that automates enrollment against a directory it trusts has made an
  operational choice and should log it the same way.
- **Record the origins, not the Descriptor's word** (REG-16, REG-30). A Descriptor is a document
  the Worker controls, and an address in it is an instruction to send a request somewhere. The
  list of origins a credential may go to comes from the person who enrolled the Worker, and the
  client never presents a credential elsewhere (DESC-13): `@worker-protocol/client` already sends
  it only to the Descriptor's own origin and reads anything else unauthenticated.
- **One credential per Worker, recorded per origin.** A string pasted into two enrollments is a
  secret two deployments now hold; REG-30 says to record one per origin so that a second system's
  logs never carry the first system's key.
- **Never rebind silently** (REG-35, REG-14, REG-29). A Worker id that changes at an enrolled URL
  is a different system where the old one stood — a redeployed path, a lapsed hostname somebody
  took. Record the mismatch, keep the entry, stop presenting the credential there until a person
  decides, because the alternative is handing a stranger every Contract made with the previous
  occupant.
- **Show a refused credential as what it is** (REG-19). A `401` or `403` from a poll is a problem
  one edit fixes, and a console that files it under *not responding* leaves it unfixed.
- **Compare each Descriptor with the last one** (REG-36). A schema that changed under a kept name
  breaks a consumer on the next call, and the Tower is the only party holding two moments of the
  same Worker.
- **The Tower is an applicant, so its own credential mints credentials.** Everything above about
  rotating and not sharing it applies twice. Applying a grant without `rotate` widens a credential
  the Tower never sees, so a Tower treats a change to a Contract's lists as a change to what
  somebody can do, with the same review.
- **An owner never calls the Tower to validate a credential** (REG-24). A Tower that offers such
  a surface is offering a dependency every owner is forbidden to take; do not build it.

## Consuming a Worker under a Contract

- **Use `consume()` or do what it does.** `@worker-protocol/client` validates every document
  against the schemas, sends the credential only to the Descriptor's origin, does not follow
  redirects, and never retries a `reject` (ENDP-28). A hand-written client owes the same four.
- **A Descriptor is input from another party.** Its schemas, addresses and names are what the
  Worker says they are, and `consume()` treats them as data to validate rather than code to
  trust. A console that renders a form from a declared schema renders it; it does not evaluate
  anything the schema carries.
- **Give each subscription a sink credential of its own**, long and random, because the Worker
  presents it on every delivery and it is the only thing that tells this Worker's deliveries
  from anybody's who learned the sink's URL. `sink()` in the client package checks it, checks the
  content type, checks the event's `source` against an allowlist and deduplicates by `source`
  and `id` within the window EVT-8 declares; a sink written by hand owes the same.
- **Hold the credential a grant issued as the secret it is.** It was answered once, on creation or
  rotation, and is not listed again (GRANT-6). Store it where the consumer's other secrets live,
  and ask the applicant to rotate it the moment it may have leaked.
- **A credential revoked mid-work costs the work, not a lease.** Post the Action, read the `401`,
  and raise it where a person will see it. There is nothing to retry.

## Running the verifier

- Hand the credential to `worker-protocol-conformance` through `WORKER_PROTOCOL_CREDENTIAL`
  rather than `--credential`: an argument is visible to every process on the machine and lands in
  shell history and CI logs. The arranged credentials a reference run needs travel the same way.
- The transcript records what the Worker answered — status, headers and body — and not the
  `Authorization` header the tool presented, so a report can be attached to a ticket. A Worker
  that embeds a secret in its own responses puts it in that report, and the policy above says why
  it should not.
- Verify Workers you operate or were asked to verify. The arranged checks perform an Action and
  create and end subscriptions, which is work done on somebody's system.

## Installing the packages

- **Pin exact versions** and let a reviewed bump move them. Every published package is small and
  carries at most a handful of runtime dependencies, so a diff between two versions is readable.
- **Verify provenance.** Each release is published from
  [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) with an attestation naming
  the commit and the workflow that built it; `npm audit signatures` checks every installed
  package against the registry's keys and the attestation. A tarball with no attestation is not
  one this repository published.
- **Follow an edition tag when a MAJOR or MINOR may break you.** `edition-0.9` and its siblings
  point at the latest release that encodes that edition, so a consumer that is not ready for the
  next one installs by tag and moves on purpose.
- **Give new releases a cooling period.** This repository waits seven days before taking any
  dependency release (`minimumReleaseAge` in
  [pnpm-workspace.yaml](../pnpm-workspace.yaml)), which is long enough for a hijacked release to
  be noticed and pulled. The same setting protects a consumer of these packages from the same
  event upstream of them.
- **Build only what must be built.** pnpm 12 runs no install script unless the workspace allows
  it; the two this repository allows are listed with their reasons. A project consuming these
  packages needs none.

## Before a Worker goes live

A short list, in the order the sections above argue it:

1. The secret is set, and `authenticate` refuses everyone when it is not.
2. The comparison does not short-circuit, or the credential is checked by an identity provider.
3. Each holder is a named caller, or there is exactly one holder and that is a decision.
4. Two credentials are accepted during a rotation, and none is shared between two holders.
5. The token appears in no log line, error message, Alert, Task payload or setting.
6. `covers` is written for every credential that must not read every Task or perform every Action.
7. `applicants` names the Tower that brokers Contracts here, and nobody else.
8. TLS terminates in front; every write requires a credential; responses carry `no-store`.
9. A body limit and a rate limit stand in front of every keyed Action.
10. Stores are durable, swept and protected; `insecureSinkOrigins` is unset.
11. Egress refuses private addresses and redirects, or the Worker resolves and checks sinks.
12. `worker-protocol-conformance` passes, with the credential in the environment.

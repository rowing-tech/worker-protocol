# Deliberately undecided

What is open on purpose, listed so that the design can be argued with rather than merely approved.
Each entry is a question nobody has had to answer yet — not an omission, and not a commitment to
answer it the way it is phrased here.

An entry leaves this list in one direction only: a section of `spec/` answers it, with a schema
behind it. Until then, the protocol is silent, and where it is silent the option is open. An entry
that a `spec/` file already lists among what it will answer says which file, and the file points
back — so that when the answer lands, both places know.

- **Whether the event envelope is CloudEvents**, and if so in which version and which binding.
  It is the candidate and nothing more; until it is settled, nobody knows where the id they must
  deduplicate by lives. Listed in [spec/events.md](../spec/events.md).
- **What a health check carries beyond status and detail** — observed values and units, and
  whether common checks share names across workers. Listed in [spec/health.md](../spec/health.md).
- **Who verifies that a worker answers the Task types it declares.** The Control Tower at
  registration, the owner at claim time, or nobody.
- **What a Contract carries beyond credentials.** Rate, retention of Task events, revocation while
  a Task is claimed, and the time zone a multi-tenant Worker cuts a consumer's metric buckets in.
  Revocation is listed in [spec/registration.md](../spec/registration.md) and the time zone in
  [spec/metrics.md](../spec/metrics.md).
- **Whether a Task type may belong to several Services, and whether a Service may span workers of
  several teams.**
- **Whether Alerts need a Contract to be read** — and whether Alerts are a distinct surface at all,
  or Tasks nobody must claim. Nothing implements them yet. Listed in
  [spec/alerts.md](../spec/alerts.md).
- **Who consolidates the cost and elapsed time a Response carries.** Nothing does today; the
  consumer's own metrics, split by the Contract each Response came under, are the obvious
  candidate. Listed in [spec/metrics.md](../spec/metrics.md).
- **Whether the consumer names the Action or posts a fact the owner maps to one.** The second is
  more decoupled; the first is simpler.
- **Whether a stale Response is refused by lease time or by a fencing token.** A precondition
  checked at write time needs no sweep.
- **Whether a Task and its Claims travel as one resource or two** on the Worker API. Listed in
  [spec/tasks-and-claims.md](../spec/tasks-and-claims.md).
- **Whether a person's cross-owner work list is the Tower's or a Worker's.** A teams app is one
  answer; the console is another.
- **How much the protocol recognizes about Workers that talk to people**, beyond what it recognizes
  about any worker.
- **Whether an idempotency key is scoped to the caller that presented it, or is global to the
  Action.** A key a caller invents is its own, and two callers sending the same string mean two
  different things; a key read from a declared field of the payload is often a natural identity
  that any caller would send for the same fact, and deduplicating across callers is the point of
  it. The two cases pull opposite ways and the declaration does not yet say which applies. Listed
  in [spec/endpoints.md](../spec/endpoints.md).

# Deliberately undecided

What is open on purpose, listed so that the design can be argued with rather than merely approved.
Each entry is a question nobody has had to answer yet — not an omission, and not a commitment to
answer it the way it is phrased here.

An entry leaves this list in one direction only: a section of `spec/` answers it, with a schema
behind it. Until then, the protocol is silent, and where it is silent the option is open. An entry
that a `spec/` file already lists among what it will answer says which file, and the file points
back — so that when the answer lands, both places know.

- **What a health check carries beyond status and detail** — observed values and units, and
  whether common checks share names across workers. Listed in [spec/health.md](../spec/health.md).
- **Who verifies that a worker answers the Task types it declares.** The Control Tower at
  registration, the owner when a Response arrives, or nobody. Nothing can today: an Action carries
  no sign of the Task it answered, so an owner sees a performance and not a Response.
- **What a Contract carries beyond credentials.** Rate, retention of Task events, when a revocation
  takes effect, and the time zone a multi-tenant Worker cuts a consumer's metric buckets in.
  Revocation is listed in [spec/registration.md](../spec/registration.md) and the time zone in
  [spec/metrics.md](../spec/metrics.md).
- **Whether a Task type may belong to several Services, and whether a Service may span workers of
  several teams.**
- **Whether this protocol names a `contract` dimension for a metric**, so that one name means the
  same thing across Workers, or leaves each Worker to declare its own. The Worker is authoritative
  over the value either way — it sees the credential on every request, so it knows which Contract
  each read and each Action came under. Listed in [spec/metrics.md](../spec/metrics.md).
- **Whether a consumer reports the cost and elapsed time of the work it did, and who consolidates
  it.** Nothing carries either today — a Response is one Action and its input is the Worker's own
  shape — and the consumer's own metrics, split by the Contract, are the obvious candidate. Listed
  in [spec/metrics.md](../spec/metrics.md).
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

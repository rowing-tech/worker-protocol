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
- **What a Contract carries beyond what its credential covers.** [spec/grants.md](../spec/grants.md)
  answers the coverage — the Task types, Actions and event types a credential reads, performs and
  consumes — and when a revocation takes effect, for a credential issued through it. Still open:
  rate, retention of Task events, and the time zone a multi-tenant Worker cuts a consumer's metric
  buckets in. Listed in [spec/grants.md](../spec/grants.md), and the time zone in
  [spec/metrics.md](../spec/metrics.md).
- **Whether a Task type may belong to several Services, and whether a Service may span workers of
  several teams.**
- **Whether a consumer reports the cost and elapsed time of the work it did, and who consolidates
  it.** Nothing carries either today — a Response is an Action, told apart from any other
  performance only where its call names the Task it answers (TASK-39), and its input is the
  Worker's own shape — and the consumer's own metrics, split by the `contract` dimension MET-23
  names, are the obvious candidate. Listed in [spec/metrics.md](../spec/metrics.md).
- **Whether a person's cross-owner work list is the Tower's or a Worker's.** A teams app is one
  answer; the console is another.
- **How much the protocol recognizes about Workers that talk to people**, beyond what it recognizes
  about any worker.

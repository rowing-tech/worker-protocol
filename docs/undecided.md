# Deliberately undecided

What is open on purpose, listed so that the design can be argued with rather than merely approved.
Each entry is a question nobody has had to answer yet — not an omission, and not a commitment to
answer it the way it is phrased here.

An entry leaves this list in one direction only: a section of `spec/` answers it, with a schema
behind it. Until then, the protocol is silent, and where it is silent the option is open.

- **Whether the event envelope is CloudEvents**, and if so in which version and which binding.
  It is the candidate and nothing more; until it is settled, nobody knows where the id they must
  deduplicate by lives.
- **Whether the Hub keeps a copy of the shapes it catalogs.** Everything schema-shaped is derived
  from the workers today, which means discovery degrades when a worker is down and not only when
  the Hub is. Caching fixes that and costs the guarantee that a catalog entry cannot be stale.
- **What the minimum conformance profile is.** Whether a Worker may implement one half and not the
  other — the worked case has one that raises no Tasks — and what is required of every Worker
  whatever else it does.
- **What a health check carries beyond status and detail** — observed values and units, and
  whether common checks share names across workers.
- **Who verifies that a worker answers the Task types it declares.** The hub at registration, the
  owner at claim time, or nobody.
- **What a Contract carries beyond credentials.** Rate, retention of Task events, revocation while
  a Task is claimed.
- **Whether a Task type may belong to several Services, and whether a Service may span workers of
  several teams.**
- **Whether Alerts need a Contract to be read** — and whether Alerts are a distinct surface at all,
  or Tasks nobody must claim. Nothing implements them yet.
- **Who consolidates the cost and elapsed time a Response carries.** Nothing does today.
- **Whether the consumer names the Action or posts a fact the owner maps to one.** The second is
  more decoupled; the first is simpler.
- **Whether a stale Response is refused by lease time or by a fencing token.** A precondition
  checked at write time needs no sweep.
- **Whether a Task and its Claims travel as one resource or two** on the Worker API.
- **Whether a person's cross-owner work list is the Hub's or a Worker's.** A teams app is one
  answer; the console is another.
- **How much the protocol recognizes about Workers that talk to people**, beyond what it recognizes
  about any worker.

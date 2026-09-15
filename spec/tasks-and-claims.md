# Tasks and Claims

`open`

How an owner exposes the Tasks its conditions hold open, how a consumer claims one exclusively, and
how a Response comes back. The Task closes by condition; the Claim closes by declaration or by
lease.

To answer here:

- The shape of a Task on the wire: id, type, payload, the Capability it requires, the closed list
  of Actions that may resolve it, and whether its Claims travel with it or separately.
- Claiming: the verb, the address, what is answered, who sets the lease, how it is renewed, and
  what a second claimant is told.
- Whether a Response is one call or two — the Action into the owner, the outcome onto the Claim —
  and whether the two are atomic.
- How a consumer learns which Tasks it may claim: whether the owner filters by its Contract and its
  Capabilities, or it reads and discards.
- What the protocol assumes about clocks, since a lease is a span two processes must agree on
  without knowing each other.
- The `nudge`: who sends one, to what address, carrying what, authenticated how.

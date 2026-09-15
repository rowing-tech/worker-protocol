# Events

`open`

What a Worker publishes for anyone to consume: facts with no addressee, including the lifecycle
transitions of its Tasks and Alerts.

To answer here:

- The envelope. CloudEvents is the candidate; the version and the binding are unsettled, and until
  they are nobody knows where the id to deduplicate by lives.
- How a Worker declares which events it publishes, with what shape, and to which broker.
- How a consumer obtains access to a broker that is not its own: through the Contract, or out of
  band.
- What a consumer on a platform that cannot hold a long-lived subscription is expected to do, and
  what the thin subscriber beside it owes the Worker.
- Delivery is at least once. What carries the deduplication id, and how long a consumer must
  remember it.

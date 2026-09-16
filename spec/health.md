# Health

`open`

The answer a Worker gives when polled: one status with three values — `healthy`, `degraded`,
`unhealthy` — and a map of named checks, each with its own status and a short human-readable
detail. `healthy` and `degraded` answer 200; `unhealthy` answers 503.

To answer here:

- The envelope, exactly, and what a check may carry beyond its status and detail. Open in
  [undecided](../docs/undecided.md).
- Whether common checks share names across Workers, or every Worker names its own. Open in
  [undecided](../docs/undecided.md).
- The cadence the Control Tower polls at and the timeout it allows, which together decide what a
  Worker can afford to do inside a check.
- What a Worker answers while it is starting and has not yet checked anything.

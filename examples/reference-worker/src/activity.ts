import type { Activity } from "@worker-protocol/hono";

/**
 * The `activity` Capability, arranged to be checked.
 *
 * One item in each state, so that every state a check can read is read: a Worker holding one kind
 * of activity never exercises the other two, and a verifier that saw only `running` would have
 * nothing to say about `scheduled`.
 *
 * What this Worker is "doing" is arranged, like everything else here. What is real is the shape and
 * the direction: these are this Worker's own undertakings, reported by the only party that holds
 * them, and nothing is held on anyone's behalf. `spec/activity.md` says why that is not a Claim.
 */

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

export function activity(): Activity[] {
  return [
    {
      id: "activity-1",
      state: "running",
      // ACTV-3: when work began, and not when somebody asked.
      since: ago(0.5),
      summary: "Verifying vehicle ABC-123 against the registry.",
    },
    {
      id: "activity-2",
      state: "pending",
      // ACTV-3: when it joined the queue, which is what makes a stuck one visible.
      since: ago(2),
      summary: "Price quote #4471, waiting for the verification ahead of it.",
    },
    {
      id: "activity-3",
      state: "scheduled",
      // ACTV-3: when the Worker undertook it — not when it will next run, which is scheduling.
      since: ago(72),
      summary: "Rebuild the vehicle index, nightly at 00:00.",
    },
  ];
}

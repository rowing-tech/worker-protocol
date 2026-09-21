import type { Alert } from "@worker-protocol/hono";

/**
 * The `alerts` Capability, arranged to be checked.
 *
 * Two Alerts, one of each severity, and one offering an Action — because ALRT-7 is an agreement
 * between two entries and a Worker whose Alerts offer nothing never exercises it.
 *
 * Both conditions simply hold. There is no way to dismiss one and no state to hold if there were:
 * ALRT-5 ends an Alert when its condition stops, and a snooze belongs to whoever is looking.
 */

const began = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000);

export function alerts(): Alert[] {
  return [
    {
      id: "alert-1",
      severity: "warning" as const,
      since: began(30),
      summary: "The credential recorded for this Worker expires in three days.",
      // ALRT-7: by the name the `actions` entry holds it under, and nothing else — the schema is
      // already there and a second copy is a second thing to keep in step.
      actions: ["configure"],
    },
    {
      id: "alert-2",
      severity: "critical" as const,
      since: began(2),
      summary: "Three Claims on the same Task have failed and no lease is being granted.",
      actions: [],
    },
  ];
}

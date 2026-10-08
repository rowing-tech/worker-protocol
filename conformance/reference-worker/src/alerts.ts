import type { Alert } from "@worker-protocol/hono";

/**
 * The `alerts` Capability, arranged to be checked.
 *
 * Two Alerts, one of each severity, and one offering an Action with a value filled in — because
 * ALRT-7 and ALRT-9 are agreements between two entries, and a Worker whose Alerts offer nothing
 * never exercises either.
 *
 * Both conditions simply hold. There is no way to dismiss one and no state to hold if there were:
 * ALRT-8 ends an Alert when its condition stops, and a snooze belongs to whoever is looking.
 */

/**
 * When this module was loaded, which every condition is dated from. A condition began once: an
 * instant computed on each read would move with the clock, and two reads a millisecond apart would
 * disagree about when the same Alert began — which is the difference ALRT-6 compares.
 */
const LOADED = Date.now();
const began = (hoursAgo: number) => new Date(LOADED - hoursAgo * 3_600_000);

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
      // ALRT-9: a value this Alert already knows, for a member `configure` declares. The operator
      // still sends the whole document; this fills one field of the form they start from.
      inputs: { configure: { label: "reference" } },
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

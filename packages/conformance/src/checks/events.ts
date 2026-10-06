import { eventsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";

/**
 * The `events` Capability, which is as far as a Descriptor reaches.
 *
 * **Nothing here calls anything, because there is nothing to call.** An event travels over a broker
 * this protocol declines to name, or is pushed through `subscriptions`, so DESC-22 leaves the shared
 * entry's address optional for this one Capability and a verifier has no surface to point at. What
 * the Descriptor says is judged here; what a Worker pushes is judged where a sink can see it, in
 * `subscriptions.ts`. A protocol that declines to own a transport declines to see what crosses it,
 * and that is a property of the design rather than a gap in this file.
 *
 * It takes no transcript for the same reason. A check that sent nothing is the honest shape here.
 */
export const CLAIMS = ["EVT-13", "EVT-14", "EVT-12", "EVT-4", "EVT-8"] as const;

export function checkEvents({
  entry,
  subscriptions,
  rules,
  attribution,
}: {
  entry: Record<string, unknown> | undefined;
  /** The `subscriptions` entry beside it, because EVT-14 is a statement about the two. */
  subscriptions: Record<string, unknown> | undefined;
  rules: Map<string, Rule>;
  attribution: Attribution;
}): Result[] {
  const { results, say } = verdicts(rules, CLAIMS);

  if (entry === undefined) {
    for (const id of CLAIMS) say(id, "notExercised", "the Worker declares no `events`");
    return results;
  }

  const declared = eventsEntry.safeParse(entry);
  if (!declared.success) {
    const blamed = new Set<string>();
    for (const issue of declared.error.issues) {
      const id = ruleFor(attribution, "events-entry", issue.path) ?? "EVT-13";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    for (const id of CLAIMS) {
      if (!blamed.has(id)) say(id, "notExercised", "the `events` entry did not validate");
    }
    return results;
  }

  const { publishes, broker } = declared.data as unknown as {
    publishes: Record<string, unknown>;
    broker?: string;
  };

  // EVT-13 and EVT-8 are what validation established: the broker's three members together or none
  // of them, and the window a consumer sizes its deduplication store against. No string is parsed —
  // this protocol names no broker and fixes no protocol binding — so a check says they are there.
  say("EVT-13", "passes");
  say("EVT-8", "passes");

  // EVT-14: a way out. An entry with no broker and no `subscriptions` beside it declares events that
  // reach nobody, and no consumer reading the Descriptor could tell how it was meant to get them.
  if (broker !== undefined || subscriptions !== undefined) say("EVT-14", "passes");
  else
    say(
      "EVT-14",
      "fails",
      "the entry declares no broker and the Worker declares no `subscriptions`",
    );

  // EVT-12 and EVT-4: every event type it publishes, each with the schema of its data, under a
  // qualified name. A Worker that publishes none exercises neither, and an empty map is
  // conformant — DESC-34 needs no qualification for a Capability declared with nothing in it.
  if (Object.keys(publishes).length === 0) {
    say("EVT-12", "notExercised", "the entry declares no event type");
    say("EVT-4", "notExercised", "the entry declares no event type");
  } else {
    say("EVT-12", "passes");
    say("EVT-4", "passes");
  }

  return results;
}

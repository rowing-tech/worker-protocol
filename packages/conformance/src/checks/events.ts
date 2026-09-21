import { eventsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Result, Rule } from "../report.ts";

/**
 * The `events` Capability, which is as far as a Descriptor reaches.
 *
 * **Nothing here calls anything, because there is nothing to call.** An event travels over a broker
 * this protocol declines to name, so DESC-22 leaves the shared entry's address optional for this
 * one Capability and a verifier has no surface to point at. Four of its nine rules are read off the
 * Descriptor and the other five are somebody else's or nobody's — a protocol that declines to own
 * a transport declines to see what crosses it, and that is a property of the design rather than a
 * gap in this file.
 *
 * It takes no transcript for the same reason. A check that sent nothing is the honest shape here.
 */
export const CLAIMS = ["EVT-10", "EVT-3", "EVT-4", "EVT-8"] as const;

export function checkEvents(
  entry: Record<string, unknown> | undefined,
  rules: Map<string, Rule>,
  attribution: Attribution,
): Result[] {
  const results: Result[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };

  if (entry === undefined) {
    for (const id of CLAIMS) say(id, "notExercised", "the Worker declares no `events`");
    return results;
  }

  const declared = eventsEntry.safeParse(entry);
  if (!declared.success) {
    const blamed = new Set<string>();
    for (const issue of declared.error.issues) {
      const id = ruleFor(attribution, "events-entry", issue.path) ?? "EVT-10";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    for (const id of CLAIMS) {
      if (!blamed.has(id)) say(id, "notExercised", "the `events` entry did not validate");
    }
    return results;
  }

  const { events } = declared.data as unknown as { events: Record<string, unknown> };

  // EVT-10 and EVT-8 are what validation established: a broker, a binding, a destination and the window a
  // consumer sizes its deduplication store against. Neither string is parsed — this protocol names
  // no broker and fixes no binding — so what a check can say is that both are there.
  say("EVT-10", "passes");
  say("EVT-8", "passes");

  // EVT-3 and EVT-4: every event type it publishes, each with the schema of its data, under a
  // qualified name. A Worker that publishes none exercises neither, and an empty map is
  // conformant — DESC-2 needs no qualification for a Capability declared with nothing in it.
  if (Object.keys(events).length === 0) {
    say("EVT-3", "notExercised", "the entry declares no event type");
    say("EVT-4", "notExercised", "the entry declares no event type");
  } else {
    say("EVT-3", "passes");
    say("EVT-4", "passes");
  }

  return results;
}

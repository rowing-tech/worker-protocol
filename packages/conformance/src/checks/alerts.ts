import { alertPage, alertsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `alerts` Capability.
 *
 * The smallest surface in the protocol after `health`, and the only one whose whole content is
 * addressed to a person: ALRT-3's summary is parsed by nothing. What a program acts on is the
 * severity and the Actions, and both are closed vocabularies a console renders without knowing
 * anything about the Worker — which is what these checks can therefore reach.
 *
 * ALRT-5 is absent because nothing can reach it. An Alert that disappears may have had its
 * condition stop holding, or may have been dismissed by somebody this verifier never saw.
 */
export const CLAIMS = ["ALRT-1", "ALRT-2", "ALRT-3", "ALRT-4", "ALRT-7"] as const;

export async function checkAlerts(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  actionNames: string[],
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
): Promise<Result[]> {
  const { results, say, allExcept } = verdicts(rules, CLAIMS);

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `alerts`");
    return results;
  }

  const declared = alertsEntry.safeParse(entry);
  if (!declared.success) {
    const issue = declared.error.issues[0];
    const id = ruleFor(attribution, "alerts-entry", issue?.path ?? []) ?? "ALRT-1";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the `alerts` entry did not validate", [id]);
    return results;
  }
  say("ALRT-1", "passes");

  if (url === null) {
    allExcept("notExercised", "the declared address did not resolve", ["ALRT-1"]);
    return results;
  }

  const answer = await transcript.send(url, "the Alerts whose conditions hold");
  if (answer.status !== 200) {
    say("ALRT-2", "fails", `the address answered ${answer.status}`);
    allExcept("notExercised", "no page of Alerts was read", ["ALRT-1", "ALRT-2"]);
    return results;
  }

  const page = alertPage.safeParse(answer.json);
  if (!page.success) {
    const issue = page.error.issues[0];
    const id = ruleFor(attribution, "alert-page", issue?.path ?? []) ?? "ALRT-2";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the page did not validate", ["ALRT-1", id]);
    return results;
  }
  say("ALRT-2", "passes");

  // ALRT-3 and ALRT-4 are what validation established, said per rule because a report naming one
  // of them is the point of having ids. A Worker with nothing to report exercises neither, and
  // that is `not exercised` rather than a pass — an empty page is conformant and proves nothing
  // about the shape of an Alert.
  if (page.data.items.length === 0) {
    say("ALRT-3", "notExercised", "no condition is holding, so no Alert was read");
    say("ALRT-4", "notExercised", "no condition is holding, so no severity was read");
    say("ALRT-7", "notExercised", "no condition is holding, so no Action was offered");
    return results;
  }
  say("ALRT-3", "passes");
  say("ALRT-4", "passes");

  // ALRT-7: every Action an Alert offers is one this Worker's own `actions` entry accepts. An
  // agreement between two entries, which is the part no schema reaches — and a Descriptor
  // disagreeing with itself is DESC-18 one level down.
  const accepted = new Set(actionNames);
  const dangling: string[] = [];
  for (const alert of page.data.items) {
    for (const action of alert.actions) {
      if (!accepted.has(action)) dangling.push(`${alert.id} offers \`${action}\``);
    }
  }
  const offered = page.data.items.some((alert) => alert.actions.length > 0);
  if (!offered) {
    say("ALRT-7", "notExercised", "no Alert offers an Action");
  } else if (dangling.length === 0) {
    say("ALRT-7", "passes");
  } else {
    say("ALRT-7", "fails", `${dangling.join("; ")}, which its \`actions\` entry does not accept`);
  }

  return results;
}

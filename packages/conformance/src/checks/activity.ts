import { activityEntry, activityPage } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `activity` Capability.
 *
 * Alerts with the words changed, which is what `spec/activity.md` says it is: one address, one
 * page, items that carry a closed-vocabulary state and a summary addressed to a person. What these
 * checks can reach is exactly what a program can act on — that the page has the shape and that
 * every state is one of the three.
 *
 * ACTV-5 is absent because nothing can reach it. An activity that disappears may have finished,
 * failed, or been dropped, and no tool outside the Worker can tell which — the same shape as ALRT-5
 * and TASK-15. ACTV-6 is `H` and lives in `arranged.ts` with ALRT-6, because two credentials have
 * to exist before two lists can be compared.
 */
export const CLAIMS = ["ACTV-1", "ACTV-2", "ACTV-3", "ACTV-4"] as const;

export async function checkActivity(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
): Promise<Result[]> {
  const { results, say, allExcept } = verdicts(rules, CLAIMS);

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `activity`");
    return results;
  }

  const declared = activityEntry.safeParse(entry);
  if (!declared.success) {
    const issue = declared.error.issues[0];
    const id = ruleFor(attribution, "activity-entry", issue?.path ?? []) ?? "ACTV-1";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the `activity` entry did not validate", [id]);
    return results;
  }
  say("ACTV-1", "passes");

  if (url === null) {
    allExcept("notExercised", "the declared address did not resolve", ["ACTV-1"]);
    return results;
  }

  const answer = await transcript.send(url, "what the Worker is doing and has undertaken");
  if (answer.status !== 200) {
    say("ACTV-2", "fails", `the address answered ${answer.status}`);
    allExcept("notExercised", "no page of activities was read", ["ACTV-1", "ACTV-2"]);
    return results;
  }

  const page = activityPage.safeParse(answer.json);
  if (!page.success) {
    const issue = page.error.issues[0];
    const id = ruleFor(attribution, "activity-page", issue?.path ?? []) ?? "ACTV-2";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the page did not validate", ["ACTV-1", id]);
    return results;
  }
  say("ACTV-2", "passes");

  // ACTV-3 and ACTV-4 are what validation established, said per rule because a report naming one
  // of them is the point of having ids. A Worker holding nothing exercises neither, and that is
  // `not exercised` rather than a pass: an empty page is conformant and proves nothing about the
  // shape of an activity.
  if (page.data.items.length === 0) {
    say("ACTV-3", "notExercised", "the Worker holds nothing, so no activity was read");
    say("ACTV-4", "notExercised", "the Worker holds nothing, so no state was read");
    return results;
  }
  say("ACTV-3", "passes");
  say("ACTV-4", "passes");

  return results;
}

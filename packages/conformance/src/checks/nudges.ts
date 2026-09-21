import { nudgesEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `nudges` Capability: being told there is work of a Task type.
 *
 * The only surface in this protocol whose body is fixed by the protocol rather than by the Worker,
 * which is what a check gets to use: it can write a nudge without reading anything, and both of the
 * answers below are shapes `spec/nudges.md` states rather than shapes this Worker chose.
 *
 * **NDG-3 is asked first and NDG-2 second, and the order is the same one `spec/` argues for.** A
 * nudge for a type the Worker declares no Skill for is refused, so nothing happened; a nudge it
 * accepts sends it to read somebody's Tasks. The second is why the register classes NDG-2 `H` — it
 * needs a Worker whose operators agreed it could be told — and the first is `W` for the reason
 * ACT-6 is: the witness is a refusal.
 */
export const CLAIMS = ["NDG-1", "NDG-2", "NDG-3"] as const;

/** A type namespaced under a domain nobody owns, so no Worker could honestly declare a Skill for it. */
const NO_SUCH_TYPE = "tech.rowing.no-such.task-type-4c1f";

export async function checkNudges(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  /** TASK-31's declaration, read off the Descriptor root: the types this Worker may be nudged for. */
  skills: string[],
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
  mayPerform: boolean,
): Promise<Result[]> {
  const { results, say, allExcept } = verdicts(rules, CLAIMS);

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `nudges`");
    return results;
  }

  const declared = nudgesEntry.safeParse(entry);
  if (!declared.success) {
    const issue = declared.error.issues[0];
    const id = ruleFor(attribution, "nudges-entry", issue?.path ?? []) ?? "NDG-1";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the `nudges` entry did not validate", [id]);
    return results;
  }
  say("NDG-1", "passes");

  if (url === null) {
    allExcept("notExercised", "the declared address did not resolve", ["NDG-1"]);
    return results;
  }

  if (!mayPerform) {
    allExcept("notExercised", "the verifier was not permitted to POST to this Worker", ["NDG-1"]);
    return results;
  }

  const nudge = (type: string, intent: string, permanent = false) =>
    transcript.send(url, intent, {
      method: "POST",
      body: JSON.stringify({ type }),
      headers: { "content-type": "application/json" },
      permanent,
    });

  // NDG-3: a Worker that took a nudge for a type it does not answer would be telling an owner it
  // had been told, and the owner would stop nudging whoever could actually help.
  const refused = await nudge(NO_SUCH_TYPE, "a nudge for a Task type no Worker answers", true);
  const code = (refused.json as { code?: string } | null)?.code;
  if (refused.status === 404 && code === "not_found") say("NDG-3", "passes");
  else say("NDG-3", "fails", `answered ${refused.status} with \`${code ?? "no code"}\``);

  // NDG-2: `204` and no body, because there is nothing to say. This is the one call here that the
  // Worker acts on, and a type it declares a Skill for is the only one it may be sent for.
  const answerable = skills[0];
  if (answerable === undefined) {
    say(
      "NDG-2",
      "notExercised",
      "the Worker declares no Skill, so there is no type to nudge it for",
    );
    return results;
  }

  const told = await nudge(answerable, `a nudge for \`${answerable}\`, which it answers`);
  if (told.status !== 204) {
    say("NDG-2", "fails", `answered ${told.status} rather than 204`);
  } else if (told.body.length > 0) {
    say("NDG-2", "fails", "answered 204 with a body");
  } else {
    say("NDG-2", "passes");
  }

  return results;
}

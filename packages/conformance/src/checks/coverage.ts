import { taskPage } from "@worker-protocol/schemas";
import type { Arrangement } from "../index.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Transcript, withParams } from "../transcript.ts";

/**
 * ACT-22 and TASK-44: what a credential may do, and what a Task read with it says it may.
 *
 * Nothing outside can tell which Actions a credential lacks, so both wait for an arrangement
 * naming one — a credential and a declared Action it does not cover — exactly as REG-32 waits for
 * a credential that lacks a right. A Worker that covers everything with one secret has nothing to
 * arrange, and both report that rather than a verdict.
 */
export const CLAIMS = ["ACT-22", "TASK-44"] as const;

export async function checkCoverage(given: {
  /** The `tasks` entry's `raises`, for which Actions each type names (TASK-35). */
  raises: Record<string, { answeredBy?: string[] }>;
  actionsUrl: string | null;
  tasksUrl: string | null;
  mayPerform: boolean;
  arrangement: Arrangement;
  rules: Map<string, Rule>;
  transcript: Transcript;
}): Promise<Result[]> {
  const { raises, actionsUrl, tasksUrl, mayPerform, arrangement, transcript } = given;
  const { results, say } = verdicts(given.rules, CLAIMS);
  const uncovered = arrangement.uncoveredAction;
  if (uncovered === undefined) {
    for (const id of CLAIMS) {
      say(id, "notExercised", "no credential was given with an Action it does not cover");
    }
    return results;
  }
  const headers = { authorization: `Bearer ${uncovered.credential}` };

  // ACT-22: no key and a body that is not JSON, so ENDP-18 and ENDP-4 would each refuse it with
  // `400` were they asked first. A conformant Worker performs nothing with it; one that checks no
  // coverage and never reads the body of an Action without input would, which is why this waits
  // for `mayPerform` like every other POST.
  if (actionsUrl === null) {
    say("ACT-22", "notExercised", "the Worker declares no `actions`");
  } else if (!mayPerform) {
    say("ACT-22", "notExercised", "the verifier was not permitted to POST to this Worker");
  } else {
    const refused = await transcript.send(
      withParams(actionsUrl, { action: uncovered.name }),
      `${uncovered.name}, with a credential that does not cover it`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "not json",
      },
    );
    const code = (refused.json as { code?: unknown } | null)?.code;
    if (refused.status === 403 && code === "forbidden") {
      say("ACT-22", "passes");
    } else {
      say(
        "ACT-22",
        "fails",
        `an Action the credential does not cover answered ${refused.status}${
          typeof code === "string" ? ` + ${code}` : ""
        }, before \`403\` + \`forbidden\``,
      );
    }
  }

  // TASK-44: every Task this credential reads whose type names the Action carries `available`
  // without it. Only the Tasks it reads, because TASK-6 decides those and this rule does not.
  if (tasksUrl === null) {
    say("TASK-44", "notExercised", "the Worker declares no `tasks`");
    return results;
  }
  const named: { id: string; available?: string[] }[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 20; pages += 1) {
    const read = await transcript.send(
      cursor === undefined ? tasksUrl : withParams(tasksUrl, { cursor }),
      `Tasks, with a credential that does not cover ${uncovered.name}`,
      { headers },
    );
    const page = taskPage.safeParse(read.json);
    if (!page.success) break;
    for (const task of page.data.items) {
      if ((raises[task.type]?.answeredBy ?? []).includes(uncovered.name)) named.push(task);
    }
    cursor = page.data.nextCursor;
    if (cursor === undefined) break;
  }
  const offered = named.find((task) => task.available?.includes(uncovered.name) !== false);
  if (named.length === 0) {
    say("TASK-44", "notExercised", `the credential reads no Task that ${uncovered.name} answers`);
  } else if (offered !== undefined) {
    say(
      "TASK-44",
      "fails",
      offered.available === undefined
        ? `Task ${offered.id} carries no \`available\`, which offers ${uncovered.name} too`
        : `Task ${offered.id} offers ${uncovered.name} in \`available\``,
    );
  } else {
    say("TASK-44", "passes");
  }
  return results;
}

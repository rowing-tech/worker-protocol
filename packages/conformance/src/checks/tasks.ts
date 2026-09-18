import { taskPage, tasksEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Result, Rule } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `tasks` Capability, as far as reading reaches.
 *
 * Nothing here claims anything. A claim takes an exclusive lease on work somebody else's operators
 * are waiting to have done — the most consequential thing a caller can do to a Worker through this
 * protocol, and the one a verifier has least business doing uninvited. So the nine rules from
 * TASK-9 onward are `H` and wait for an arrangement, and what is checked here is the declaration
 * and the read.
 */
export const CLAIMS = [
  "TASK-1",
  "TASK-2",
  "TASK-3",
  "TASK-4",
  "TASK-5",
  "TASK-7",
  "TASK-8",
  "NAME-7",
] as const;

type Entry = {
  raises: Record<string, { payload: unknown; answeredBy: string[] }>;
  answers: string[];
};

export async function checkTasks(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  actionNames: string[],
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
): Promise<Result[]> {
  const results: Result[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };
  const allExcept = (verdict: Result["verdict"], why: string, except: string[] = []) => {
    for (const id of CLAIMS) if (!except.includes(id)) say(id, verdict, why);
  };

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `tasks`");
    return results;
  }

  const declared = tasksEntry.safeParse(entry);
  if (!declared.success) {
    const blamed = new Set<string>();
    for (const issue of declared.error.issues) {
      const id = ruleFor(attribution, "tasks-entry", issue.path) ?? "TASK-1";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    allExcept("notExercised", "the `tasks` entry did not validate", [...blamed]);
    return results;
  }

  const { raises, answers } = declared.data as unknown as Entry;
  for (const id of ["TASK-1", "TASK-3"]) say(id, "passes");

  // NAME-7: a name this protocol expects one party to match against a name that came from
  // somewhere else is namespaced. A Task type is the first such name the protocol actually serves,
  // and TASK-4 is that rule applied — so the schema's qualified-name key carries both, and this
  // says so per rule rather than once, because a report naming one of them is the point.
  const crossing = [...Object.keys(raises), ...answers];
  if (crossing.length === 0) {
    say("NAME-7", "notExercised", "the Worker neither raises nor answers a Task type");
    say("TASK-4", "notExercised", "the Worker declares no Task type");
  } else {
    say("NAME-7", "passes");
    say("TASK-4", "passes");
  }

  // TASK-2: the closed list is a list of the OWNER's own Actions. A Task type naming an Action the
  // Worker does not accept is a Descriptor disagreeing with itself, which is DESC-18's fault one
  // level down — and it is the one part of TASK-2 the schema cannot reach, because it is an
  // agreement between two entries rather than a shape inside one.
  const accepted = new Set(actionNames);
  const dangling: string[] = [];
  for (const [type, declaration] of Object.entries(raises)) {
    for (const action of declaration.answeredBy) {
      if (!accepted.has(action)) dangling.push(`${type} names \`${action}\``);
    }
  }
  if (Object.keys(raises).length === 0) {
    say("TASK-2", "notExercised", "the Worker raises no Task type");
  } else if (dangling.length === 0) {
    say("TASK-2", "passes");
  } else {
    say("TASK-2", "fails", `${dangling.join("; ")}, which its \`actions\` entry does not accept`);
  }

  if (url === null) {
    allExcept("notExercised", "the reading address did not resolve", [
      "TASK-1",
      "TASK-2",
      "TASK-3",
      "TASK-4",
      "NAME-7",
    ]);
    return results;
  }

  // TASK-5, TASK-7: the Tasks whose conditions hold, in the page envelope, each carrying what a
  // consumer needs in order to decide whether to try.
  const answer = await transcript.send(url, "the Tasks whose conditions hold");
  if (answer.status !== 200) {
    say("TASK-5", "fails", `the reading address answered ${answer.status}`);
    say("TASK-7", "notExercised", "no page of Tasks was read");
  } else {
    const page = taskPage.safeParse(answer.json);
    if (page.success) {
      say("TASK-5", "passes");
      if (page.data.items.length === 0) {
        say("TASK-7", "notExercised", "no condition is holding, so no Task was read");
      } else {
        say("TASK-7", "passes");
      }
    } else {
      const issue = page.error.issues[0];
      const id = ruleFor(attribution, "task-page", issue?.path ?? []) ?? "TASK-5";
      say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
      say(id === "TASK-5" ? "TASK-7" : "TASK-5", "notExercised", "the page did not validate");
    }
  }

  // TASK-8: a type the entry does not declare. A name no Worker would raise is the only way to ask
  // without a Worker having to cooperate, and reading refuses without claiming anything.
  const probe = new URL(url);
  probe.searchParams.set("type", "tech.rowing.no-such.task-type-4c1f");
  const refused = await transcript.send(
    probe.toString(),
    "a Task type the entry does not declare",
    {
      permanent: true,
    },
  );
  const code = (refused.json as { code?: string } | null)?.code;
  if (refused.status === 400 && code === "invalid_parameter") say("TASK-8", "passes");
  else say("TASK-8", "fails", `answered ${refused.status} with \`${code ?? "no code"}\``);

  return results;
}

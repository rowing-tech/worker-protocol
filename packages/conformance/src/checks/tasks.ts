import { taskPage, tasksEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import type { Transcript } from "../transcript.ts";
import { judgeInputs } from "./inputs.ts";

/**
 * The `tasks` Capability, which is now reading and nothing else.
 *
 * Every check here is a GET, so none of them needs the operators' permission and none leaves the
 * Worker changed. That was not true while a Claim existed: taking one was the most consequential
 * thing a caller could do through this protocol, and half of this file was the sequence that took
 * one carefully and gave it back. The lease is withdrawn and the sequence with it.
 */
export const CLAIMS = [
  "TASK-27",
  "TASK-35",
  "TASK-4",
  "TASK-5",
  "TASK-8",
  "TASK-28",
  "TASK-37",
  "TASK-38",
  "NAME-7",
] as const;

type Entry = {
  raises: Record<string, { payload: unknown; answeredBy?: string[] }>;
};

export async function checkTasks(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  /** TASK-36, read off the Descriptor ROOT. Its names are Task types, so NAME-7 and TASK-4 reach
   * them — and reach them even for a Worker that declares a Skill and no `tasks` entry. */
  skills: string[],
  /** The `actions` entry's own map, because TASK-35 names Actions that entry must accept. */
  accepts: Record<string, { input?: unknown }>,
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
): Promise<{ results: Result[]; addresses: string[] }> {
  const { results, say, allExcept } = verdicts(rules, CLAIMS);
  const addresses: string[] = [];

  // NAME-7 and TASK-4 are about the NAMES, wherever they were declared. A Worker that only answers
  // Tasks has them under `skills` alone, and judging them only through a `tasks` entry would have
  // reported nothing about the one Worker the root declaration exists for.
  const crossing = (raised: number) => {
    if (raised + skills.length === 0) {
      say("NAME-7", "notExercised", "the Worker neither raises nor answers a Task type");
      say("TASK-4", "notExercised", "the Worker declares no Task type");
    } else {
      say("NAME-7", "passes");
      say("TASK-4", "passes");
    }
  };

  if (entry === undefined) {
    crossing(0);
    allExcept("notExercised", "the Worker declares no `tasks`", ["NAME-7", "TASK-4"]);
    return { results, addresses };
  }

  const declared = tasksEntry.safeParse(entry);
  if (!declared.success) {
    const blamed = new Set<string>();
    for (const issue of declared.error.issues) {
      const id = ruleFor(attribution, "tasks-entry", issue.path) ?? "TASK-27";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    allExcept("notExercised", "the `tasks` entry did not validate", [...blamed]);
    return { results, addresses };
  }

  const { raises } = declared.data as unknown as Entry;
  say("TASK-27", "passes");

  // NAME-7: a name this protocol expects one party to match against a name that came from
  // somewhere else is namespaced. A Task type is the first such name the protocol actually serves,
  // and TASK-4 is that rule applied — so the schema's qualified-name key carries both, and this
  // says so per rule rather than once, because a report naming one of them is the point.
  crossing(Object.keys(raises).length);

  // TASK-35 is not a shape inside one entry, which is why the schema cannot reach it: answering a
  // Task is performing one of the OWNER's own Actions, so a Task type naming an Action the Worker
  // does not accept is a Descriptor disagreeing with itself. What it no longer asks is anything of
  // those Actions' inputs: edition 0.4 required a discriminator because one Action carried
  // every ending, and with several the name already says which answer is which.
  const dangling: string[] = [];
  for (const [type, declaration] of Object.entries(raises)) {
    // A type no Action answers is work done elsewhere, whose condition clears on a Fact the Worker
    // observes. There is no name to check.
    for (const name of declaration.answeredBy ?? []) {
      if (accepts[name] === undefined) {
        dangling.push(`${type} names \`${name}\`, which its \`actions\` entry does not accept`);
      }
    }
  }

  if (Object.keys(raises).length === 0) {
    say("TASK-35", "notExercised", "the Worker raises no Task type");
  } else if (dangling.length === 0) {
    say("TASK-35", "passes");
  } else {
    say("TASK-35", "fails", dangling.join("; "));
  }

  /**
   * TASK-37 and TASK-38, judged on the Tasks a read answered: what each fills in, and what it says
   * applies now, both against the Actions TASK-35 names for its type. A Task that carries neither
   * exercises neither, and a page where none does is `not exercised` rather than a pass.
   */
  const judgeOffers = (
    items: {
      id: string;
      type: string;
      inputs?: Record<string, Record<string, unknown>>;
      available?: string[];
    }[],
  ) => {
    const filled: string[] = [];
    const applying: string[] = [];
    for (const task of items) {
      const named = raises[task.type]?.answeredBy ?? [];
      if (task.inputs !== undefined) {
        filled.push(
          ...judgeInputs({
            owner: `task ${task.id}`,
            inputs: task.inputs,
            offered: named,
            accepts,
          }),
        );
      }
      for (const name of task.available ?? []) {
        if (!named.includes(name)) {
          applying.push(`task ${task.id} says \`${name}\` applies, which its type does not name`);
        }
      }
    }
    const verdict = (id: string, carried: boolean, faults: string[], member: string) => {
      if (!carried) say(id, "notExercised", `no Task read carries \`${member}\``);
      else if (faults.length === 0) say(id, "passes");
      else say(id, "fails", faults.join("; "));
    };
    verdict(
      "TASK-37",
      items.some((task) => task.inputs !== undefined),
      filled,
      "inputs",
    );
    verdict(
      "TASK-38",
      items.some((task) => task.available !== undefined),
      applying,
      "available",
    );
  };

  if (url === null) {
    allExcept("notExercised", "the reading address did not resolve", [
      "TASK-27",
      "TASK-35",
      "TASK-4",
      "NAME-7",
    ]);
    return { results, addresses };
  }

  // TASK-5, TASK-28: the Tasks whose conditions hold, in the page envelope, each carrying what a
  // consumer needs in order to decide whether to try.
  const answer = await transcript.send(url, "the Tasks whose conditions hold");
  if (answer.status !== 200) {
    say("TASK-5", "fails", `the reading address answered ${answer.status}`);
    for (const id of ["TASK-28", "TASK-37", "TASK-38"]) {
      say(id, "notExercised", "no page of Tasks was read");
    }
  } else {
    const page = taskPage.safeParse(answer.json);
    if (page.success) {
      say("TASK-5", "passes");
      if (page.data.items.length === 0) {
        for (const id of ["TASK-28", "TASK-37", "TASK-38"]) {
          say(id, "notExercised", "no condition is holding, so no Task was read");
        }
      } else {
        say("TASK-28", "passes");
        judgeOffers(page.data.items);
      }
    } else {
      const issue = page.error.issues[0];
      const id = ruleFor(attribution, "task-page", issue?.path ?? []) ?? "TASK-5";
      say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
      for (const other of ["TASK-5", "TASK-28", "TASK-37", "TASK-38"]) {
        if (other !== id) say(other, "notExercised", "the page did not validate");
      }
    }
  }

  // TASK-8: a type the entry does not declare. A name no Worker would raise is the only way to ask
  // without a Worker having to cooperate, and a read refuses without changing anything.
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

  return { results, addresses };
}

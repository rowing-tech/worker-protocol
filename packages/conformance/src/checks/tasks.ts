import { taskPage, tasksEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Transcript, withParams } from "../transcript.ts";
import { taskPages } from "./answers.ts";
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
  "TASK-45",
  "TASK-46",
  "TASK-47",
  "TASK-48",
  "TASK-49",
  "TASK-50",
  "NAME-7",
] as const;

/**
 * TASK-46: the parameters this protocol defines on a read of Tasks, which a dimension may not be
 * named after. `dimensions` is here for MET-5's reason: it is the name `openapi/` gives the
 * parameter that carries every dimension, and a dimension that took it would be unreachable there.
 */
const OWN_PARAMETERS = ["type", "cursor", "dimensions"];

/** TASK-49: a value no Worker would mint, so that what answers it is the empty page. */
const UNCARRIED = "no-such-value-4c1f";

/** The rules judged on the first page of Tasks, which a read answering none leaves unexercised. */
const PAGE_RULES = ["TASK-28", "TASK-37", "TASK-38", "TASK-47", "TASK-48"];

type Entry = {
  raises: Record<string, { payload: unknown; answeredBy?: string[] }>;
};

type Read = ReturnType<typeof taskPage.parse>["items"][number];

/** What a read answered where it was not a page, for a report. */
const answeredAs = (status: number, code: string | undefined) =>
  `${status} with \`${code ?? "no code"}\``;

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
  const dimensionNames = Object.keys(declared.data.dimensions ?? {});
  say("TASK-27", "passes");

  // TASK-45: the shape is the schema's, and it validated. A Worker that declares none exercises it
  // no more than a metric with no dimension exercises MET-4's second half.
  if (dimensionNames.length === 0) {
    for (const id of ["TASK-45", "TASK-46", "TASK-49", "TASK-50"]) {
      say(id, "notExercised", "the entry declares no dimension");
    }
  } else {
    say("TASK-45", "passes");
    // TASK-46: a dimension named after a parameter this read defines is unreachable — the Worker
    // could never tell the filter from the parameter.
    const collisions = dimensionNames.filter((name) => OWN_PARAMETERS.includes(name));
    if (collisions.length > 0) {
      say("TASK-46", "fails", `${collisions.join(", ")}: named after a parameter of the read`);
    } else {
      say("TASK-46", "passes");
    }
  }

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

  /** A rule judged on a member some Tasks carry: unexercised where none read carries it. */
  const verdict = (id: string, carried: boolean, faults: string[], member: string) => {
    if (!carried) say(id, "notExercised", `no Task read carries \`${member}\``);
    else if (faults.length === 0) say(id, "passes");
    else say(id, "fails", faults.join("; "));
  };

  /**
   * TASK-37 and TASK-38, judged on the Tasks a read answered: what each fills in, and what it says
   * applies now, both against the Actions TASK-35 names for its type. A Task that carries neither
   * exercises neither, and a page where none does is `not exercised` rather than a pass.
   */
  const judgeOffers = (items: Read[]) => {
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

  /**
   * TASK-47, judged on the Tasks a read answered: every name a Task carries is one the entry
   * declares. One string each is the schema's, and the page already validated against it.
   */
  const judgeCarried = (items: Read[]) => {
    const stray: string[] = [];
    for (const task of items) {
      for (const name of Object.keys(task.dimensions ?? {})) {
        if (!dimensionNames.includes(name)) {
          stray.push(`task ${task.id} carries \`${name}\`, which the entry does not declare`);
        }
      }
    }
    verdict(
      "TASK-47",
      items.some((task) => task.dimensions !== undefined),
      stray,
      "dimensions",
    );
  };

  if (url === null) {
    allExcept("notExercised", "the reading address did not resolve", [
      "TASK-27",
      "TASK-35",
      "TASK-4",
      "NAME-7",
      "TASK-45",
      "TASK-46",
    ]);
    return { results, addresses };
  }

  /** One read with these parameters: the page it answered, or what it answered instead. */
  const read = async (asked: {
    parameters: Record<string, string | string[]>;
    intent: string;
    /** The request is wrong by construction, so a `5xx` to it is ENDP-11's. */
    permanent?: boolean;
  }): Promise<{ status: number; items?: Read[]; code?: string }> => {
    const { parameters, intent, permanent = false } = asked;
    const answered = await transcript.send(withParams(url, parameters), intent, { permanent });
    const code = (answered.json as { code?: string } | null)?.code;
    if (answered.status !== 200) return { status: answered.status, code };
    const page = taskPage.safeParse(answered.json);
    return page.success ? { status: 200, items: page.data.items } : { status: answered.status };
  };

  /**
   * TASK-48: fix the value one Task read carries, and see that every Task answered carries it, and
   * that the Task itself is among them — followed through pages, because the order is the
   * Worker's and the Task need not be on the first. Then the same with its type fixed too, so that
   * the two filters are seen to hold at once.
   */
  const judgeFixing = async (items: Read[]) => {
    const [fixing] = items.flatMap((carrier) =>
      Object.entries(carrier.dimensions ?? {})
        .filter(([name]) => dimensionNames.includes(name))
        .map(([name, value]) => ({ carrier, name, value })),
    );
    if (fixing === undefined) {
      say("TASK-48", "notExercised", "no Task read carries a declared dimension");
      return;
    }
    const { carrier, name, value } = fixing;
    const faults: string[] = [];
    const walk = async (parameters: Record<string, string>) => {
      const fits = (task: Read) =>
        Object.entries(parameters).every(
          ([key, wanted]) => (key === "type" ? task.type : task.dimensions?.[key]) === wanted,
        );
      const walked = await taskPages(transcript, {
        url: withParams(url, parameters),
        intent: `Tasks whose ${name} is ${value}`,
      });
      if (walked.refused !== undefined) {
        const { status, code } = walked.refused;
        faults.push(`fixing ${name} answered ${answeredAs(status, code)}`);
        return;
      }
      for (const task of walked.items.filter((one) => !fits(one))) {
        faults.push(`fixing ${name}=${value} answered task ${task.id}, which does not match`);
      }
      // Missing only where the walk reached the end: past the bound, the Task may be further on.
      if (walked.ended && !walked.items.some((task) => task.id === carrier.id)) {
        faults.push(`fixing ${name}=${value} did not answer task ${carrier.id}`);
      }
    };
    await walk({ [name]: value });
    await walk({ type: carrier.type, [name]: value });
    if (faults.length === 0) say("TASK-48", "passes");
    else say("TASK-48", "fails", faults.join("; "));
  };

  // TASK-5, TASK-28: the Tasks whose conditions hold, in the page envelope, each carrying what a
  // consumer needs in order to decide whether to try.
  const answer = await transcript.send(url, "the Tasks whose conditions hold");
  if (answer.status !== 200) {
    say("TASK-5", "fails", `the reading address answered ${answer.status}`);
    for (const id of PAGE_RULES) say(id, "notExercised", "no page of Tasks was read");
  } else {
    const page = taskPage.safeParse(answer.json);
    if (page.success) {
      say("TASK-5", "passes");
      if (page.data.items.length === 0) {
        for (const id of PAGE_RULES) {
          say(id, "notExercised", "no condition is holding, so no Task was read");
        }
      } else {
        say("TASK-28", "passes");
        judgeOffers(page.data.items);
        judgeCarried(page.data.items);
        await judgeFixing(page.data.items);
      }
    } else {
      const issue = page.error.issues[0];
      const id = ruleFor(attribution, "task-page", issue?.path ?? []) ?? "TASK-5";
      say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
      for (const other of ["TASK-5", ...PAGE_RULES]) {
        if (other !== id) say(other, "notExercised", "the page did not validate");
      }
    }
  }

  // TASK-8: a type the entry does not declare. A name no Worker would raise is the only way to ask
  // without a Worker having to cooperate, and a read refuses without changing anything.
  const refused = await read({
    parameters: { type: "tech.rowing.no-such.task-type-4c1f" },
    intent: "a Task type the entry does not declare",
    permanent: true,
  });
  if (refused.status === 400 && refused.code === "invalid_parameter") say("TASK-8", "passes");
  else say("TASK-8", "fails", `answered ${answeredAs(refused.status, refused.code)}`);

  const [first] = dimensionNames;
  if (first !== undefined) {
    // TASK-49: a value nothing carries is an empty page, never a refusal — the Worker cannot tell
    // a typo from a value about to exist.
    const unseen = await read({
      parameters: { [first]: UNCARRIED },
      intent: `Tasks whose ${first} nothing carries`,
    });
    if (unseen.items === undefined) {
      const said = answeredAs(unseen.status, unseen.code);
      say("TASK-49", "fails", `a value nothing carries answered ${said}`);
    } else if (unseen.items.length > 0) {
      say("TASK-49", "fails", `a value nothing carries answered ${unseen.items.length} Tasks`);
    } else {
      say("TASK-49", "passes");
    }

    // TASK-50: one dimension fixed twice is refused, because every other answer ignores one
    // value or invents a multiplicity convention.
    const twice = await read({
      parameters: { [first]: [UNCARRIED, `${UNCARRIED}-2`] },
      intent: `Tasks with ${first} fixed twice`,
      permanent: true,
    });
    if (twice.status === 400 && twice.code === "invalid_parameter") say("TASK-50", "passes");
    else say("TASK-50", "fails", `answered ${answeredAs(twice.status, twice.code)}`);
  }

  return { results, addresses };
}

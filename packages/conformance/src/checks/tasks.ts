import { taskPage, tasksEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import type { Transcript } from "../transcript.ts";

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
  "TASK-32",
  "TASK-4",
  "TASK-5",
  "TASK-8",
  "TASK-28",
  "NAME-7",
] as const;

type Entry = {
  raises: Record<string, { payload: unknown; answeredBy: string }>;
};

/** A declared input, read only for the members TASK-32's second half is about. */
type Declared = {
  const?: unknown;
  properties?: Record<string, Declared>;
  anyOf?: Declared[];
  oneOf?: Declared[];
};

/**
 * Whether a union's variants are told apart by a discriminator — TASK-32's second obligation.
 *
 * A member that every variant fixes to a constant of its own, which is what a discriminated union
 * writes and what an answerer needs in order to say which ending it is producing. Without one a
 * consumer reading the schema cannot name the ending it can reach, and the mapping TASK-32 exists
 * to dissolve comes back as a conversation between two parties.
 *
 * The same walk `packages/client`'s `skills.ts` does when it decides whether one Worker can answer
 * another's Tasks. It is six lines and it is written twice rather than imported, because a verifier
 * depending on a consumer library would make the tool's verdicts turn on a package it is supposed
 * to be able to judge.
 */
function told(variants: Declared[]): boolean {
  const first = variants[0];
  if (first === undefined) return false;
  return Object.keys(first.properties ?? {}).some((member) => {
    const fixed = variants.map((one) => one.properties?.[member]?.const);
    return fixed.every((one) => one !== undefined) && new Set(fixed).size === variants.length;
  });
}

export async function checkTasks(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  /** TASK-31, read off the Descriptor ROOT. Its names are Task types, so NAME-7 and TASK-4 reach
   * them — and reach them even for a Worker that declares a Skill and no `tasks` entry. */
  skills: string[],
  /** The `actions` entry's own map, because TASK-32 is about the Action's name AND its input. */
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

  // TASK-32 has two obligations and neither is a shape inside one entry, which is why the schema
  // reaches neither and both are here.
  //
  // The first is the name: answering a Task is performing one of the OWNER's own Actions, so a
  // Task type naming an Action the Worker does not accept is a Descriptor disagreeing with itself.
  //
  // The second is the input of the Action it names. Where a Task can end more than one way the
  // endings are variants of that input, told apart by a discriminator — and without one, a
  // consumer holding a schema it can satisfy cannot say WHICH ending it is reporting, so the
  // mapping this rule dissolved comes back as something two parties have to agree out of band.
  // Unions of one are not judged: an input that is not a union is a Task that ends one way.
  const dangling: string[] = [];
  const untold: string[] = [];
  for (const [type, declaration] of Object.entries(raises)) {
    const declared = accepts[declaration.answeredBy];
    if (declared === undefined) {
      dangling.push(
        `${type} names \`${declaration.answeredBy}\`, which its \`actions\` entry does not accept`,
      );
      continue;
    }
    const input = declared.input as Declared | undefined;
    const variants = input?.anyOf ?? input?.oneOf;
    if (variants !== undefined && variants.length > 1 && !told(variants)) {
      untold.push(
        `${type} is answered by \`${declaration.answeredBy}\`, whose input is a union of ${variants.length} with no member fixed to a different constant in each`,
      );
    }
  }

  const faults = [...dangling, ...untold];
  if (Object.keys(raises).length === 0) {
    say("TASK-32", "notExercised", "the Worker raises no Task type");
  } else if (faults.length === 0) {
    say("TASK-32", "passes");
  } else {
    say("TASK-32", "fails", faults.join("; "));
  }

  if (url === null) {
    allExcept("notExercised", "the reading address did not resolve", [
      "TASK-27",
      "TASK-32",
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
    say("TASK-28", "notExercised", "no page of Tasks was read");
  } else {
    const page = taskPage.safeParse(answer.json);
    if (page.success) {
      say("TASK-5", "passes");
      if (page.data.items.length === 0) {
        say("TASK-28", "notExercised", "no condition is holding, so no Task was read");
      } else {
        say("TASK-28", "passes");
      }
    } else {
      const issue = page.error.issues[0];
      const id = ruleFor(attribution, "task-page", issue?.path ?? []) ?? "TASK-5";
      say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
      say(id === "TASK-5" ? "TASK-28" : "TASK-5", "notExercised", "the page did not validate");
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

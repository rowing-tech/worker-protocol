import { claim as claimSchema, taskPage, tasksEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Arrangement } from "../index.ts";
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
  // Only against a Worker whose operators said a Task may be claimed. Every Claim taken here is
  // released again, so the Worker is left as it was found.
  "TASK-9",
  "TASK-10",
  "TASK-11",
  "TASK-12",
  "TASK-13",
  "TASK-14",
  "TASK-16",
  "TASK-17",
] as const;

type Entry = {
  raises: Record<string, { payload: unknown; answeredBy: string[] }>;
  answers: string[];
};

export async function checkTasks(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  descriptorUrl: string | null,
  actionNames: string[],
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
  arrangement: Arrangement,
  mayPerform: boolean,
): Promise<{ results: Result[]; addresses: string[] }> {
  const results: Result[] = [];
  const addresses: string[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };
  const allExcept = (verdict: Result["verdict"], why: string, except: string[] = []) => {
    for (const id of CLAIMS) if (!except.includes(id)) say(id, verdict, why);
  };

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `tasks`");
    return { results, addresses };
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
    return { results, addresses };
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
    return { results, addresses };
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

  const claimUrl =
    descriptorUrl === null ||
    typeof (declared.data as { claimAddress?: unknown }).claimAddress !== "string"
      ? null
      : new URL(
          (declared.data as unknown as { claimAddress: string }).claimAddress,
          descriptorUrl,
        ).toString();

  // ENDP-1: the claim address is declared, inside the entry rather than beside it. A Capability
  // knows where its own addresses live, which is why it hands them back rather than being guessed
  // at — `configure`'s reading address was the first of these and this is the second.
  if (claimUrl !== null) addresses.push(claimUrl);

  await checkClaiming(claimUrl, arrangement, mayPerform, transcript, say);

  return { results, addresses };
}

const CLAIMING = [
  "TASK-9",
  "TASK-10",
  "TASK-11",
  "TASK-12",
  "TASK-13",
  "TASK-14",
  "TASK-16",
  "TASK-17",
];

/**
 * What only a Worker whose operators said so can show.
 *
 * The sequence is chosen so that the Worker is left exactly as it was found: claim, look, claim
 * again and be refused, renew, answer, release, and try the released Claim once more. Nothing is
 * held at the end of it and no Task has been taken out of anyone's reach for longer than the run.
 */
async function checkClaiming(
  url: string | null,
  arrangement: Arrangement,
  mayPerform: boolean,
  transcript: Transcript,
  say: (id: string, verdict: Result["verdict"], detail?: string) => void,
): Promise<void> {
  if (arrangement.mayClaim !== true) {
    for (const id of CLAIMING) {
      say(id, "notExercised", "the verifier was not permitted to claim a Task");
    }
    return;
  }
  if (url === null) {
    for (const id of CLAIMING) say(id, "notExercised", "the claim address did not resolve");
    return;
  }

  const post = (parameters: string, intent: string, permanent = false) =>
    transcript.send(`${url}${parameters}`, intent, { method: "POST", permanent });
  const code = (answer: { json: unknown }) => (answer.json as { code?: string } | null)?.code;

  const claimable = arrangement.claimableTask;
  if (claimable === undefined) {
    for (const id of CLAIMING) {
      say(id, "notExercised", "no Task was named as one that may be claimed");
    }
    return;
  }

  // TASK-9, TASK-12: the Claim, with the instant the owner's lease expires.
  const first = await post(`?task=${encodeURIComponent(claimable)}`, "a claim on a Task");
  const held = claimSchema.safeParse(first.json);
  if (first.status !== 200 || !held.success) {
    say(
      "TASK-9",
      "fails",
      `claiming answered ${first.status} with \`${code(first) ?? "no code"}\``,
    );
    for (const id of CLAIMING) {
      if (id !== "TASK-9") say(id, "notExercised", "no Claim was granted");
    }
    return;
  }
  say("TASK-9", "passes");
  say(
    "TASK-12",
    held.data.task === claimable ? "passes" : "fails",
    held.data.task === claimable ? undefined : "the Claim names another Task",
  );

  // TASK-10: claiming is exclusive, and a second claim of a held Task is refused.
  const second = await post(
    `?task=${encodeURIComponent(claimable)}`,
    "a second claim of a held Task",
    true,
  );
  if (second.status === 409 && code(second) === "conflict") say("TASK-10", "passes");
  else say("TASK-10", "fails", `answered ${second.status} with \`${code(second) ?? "no code"}\``);

  // TASK-13: the holder renews, and the owner answers a new expiry.
  const renewed = await post(`?claim=${encodeURIComponent(held.data.id)}`, "a renewal");
  const again = claimSchema.safeParse(renewed.json);
  if (renewed.status === 200 && again.success) say("TASK-13", "passes");
  else say("TASK-13", "fails", `renewing answered ${renewed.status}`);

  // TASK-16: a Response is two calls and they are not atomic — the Action into the owner, then
  // the outcome on the Claim. What a check can establish is that the owner accepts them that way.
  const safe = arrangement.safeAction;
  if (!mayPerform || safe === undefined) {
    say("TASK-16", "notExercised", "no Action was named as safe to perform");
  } else {
    say("TASK-16", "passes");
  }

  // TASK-14: the holder closes its Claim. `released` is the outcome that gives the Task back.
  const closed = await post(
    `?claim=${encodeURIComponent(held.data.id)}&outcome=released`,
    "releasing the Claim",
  );
  if (closed.status >= 200 && closed.status < 300) say("TASK-14", "passes");
  else say("TASK-14", "fails", `closing answered ${closed.status}`);

  // TASK-17: the Claim id is the fencing token. A call naming one that is no longer the Task's
  // current one is refused — which is a released Claim, a lapsed lease and a reclaimed Task all
  // answered by one precondition at write time.
  const stale = await post(
    `?claim=${encodeURIComponent(held.data.id)}&outcome=done`,
    "an outcome on a Claim that was released",
    true,
  );
  if (stale.status === 409 && code(stale) === "conflict") say("TASK-17", "passes");
  else say("TASK-17", "fails", `answered ${stale.status} with \`${code(stale) ?? "no code"}\``);

  // TASK-11: a Task the owner will not currently grant a lease on. TASK-7 puts `claimable` on the
  // Task itself precisely so a consumer reads it rather than inferring it from a pattern of 409s,
  // and that is what makes this checkable with no arrangement of its own.
  const unclaimable = arrangement.unclaimableTask;
  if (unclaimable === undefined) {
    say("TASK-11", "notExercised", "no Task was named as one the Worker will not grant a lease on");
  } else {
    const refusedClaim = await post(
      `?task=${encodeURIComponent(unclaimable)}`,
      "a claim on a Task the owner is not granting leases on",
      true,
    );
    if (refusedClaim.status === 409 && code(refusedClaim) === "conflict") say("TASK-11", "passes");
    else {
      say(
        "TASK-11",
        "fails",
        `answered ${refusedClaim.status} with \`${code(refusedClaim) ?? "no code"}\``,
      );
    }
  }
}

import { claim as claimSchema, taskPage, tasksEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Arrangement } from "../index.ts";
import type { Result, Rule } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `tasks` Capability, as far as reading reaches.
 *
 * Nothing here claims anything without being told it may. A claim takes an exclusive lease on work
 * somebody else's operators are waiting to have done — the most consequential thing a caller can do
 * to a Worker through this protocol, and the one a verifier has least business doing uninvited. So
 * the declaration and the read are checked unconditionally, and everything from TASK-9 onward waits
 * for `mayClaim` and a Task named as one that may be taken. `checkClaiming` below is that half, and
 * it releases every Claim it takes that an Action has not already answered.
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
  // closed again, so the Worker is left holding nothing it did not hold before.
  "TASK-9",
  "TASK-10",
  "TASK-11",
  "TASK-12",
  "TASK-13",
  "TASK-14",
  "TASK-16",
  "TASK-17",
  "TASK-21",
  "TASK-22",
  "TASK-23",
  "TASK-24",
  "TASK-25",
  "TASK-26",
] as const;

type Entry = {
  raises: Record<string, { payload: unknown; answeredBy: string[] }>;
  answers: string[];
  claimByType?: boolean;
};

/** One Task as `task-page.json` types it — read off the schema rather than restated here. */
type Task = ReturnType<typeof taskPage.parse>["items"][number];

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
  credential: string | undefined,
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

  const { raises, answers, claimByType } = declared.data as unknown as Entry;
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

  await checkClaiming(
    {
      claimUrl,
      readUrl: url,
      claimByType: claimByType === true,
      hasCredential: credential !== undefined,
    },
    arrangement,
    mayPerform,
    transcript,
    say,
  );

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
  "TASK-21",
  "TASK-22",
  "TASK-23",
  "TASK-24",
  "TASK-25",
  "TASK-26",
];

/**
 * One Task by id, paging through the reading address until it is found or the collection ends.
 *
 * `null` is the collection ending without it — which, for a Task that was there a moment ago, is
 * the Task closing by condition. `"unreadable"` is a page that did not answer or did not validate,
 * and it is kept apart because the two are opposite facts about a Worker.
 */
async function findTask(
  url: string,
  id: string,
  intent: string,
  transcript: Transcript,
  headers: HeadersInit = {},
): Promise<Task | null | "unreadable"> {
  let cursor: string | undefined;
  for (let pages = 0; pages < 64; pages++) {
    const target = new URL(url);
    if (cursor !== undefined) target.searchParams.set("cursor", cursor);
    const answer = await transcript.send(target.toString(), intent, { headers });
    const page = taskPage.safeParse(answer.json);
    if (answer.status !== 200 || !page.success) return "unreadable";
    const found = page.data.items.find((task) => task.id === id);
    if (found !== undefined) return found;
    if (page.data.nextCursor === undefined) return null;
    cursor = page.data.nextCursor;
  }
  return "unreadable";
}

/**
 * What only a Worker whose operators said so can show.
 *
 * The sequence is chosen so that the Worker is left holding no Claim of this tool's: claim, read
 * the held Task back with each credential, claim again and be refused, renew twice, answer under
 * the Claim, close it, try the closed Claim once more on both addresses, and claim once by type and
 * release it. What the answering Action does to the Worker's Facts is the arrangement's — a Task it
 * resolves is a Task the operators offered to have resolved.
 */
async function checkClaiming(
  surface: {
    claimUrl: string | null;
    readUrl: string;
    claimByType: boolean;
    hasCredential: boolean;
  },
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
  const url = surface.claimUrl;
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
  // TASK-9: the Claim, carrying its id, the Task it holds and the instant its lease expires. The
  // Task it holds is this rule's clause, and judging it here is what leaves TASK-12 with its own.
  if (held.data.task === claimable) say("TASK-9", "passes");
  else say("TASK-9", "fails", `the Claim names \`${held.data.task}\` and not the Task claimed`);

  // TASK-12: the owner sets the lease, and its expiry travels as an RFC 3339 instant carrying an
  // offset. That format is what `claim.json` asserts and what parsing it above established — the
  // duration is deliberately not fixed by this protocol, so there is nothing else here to judge.
  say("TASK-12", "passes", "the expiry is an RFC 3339 instant with an offset");

  // The held Task, read back: what TASK-26 judges, and where the type a claim by type names is
  // read from. Read now, while the Claim is held and before an Action can close the Task.
  const seen = await findTask(surface.readUrl, claimable, "the held Task, read back", transcript);

  // TASK-26: a Task under a Claim names who holds it to the credential recorded at enrollment —
  // which is the one this verifier was given — and to no other. Both halves have to be seen: an
  // owner that answered `holder` to everyone would pass the first and fail the rule.
  const consumer = arrangement.consumerCredential;
  if (!surface.hasCredential) {
    say(
      "TASK-26",
      "notExercised",
      "no credential was given to the verifier, so none is the recorded one",
    );
  } else if (seen === "unreadable" || seen === null) {
    say("TASK-26", "notExercised", "the held Task could not be read back");
  } else if (seen.holder === undefined) {
    say("TASK-26", "fails", "the recorded credential read the held Task without `holder`");
  } else if (consumer === undefined) {
    say(
      "TASK-26",
      "notExercised",
      "no Contract credential was given, so nothing could be compared",
    );
  } else {
    const other = await findTask(
      surface.readUrl,
      claimable,
      "the held Task, Contract credential",
      transcript,
      { authorization: `Bearer ${consumer}` },
    );
    if (other === "unreadable") {
      say("TASK-26", "notExercised", "the Contract credential could not read the Tasks");
    } else if (other === null) {
      say("TASK-26", "passes", "the Contract credential does not see the held Task at all");
    } else if (other.holder !== undefined) {
      say("TASK-26", "fails", "a Contract credential read `holder` off the held Task");
    } else {
      say("TASK-26", "passes");
    }
  }

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

  // TASK-25: a renewal may propose a duration, and the owner answers an expiry rather than
  // refusing the parameter. What it grants is its own, so nothing about the expiry is judged.
  const proposed = await post(
    `?claim=${encodeURIComponent(held.data.id)}&lease=120`,
    "a renewal proposing a lease duration",
  );
  if (proposed.status === 200 && claimSchema.safeParse(proposed.json).success) {
    say("TASK-25", "passes");
  } else {
    say(
      "TASK-25",
      "fails",
      `a renewal proposing a duration answered ${proposed.status} with \`${code(proposed) ?? "no code"}\``,
    );
  }

  // TASK-16: a Response is two calls, the Action into the owner and THEN the outcome on the Claim,
  // and they are not atomic. The witness is the owner accepting them as two — so the check sends
  // two, in that order, and passes on what came back rather than on having been arranged. TASK-20
  // is what this tool does as the holder: the Action names the Claim in its header.
  //
  // It was once written to pass on the arrangement existing, with no request sent at all. That is
  // the fault `conformance/README.md` names by name: a check that only knows how to say yes.
  const safe = arrangement.safeAction;
  const actionUrl =
    safe === undefined || arrangement.actionsUrl === undefined
      ? null
      : `${arrangement.actionsUrl}?action=${encodeURIComponent(safe.name)}`;
  const answerUnder = (claim: string, intent: string, permanent = false) =>
    actionUrl === null || safe === undefined
      ? null
      : transcript
          .send(actionUrl, intent, {
            method: "POST",
            body: JSON.stringify(safe.input),
            headers: {
              "worker-protocol-claim": claim,
              // ENDP-18: the Action may require an idempotency key. One is sent whether or not it
              // does — a Worker that takes none ignores it, and asking first would cost a request.
              "idempotency-key": `conformance-response-${Date.now()}-${Math.random()}`,
            },
            permanent,
          })
          .then((exchange) => exchange);

  let responded = false;
  if (mayPerform && actionUrl !== null && safe !== undefined) {
    const performed = await answerUnder(
      held.data.id,
      `the Action \`${safe.name}\`, answering the Task`,
    );
    if (performed !== null && performed.status >= 400) {
      say("TASK-16", "fails", `the Action answered ${performed.status}, so no outcome followed it`);
    } else {
      responded = true;
    }
  } else {
    say("TASK-16", "notExercised", "no Action was named as safe to perform against this Worker");
  }

  // Whether the Action closed the Task — TASK-15 working — which is what TASK-22 needs to see.
  const afterwards = responded
    ? await findTask(surface.readUrl, claimable, "the Task, after the Action", transcript)
    : "unreadable";
  const closedByAction = responded && afterwards === null;

  // TASK-14: the holder closes its Claim. Where an Action was performed the outcome is `done` and
  // it is the second half of the Response; otherwise `released`, which gives the Task straight
  // back and is the outcome that leaves the Worker as it was found.
  const outcome = responded ? "done" : "released";
  const closed = await post(
    `?claim=${encodeURIComponent(held.data.id)}&outcome=${outcome}`,
    responded ? "the outcome on the Claim, after the Action" : "releasing the Claim",
  );
  const accepted = closed.status >= 200 && closed.status < 300;
  if (accepted) say("TASK-14", "passes");
  else say("TASK-14", "fails", `closing answered ${closed.status}`);

  if (responded) {
    if (accepted)
      say("TASK-16", "passes", "the owner took the Action and the outcome as two calls");
    else say("TASK-16", "fails", `the Action was taken and the outcome answered ${closed.status}`);
  }

  // TASK-22: the Task closed by condition the moment the Action landed, and the Claim stayed its
  // current one — so the outcome was accepted where a literal reading of TASK-17 would have
  // answered `409` at the ordinary end of every Response.
  if (!responded) {
    say("TASK-22", "notExercised", "no Action was performed, so nothing could close the Task");
  } else if (afterwards === "unreadable") {
    say("TASK-22", "notExercised", "the Tasks could not be read after the Action");
  } else if (!closedByAction) {
    say(
      "TASK-22",
      "notExercised",
      "the Action did not close the Task, so its Claim was never on a closed one",
    );
  } else if (accepted) {
    say("TASK-22", "passes", "the outcome was accepted on a Claim whose Task had closed");
  } else {
    say(
      "TASK-22",
      "fails",
      `the Task had closed and the outcome on its Claim answered ${closed.status}`,
    );
  }

  // TASK-17: the Claim id is the fencing token. A call naming one that is no longer the Task's
  // current one is refused — which is a released Claim, a lapsed lease and a reclaimed Task all
  // answered by one precondition at write time.
  const stale = await post(
    `?claim=${encodeURIComponent(held.data.id)}&outcome=done`,
    "an outcome on a Claim that was closed",
    true,
  );
  if (stale.status === 409 && code(stale) === "conflict") say("TASK-17", "passes");
  else say("TASK-17", "fails", `answered ${stale.status} with \`${code(stale) ?? "no code"}\``);

  // TASK-21: the same token on the other address. An Action performed under a Claim that is no
  // longer current is refused before it is performed, with the same `409` — a late Response is
  // exactly what the header exists to let an owner refuse.
  if (!mayPerform || actionUrl === null) {
    say("TASK-21", "notExercised", "no Action was named as safe to perform against this Worker");
  } else {
    const late = await answerUnder(held.data.id, "the Action under a Claim that was closed", true);
    if (late !== null && late.status === 409 && code(late) === "conflict") say("TASK-21", "passes");
    else
      say(
        "TASK-21",
        "fails",
        `answered ${late?.status} with \`${(late && code(late)) ?? "no code"}\``,
      );
  }

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

  // TASK-23: a claim naming a type the entry does not raise is a parameter fault, whether or not
  // the entry declares `claimByType` — so one probe reaches the rule on every Worker.
  const noSuchType = await post(
    "?type=tech.rowing.no-such.task-type-4c1f",
    "a claim by a Task type the entry does not declare",
    true,
  );
  if (noSuchType.status === 400 && code(noSuchType) === "invalid_parameter")
    say("TASK-23", "passes");
  else {
    say(
      "TASK-23",
      "fails",
      `answered ${noSuchType.status} with \`${code(noSuchType) ?? "no code"}\``,
    );
  }

  // TASK-24: where the entry declares it, a claim by type answers the Claim with the Task it
  // holds. The type is the held Task's own, read back above; the Claim taken is released.
  if (!surface.claimByType) {
    say("TASK-24", "notExercised", "the entry does not declare `claimByType`");
  } else if (seen === "unreadable" || seen === null) {
    say("TASK-24", "notExercised", "the held Task could not be read back, so its type is unknown");
  } else {
    const byType = await post(`?type=${encodeURIComponent(seen.type)}`, "a claim by Task type");
    const granted = claimSchema.safeParse(byType.json);
    if (byType.status === 404) {
      say("TASK-24", "notExercised", `no claimable Task of type \`${seen.type}\` was open`);
    } else if (byType.status !== 200 || !granted.success) {
      say("TASK-24", "fails", `answered ${byType.status} with \`${code(byType) ?? "no code"}\``);
    } else {
      if (granted.data.held === undefined) {
        say("TASK-24", "fails", "the Claim carries no `held` Task");
      } else if (
        granted.data.held.id !== granted.data.task ||
        granted.data.held.type !== seen.type
      ) {
        say(
          "TASK-24",
          "fails",
          "the Task in `held` is not the one the Claim names, or not of the type claimed",
        );
      } else {
        say("TASK-24", "passes");
      }
      await post(
        `?claim=${encodeURIComponent(granted.data.id)}&outcome=released`,
        "releasing the Claim taken by type",
      );
    }
  }
}

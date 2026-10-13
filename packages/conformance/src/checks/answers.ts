import { taskPage } from "@worker-protocol/schemas";
import type { Arrangement, SafeAction } from "../index.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Transcript, withParams } from "../transcript.ts";
import { arrival, DEFAULT_PATIENCE_MS, event, header } from "./subscriptions.ts";

/**
 * A call that names the Task it answers, and the event an owner publishes for one.
 *
 * Every probe here posts, and every one of them but the last two is a call the Worker must refuse
 * or answer from its record — a Task it never gave, an Action the Task's type does not list, a
 * key it already holds. Each still has to carry an input the Worker accepts: where ACT-8 falls
 * against these rules is the Worker's (TASK-42 fixes only that the key comes first), so a body the
 * schema refuses could be answered `400` before the Task is asked about, and that would say
 * nothing. So each uses an Action the operators named safe to perform.
 */
export const CLAIMS = [
  "TASK-39",
  "TASK-40",
  "TASK-41",
  "TASK-42",
  "TASK-43",
  "EVT-20",
  "EVT-21",
] as const;

const ANSWERED = "tech.rowing.worker-protocol.task-answered";

/**
 * The least the sink is watched for a second `task-answered` after the repeat (EVT-21).
 *
 * What is judged is an absence, so the wait cannot end early. It is three times what the first
 * delivery took, measured on this run, and never less than this: a fixed two seconds was shorter
 * than one delivery through a Queue in production, so a second event published in error would have
 * arrived after the verifier stopped looking and the rule would have passed.
 */
const SILENCE_LEAST_MS = 2000;

type Declaration = { idempotency?: { from: string } };
type OpenTask = { id: string; type: string; since: string; available?: string[] };

export async function checkAnswers(given: {
  /** The `actions` entry's own map, for where each Action reads its key from. */
  accepts: Record<string, Declaration>;
  /** The `tasks` entry's `raises`, for which Actions each type lists (TASK-35). */
  raises: Record<string, { answeredBy?: string[] }>;
  actionsUrl: string | null;
  tasksUrl: string | null;
  subscriptionsUrl: string | null;
  /** EVT-12: what the `events` entry publishes. */
  publishes: string[];
  /** How long a delivery may take to reach the sink; `DEFAULT_PATIENCE_MS` where not given. */
  patienceMs?: number;
  mayPerform: boolean;
  arrangement: Arrangement;
  rules: Map<string, Rule>;
  transcript: Transcript;
}): Promise<Result[]> {
  const { accepts, raises, actionsUrl, tasksUrl, arrangement, transcript } = given;
  const { results, say, allExcept } = verdicts(given.rules, CLAIMS);

  if (actionsUrl === null || tasksUrl === null) {
    allExcept("notExercised", "the Worker declares no `actions` or no `tasks` address");
    return results;
  }
  if (!given.mayPerform) {
    allExcept("notExercised", "the verifier was not permitted to POST to this Worker");
    return results;
  }

  const code = (answer: { json: unknown }) => (answer.json as { code?: string } | null)?.code;
  const fresh = (why: string) => `conformance-${why}-${Date.now()}-${Math.random().toString(36)}`;
  /** A Task id no Worker gave: what TASK-39 must refuse, and TASK-42 and TASK-43 must not reach. */
  const nowhere = fresh("no-such-task");
  const from = (one: SafeAction) => accepts[one.name]?.idempotency?.from;
  const perform = (
    one: { name: string; input: unknown },
    how: { task?: string; key?: string; intent: string },
  ) =>
    transcript.send(withParams(actionsUrl, { action: one.name }), how.intent, {
      method: "POST",
      body: JSON.stringify(one.input),
      headers: {
        "content-type": "application/json",
        ...(how.task === undefined ? {} : { "worker-protocol-task": how.task }),
        ...(how.key === undefined ? {} : { "idempotency-key": how.key }),
      },
      permanent: true,
    });

  const open = await allOpen(tasksUrl, transcript, "the open Tasks, to name one in a call");
  const lists = (task: OpenTask, name: string) =>
    (raises[task.type]?.answeredBy ?? []).includes(name);

  const safe = [arrangement.safeAction, arrangement.secondSafeAction].filter(
    (one): one is SafeAction => one !== undefined,
  );
  // An input key holds a record of `input` from the checks before this one, and TASK-42 answers a
  // repeat from it before asking about the Task — so the refusals are probed with an Action whose
  // key is fresh on every call, or that takes none.
  const probe = safe.find((one) => from(one) !== "input");

  if (probe === undefined) {
    const why =
      safe.length === 0
        ? "no Action was named as safe to perform"
        : "every Action named safe reads its key from the input, and a repeat of it is answered from the record";
    for (const id of ["TASK-39", "TASK-40", "TASK-41"]) say(id, "notExercised", why);
  } else {
    const key = () => (from(probe) === "header" ? fresh("answer") : undefined);
    const refusal = async (task: string, intent: string) => {
      const answer = await perform(probe, { task, key: key(), intent });
      return { status: answer.status, code: code(answer) };
    };

    // TASK-39: a Task the Worker never gave is not open; nor is an open Task's id with an instant
    // that is not its `since`, which names another occurrence.
    const unknown = await refusal(
      nowhere,
      `\`${probe.name}\`, naming a Task the Worker never gave`,
    );
    // Among Tasks the probe could answer now, so that no order of TASK-40 and TASK-41 against
    // this rule — the text fixes none — could earn a `400` or a `409` first.
    const elsewhere = open.find(
      (task) =>
        Date.parse(task.since) !== 0 &&
        lists(task, probe.name) &&
        (task.available === undefined || task.available.includes(probe.name)),
    );
    const occurrence =
      elsewhere === undefined
        ? undefined
        : await refusal(
            `${elsewhere.id}; since=1970-01-01T00:00:00Z`,
            `\`${probe.name}\`, naming an open Task's id and another occurrence`,
          );
    const refused = (one: { status: number; code?: string }) =>
      one.status === 404 && one.code === "not_found";
    if (!refused(unknown)) {
      say("TASK-39", "fails", `a Task never given answered ${unknown.status}, not 404`);
    } else if (occurrence !== undefined && !refused(occurrence)) {
      say("TASK-39", "fails", `another occurrence answered ${occurrence.status}, not 404`);
    } else {
      say("TASK-39", "passes");
    }

    // TASK-40: an open Task whose type does not list the Action.
    const unlisted = open.find((task) => !lists(task, probe.name));
    if (unlisted === undefined) {
      say("TASK-40", "notExercised", `every open Task's type lists \`${probe.name}\``);
    } else {
      const answer = await refusal(
        unlisted.id,
        `\`${probe.name}\`, naming Task ${unlisted.id}, whose type does not list it`,
      );
      if (answer.status === 400 && answer.code === "invalid_parameter") say("TASK-40", "passes");
      else
        say("TASK-40", "fails", `answered ${answer.status} with \`${answer.code ?? "no code"}\``);
    }

    // TASK-41: an open Task whose type lists the Action and which does not offer it now.
    const withheld = open.find(
      (task) =>
        lists(task, probe.name) &&
        task.available !== undefined &&
        !task.available.includes(probe.name),
    );
    if (withheld === undefined) {
      say("TASK-41", "notExercised", `no open Task lists \`${probe.name}\` and withholds it now`);
    } else {
      const answer = await refusal(
        withheld.id,
        `\`${probe.name}\`, naming Task ${withheld.id}, which does not offer it now`,
      );
      if (answer.status === 409 && answer.code === "conflict") say("TASK-41", "passes");
      else
        say("TASK-41", "fails", `answered ${answer.status} with \`${answer.code ?? "no code"}\``);
    }
  }

  // TASK-42: an input key, performed naming no Task and repeated naming one nobody gave. The record
  // answers the repeat before the Task is asked about, so it is the recorded outcome and not `404`.
  const byInput = safe.find((one) => from(one) === "input");
  if (byInput === undefined) {
    say("TASK-42", "notExercised", "no Action safe to perform reads its key from the input");
  } else {
    const first = await perform(byInput, { intent: `\`${byInput.name}\`, naming no Task` });
    const again = await perform(byInput, {
      task: nowhere,
      intent: `\`${byInput.name}\` again, naming a Task the Worker never gave`,
    });
    if (first.status < 200 || first.status > 299) {
      say("TASK-42", "notExercised", `\`${byInput.name}\` answered ${first.status}`);
    } else if (again.status === first.status && again.body === first.body) {
      say("TASK-42", "passes");
    } else {
      say("TASK-42", "fails", `the repeat answered ${again.status}, not the recorded outcome`);
    }
  }

  // TASK-43: a header key, performed naming no Task and repeated naming one. Another request under
  // the caller's own key: `409`, and not the `404` the Task would have earned had it been asked.
  const byHeader = safe.find((one) => from(one) === "header");
  if (byHeader === undefined) {
    say("TASK-43", "notExercised", "no Action safe to perform reads its key from the header");
  } else {
    const key = fresh("reused");
    const first = await perform(byHeader, { key, intent: `\`${byHeader.name}\`, naming no Task` });
    const again = await perform(byHeader, {
      key,
      task: nowhere,
      intent: `\`${byHeader.name}\` under the same key, naming a Task`,
    });
    if (first.status < 200 || first.status > 299) {
      say("TASK-43", "notExercised", `\`${byHeader.name}\` answered ${first.status}`);
    } else if (again.status === 409 && code(again) === "idempotency_key_reused") {
      say("TASK-43", "passes");
    } else {
      say("TASK-43", "fails", `answered ${again.status} with \`${code(again) ?? "no code"}\``);
    }
  }

  await checkPublished({ ...given, perform, say });
  return results;
}

/** Every open Task this credential covers, page by page (ENDP-21), up to a bound. */
async function allOpen(url: string, transcript: Transcript, intent: string): Promise<OpenTask[]> {
  const open: OpenTask[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 20; pages += 1) {
    const read = await transcript.send(
      cursor === undefined ? url : withParams(url, { cursor }),
      pages === 0 ? intent : `${intent}, the next page`,
    );
    const page = taskPage.safeParse(read.json);
    if (!page.success) break;
    open.push(...(page.data.items as OpenTask[]));
    cursor = page.data.nextCursor;
    if (cursor === undefined) break;
  }
  return open;
}

/**
 * EVT-20 and EVT-21, at the arranged sink: the answering Action performed once naming an open Task,
 * then repeated under the same key — one `task-answered`, and not two.
 */
async function checkPublished(given: {
  accepts: Record<string, Declaration>;
  tasksUrl: string | null;
  subscriptionsUrl: string | null;
  publishes: string[];
  patienceMs?: number;
  arrangement: Arrangement;
  transcript: Transcript;
  perform: (
    one: { name: string; input: unknown },
    how: { task?: string; key?: string; intent: string },
  ) => Promise<{ status: number; body: string }>;
  say: (id: string, verdict: "passes" | "fails" | "notExercised", detail?: string) => void;
}): Promise<void> {
  const { arrangement, transcript, perform, say, subscriptionsUrl, tasksUrl } = given;
  const answering = arrangement.answeringAction;
  const sink = arrangement.sink;
  const skip = (why: string) => {
    for (const id of ["EVT-20", "EVT-21"]) say(id, "notExercised", why);
  };
  if (!given.publishes.includes(ANSWERED)) return skip(`the Worker does not publish ${ANSWERED}`);
  if (answering === undefined || sink === undefined) {
    return skip("no sink and no Action that answers a Task were given to the verifier");
  }
  if (subscriptionsUrl === null || tasksUrl === null) {
    return skip("the Worker declares no `subscriptions` address to reach the sink through");
  }

  const task = (
    await allOpen(tasksUrl, transcript, `the open Tasks, to find ${answering.task}`)
  ).find((one) => one.id === answering.task);
  if (task === undefined) return skip(`Task ${answering.task} is not open`);

  const credential = `conformance-answered-${Date.now()}`;
  const created = await transcript.send(subscriptionsUrl, `a subscription to ${ANSWERED}`, {
    method: "POST",
    body: JSON.stringify({ types: [ANSWERED], sink: sink.url, sinkCredential: credential }),
    headers: { "content-type": "application/json" },
  });
  const id = (created.json as { id?: unknown } | null)?.id;
  if (created.status !== 201 || typeof id !== "string") {
    return skip(`the subscription to ${ANSWERED} answered ${created.status}`);
  }

  try {
    const mine = (one: Parameters<typeof header>[0]) =>
      one.method === "POST" &&
      header(one, "authorization") === `Bearer ${credential}` &&
      event(one)?.type === ANSWERED &&
      event(one)?.subject === task.id;
    const from = given.accepts[answering.name]?.idempotency?.from;
    const key = from === "header" ? `conformance-answered-${Date.now()}` : undefined;
    const call = {
      task: task.id,
      key,
      intent: `\`${answering.name}\`, naming Task ${task.id}`,
    };

    const patience = given.patienceMs ?? DEFAULT_PATIENCE_MS;
    const sentAt = Date.now();
    const done = await perform(answering, call);
    if (done.status < 200 || done.status > 299) {
      return skip(`\`${answering.name}\` naming Task ${task.id} answered ${done.status}`);
    }
    const arrived = await arrival(sink, mine, patience);
    const took = Date.now() - sentAt;
    const sent = arrived[0] === undefined ? undefined : event(arrived[0]);
    const data = (sent as { data?: { id?: unknown; type?: unknown; action?: unknown } } | undefined)
      ?.data;

    // EVT-20: the Task in `subject`, its type as `tasktype`, a `time`, and the Action in `data`.
    if (sent === undefined) {
      say(
        "EVT-20",
        "fails",
        `nothing of type ${ANSWERED} about Task ${task.id} reached the sink within ${patience / 1000} s`,
      );
    } else if (
      sent.tasktype === task.type &&
      typeof sent.time === "string" &&
      data?.id === task.id &&
      data.type === task.type &&
      data.action === answering.name
    ) {
      say("EVT-20", "passes");
    } else {
      say(
        "EVT-20",
        "fails",
        "the event does not carry the Task, its type, a `time` and the Action",
      );
    }

    // EVT-21: a repeat under the same key is answered from the record, and is not an answer.
    if (from === undefined) {
      say("EVT-21", "notExercised", `\`${answering.name}\` declares no idempotency key`);
    } else if (sent === undefined) {
      say("EVT-21", "notExercised", "the first performance published nothing to count against");
    } else {
      await perform(answering, { ...call, intent: `${call.intent}, again under the same key` });
      const silence = Math.min(Math.max(3 * took, SILENCE_LEAST_MS), patience);
      const counted = await arrival(sink, mine, silence, 2);
      if (counted.length === 1) say("EVT-21", "passes");
      else
        say(
          "EVT-21",
          "fails",
          `a repeat answered from the record published ${ANSWERED} again, within ${silence / 1000} s`,
        );
    }
  } finally {
    await transcript.send(withParams(subscriptionsUrl, { subscription: id }), "ending it", {
      method: "DELETE",
      permanent: true,
    });
  }
}

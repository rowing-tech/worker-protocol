import { health as healthSchema, taskPage } from "@worker-protocol/schemas";
import type { Arrangement } from "../index.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The rules that need something no Worker has by accident.
 *
 * A second credential, a boot window, settings its operators will let go of, an event it already
 * published. `conformance/verifiability.md` classes these `H` because nothing a tool can do to an
 * unarranged Worker will ever see a violation — and the arrangement cannot come from the protocol,
 * because test scaffolding in a Descriptor would be carried by every Worker in the network to
 * serve a tool most of them will never meet.
 *
 * Every one of them reports what was missing rather than a verdict, which is a gap somebody can
 * close and not a claim about the Worker.
 */
export const CLAIMS = [
  "REG-8",
  "REG-28",
  "REG-32",
  "ALRT-6",
  "ACTV-6",
  "TASK-6",
  "HLTH-4",
  "ACT-14",
  "EVT-1",
] as const;

/**
 * The surfaces where two credentials must be served one list, and the rule each one is.
 *
 * A table rather than a block each, because the rule is mechanical: any read-only surface whose
 * audience is whoever operates the Worker gets one, and the two that exist derive from each other
 * by substitution. TASK-6 is deliberately not here — the comment below says why it reads the
 * other way.
 */
const SAME_TO_BOTH = [
  { rule: "ALRT-6", url: "alertsUrl", capability: "alerts", one: "the Alerts", many: "Alerts" },
  {
    rule: "ACTV-6",
    url: "activityUrl",
    capability: "activity",
    one: "the activity",
    many: "activities",
  },
] as const satisfies readonly {
  rule: string;
  url: keyof Surfaces;
  capability: string;
  one: string;
  many: string;
}[];

type Surfaces = {
  descriptorUrl: string | null;
  alertsUrl: string | null;
  activityUrl: string | null;
  tasksUrl: string | null;
  settingsUrl: string | null;
  workerId: string | null;
  eventTypes: string[];
};

export async function checkArranged(
  surfaces: Surfaces,
  arrangement: Arrangement,
  mayPerform: boolean,
  rules: Map<string, Rule>,
  transcript: Transcript,
): Promise<Result[]> {
  const { results, say } = verdicts(rules, CLAIMS);

  const asSecond = (url: string, intent: string) =>
    transcript.send(url, intent, {
      headers: { authorization: `Bearer ${arrangement.secondCredential}` },
    });

  // REG-28 (recommended), REG-8, ALRT-6 and ACTV-6 all need a second credential, and it is one
  // arrangement because it is one thing an operator issues.
  const second = arrangement.secondCredential;
  if (second === undefined || surfaces.descriptorUrl === null) {
    for (const id of ["REG-28", "REG-8", ...SAME_TO_BOTH.map((one) => one.rule)]) {
      say(id, "notExercised", "no second credential was given to the verifier");
    }
  } else {
    // REG-28: without it rotation is a flag day — the old credential stops at the instant the new
    // one starts, and every caller holding the old one fails in the window between.
    const withSecond = await asSecond(surfaces.descriptorUrl, "the Descriptor, second credential");
    if (withSecond.status === 200) {
      say("REG-28", "passes");
    } else {
      say("REG-28", "fails", `the second credential answered ${withSecond.status}`);
    }

    // REG-8: a Descriptor filtered per reader is a different document to every reader, and a
    // consumer then cannot tell a Capability it may not use from one the Worker withdrew.
    const withFirst = await transcript.send(surfaces.descriptorUrl, "the Descriptor, again");
    if (withSecond.status !== 200 || withFirst.status !== 200) {
      say("REG-8", "notExercised", "one of the two credentials did not read the Descriptor");
    } else if (withFirst.body === withSecond.body) {
      say("REG-8", "passes");
    } else {
      say("REG-8", "fails", "the two credentials were served different Descriptors");
    }

    // ALRT-6 and ACTV-6 are one rule read on two surfaces: both are for whoever OPERATES the
    // Worker, which is a relationship of enrollment, so every credential it authenticates sees one
    // list. A third read-only surface with that audience gets a row here rather than a block.
    for (const { rule, url, capability, one, many } of SAME_TO_BOTH) {
      const address = surfaces[url];
      if (address === null) {
        say(rule, "notExercised", `the Worker declares no \`${capability}\``);
        continue;
      }
      const first = await transcript.send(address, `${one}, first credential`);
      const second = await asSecond(address, `${one}, second credential`);
      if (first.status !== 200 || second.status !== 200) {
        say(rule, "notExercised", `one of the two credentials did not read ${one}`);
      } else if (first.body === second.body) {
        say(rule, "passes");
      } else {
        say(rule, "fails", `the two credentials were served different ${many}`);
      }
    }
  }

  // TASK-6 is the one that reads the other way. Alerts are for whoever operates the Worker, so
  // two credentials seeing the same list is the rule holding; Tasks are what a Contract covers,
  // so two credentials seeing the same list proves only that this Worker had nothing to filter.
  // The credential compared against is a Contract's where one was arranged — that is the party
  // the rule is about — and the second credential otherwise.
  const consumer = arrangement.consumerCredential ?? second;
  if (consumer === undefined) {
    say("TASK-6", "notExercised", "no Contract credential was given to the verifier");
  } else if (surfaces.tasksUrl === null) {
    say("TASK-6", "notExercised", "the Worker declares no `tasks`");
  } else {
    const a = taskPage.safeParse((await transcript.send(surfaces.tasksUrl, "Tasks, first")).json);
    const b = taskPage.safeParse(
      (
        await transcript.send(surfaces.tasksUrl, "Tasks, Contract credential", {
          headers: { authorization: `Bearer ${consumer}` },
        })
      ).json,
    );
    if (!a.success || !b.success) {
      say("TASK-6", "notExercised", "one of the two reads did not validate");
    } else {
      const ids = (page: typeof a) => (page.success ? page.data.items.map((t) => t.id) : []);
      const first = new Set(ids(a));
      const other = ids(b);
      if (other.length === first.size && other.every((id) => first.has(id))) {
        say(
          "TASK-6",
          "notExercised",
          "both credentials see the same Tasks, which is consistent with filtering and with not filtering",
        );
      } else {
        say("TASK-6", "passes");
      }
    }
  }

  // REG-32 (recommended): a refusal that explains itself is an oracle. A caller told *that key is
  // expired* rather than *no* has learned the key exists.
  const unprivileged = arrangement.unprivilegedCredential;
  if (unprivileged === undefined || surfaces.descriptorUrl === null) {
    say("REG-32", "notExercised", "no credential was given that authenticates and lacks a right");
  } else {
    const lacking = await transcript.send(
      surfaces.descriptorUrl,
      "a credential that lacks a right",
      {
        headers: { authorization: `Bearer ${unprivileged}` },
        permanent: true,
      },
    );
    const nonsense = await transcript.send(surfaces.descriptorUrl, "a credential never issued", {
      headers: { authorization: "Bearer never-issued-7a2c" },
      permanent: true,
    });
    if (lacking.status < 400 || nonsense.status < 400) {
      say("REG-32", "notExercised", "the Worker refused neither, so there is nothing to compare");
    } else if (lacking.body === nonsense.body || lacking.status !== nonsense.status) {
      // Either the two refusals say the same thing, or they are different KINDS of refusal, which
      // ENDP-29 divides at whether the credential could be read. Neither tells a caller which
      // credential or scope would have changed the answer.
      say("REG-32", "passes");
    } else {
      say("REG-32", "fails", "two refusals of the same status said different things");
    }
  }

  // HLTH-4: a Worker that has not yet established its state answers `unhealthy`, never `healthy`.
  // The window is between a process starting and its first evaluation, and only whoever started it
  // knows the verifier is inside one.
  if (arrangement.justStarted !== true) {
    say("HLTH-4", "notExercised", "the verifier was not told the Worker had just started");
  } else if (arrangement.healthUrl === undefined) {
    say("HLTH-4", "notExercised", "no health address was resolved");
  } else {
    const polled = await transcript.send(arrangement.healthUrl, "health, immediately after start");
    const parsed = healthSchema.safeParse(polled.json);
    if (!parsed.success) {
      say("HLTH-4", "notExercised", "the health answer did not validate");
    } else if (parsed.data.status === "healthy") {
      say("HLTH-4", "fails", "it answered `healthy` before establishing its state");
    } else {
      say("HLTH-4", "passes");
    }
  }

  // ACT-14: the input of `configure` is the complete settings document. What a check establishes
  // is that the whole document round-trips — over a closed schema that requires every member,
  // replacing and merging are the same operation, and this is the honest limit of the witness.
  if (arrangement.replaceableSettings !== true || !mayPerform) {
    say(
      "ACT-14",
      "notExercised",
      "the verifier was not permitted to replace this Worker's settings",
    );
  } else if (surfaces.settingsUrl === null || arrangement.actionsUrl === undefined) {
    say("ACT-14", "notExercised", "no `configure` reading address was resolved");
  } else {
    const before = await transcript.send(surfaces.settingsUrl, "the settings, before");
    const written = await transcript.send(
      `${arrangement.actionsUrl}?action=configure`,
      "configure, with what it already holds",
      {
        method: "POST",
        body: before.body,
      },
    );
    const after = await transcript.send(surfaces.settingsUrl, "the settings, after");
    if (written.status >= 400) {
      say("ACT-14", "fails", `configure refused its own document with ${written.status}`);
    } else if (before.body === after.body) {
      say("ACT-14", "passes");
    } else {
      say(
        "ACT-14",
        "fails",
        "the settings changed when the Worker was handed what it already held",
      );
    }
  }

  // EVT-1: `source` is the Worker's id and `type` is one the entry declares. The verifier holds no
  // broker and sees no event, so the only way to reach this is to be handed one.
  const published = arrangement.publishedEvent;
  if (published === undefined) {
    say("EVT-1", "notExercised", "no published event was given to the verifier");
  } else {
    const event = published as { source?: unknown; type?: unknown; id?: unknown };
    const faults: string[] = [];
    if (typeof event.id !== "string" || event.id.length === 0) faults.push("no `id`");
    if (event.source !== surfaces.workerId) {
      faults.push(
        `\`source\` is ${JSON.stringify(event.source)} and the Worker's id is ${JSON.stringify(surfaces.workerId)}`,
      );
    }
    if (typeof event.type !== "string" || !surfaces.eventTypes.includes(event.type)) {
      faults.push(`\`type\` ${JSON.stringify(event.type)} is not one the entry declares`);
    }
    if (faults.length === 0) say("EVT-1", "passes");
    else say("EVT-1", "fails", faults.join("; "));
  }

  return results;
}

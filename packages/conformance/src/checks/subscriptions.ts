import { subscriptionPage, subscriptionsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Arrangement } from "../index.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Transcript, withParams } from "../transcript.ts";

/**
 * The `subscriptions` Capability, and the half of `events` a verifier can finally see.
 *
 * **Two kinds of rule, and they need different things.** What a credential alone can observe — the
 * entry, a type the Worker does not publish, a sink in plaintext or on a private address — is
 * judged against any Worker that declares the Capability, once the verifier may POST. What happens
 * at a sink needs one the Worker can reach, and an Action that makes it publish, because nothing
 * else lets a verifier cause an event: both arrive in the arrangement, out of band, and without
 * them those rules report what was missing.
 *
 * `verify()` starts no server, so it runs in any runtime, and the sink is the caller's. Every
 * subscription this module makes, it ends before it returns, so the Worker is left as it was found.
 */
/** What a credential alone observes, once the verifier may POST. */
const OBSERVED = ["SUB-1", "SUB-3", "SUB-5", "SUB-6"] as const;

/** Only observable with a sink and an Action that publishes, arranged and told to the verifier. */
const ARRANGED = [
  "SUB-2",
  "SUB-7",
  "SUB-8",
  "SUB-9",
  "SUB-10",
  "SUB-11",
  "SUB-13",
  "SUB-16",
  "SUB-17",
  "EVT-15",
] as const;

export const CLAIMS = [...OBSERVED, ...ARRANGED] as const;

/** One request a sink received, as the arrangement reports it. */
export type SinkExchange = {
  method: string;
  headers: Record<string, string>;
  body: string;
};

/** The extension EVT-15 puts each lifecycle type's filterable property in. */
const LIFECYCLE: Record<string, string> = {
  "tech.rowing.worker-protocol.task-raised": "tasktype",
  "tech.rowing.worker-protocol.task-ended": "tasktype",
  "tech.rowing.worker-protocol.alert-raised": "alertseverity",
  "tech.rowing.worker-protocol.alert-ended": "alertseverity",
};

/** How long a delivery may take to reach the sink before the verifier stops waiting for it. */
const PATIENCE_MS = 5000;

export async function checkSubscriptions(given: {
  entry: Record<string, unknown> | undefined;
  url: string | null;
  workerId: string | null;
  /** EVT-12: what the `events` entry publishes, which is all a caller may subscribe to. */
  publishes: string[];
  actionsUrl: string | null;
  mayPerform: boolean;
  arrangement: Arrangement;
  rules: Map<string, Rule>;
  attribution: Attribution;
  transcript: Transcript;
}): Promise<Result[]> {
  const { entry, url, workerId, publishes, actionsUrl, mayPerform, arrangement, transcript } =
    given;
  const { results, say, allExcept } = verdicts(given.rules, CLAIMS);

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `subscriptions`");
    return results;
  }

  // SUB-1: read off the Descriptor, and judged without sending anything.
  const declared = subscriptionsEntry.safeParse(entry);
  if (!declared.success) {
    const issue = declared.error.issues[0];
    const id = ruleFor(given.attribution, "subscriptions-entry", issue?.path ?? []) ?? "SUB-1";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the `subscriptions` entry did not validate", [id]);
    return results;
  }
  say("SUB-1", "passes");

  if (url === null) {
    allExcept("notExercised", "the `subscriptions` address did not resolve", ["SUB-1"]);
    return results;
  }
  if (!mayPerform) {
    allExcept("notExercised", "the verifier was not permitted to POST to this Worker", ["SUB-1"]);
    return results;
  }

  const post = (body: unknown, intent: string) =>
    transcript.send(url, intent, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      permanent: true,
    });
  /** SUB-9: a DELETE naming the subscription in a parameter on the declared address. */
  const end = (subscription: string, how: { intent: string; as?: string }) =>
    transcript.send(withParams(url, { subscription }), how.intent, {
      method: "DELETE",
      ...(how.as === undefined ? {} : { headers: { authorization: `Bearer ${how.as}` } }),
      permanent: true,
    });
  const code = (answer: { json: unknown }) => (answer.json as { code?: string } | null)?.code;
  const idOf = (answer: { json: unknown }) => (answer.json as { id?: string } | null)?.id;
  const published = publishes[0] ?? "tech.rowing.worker-protocol.task-raised";

  // SUB-3: a type the entry does not publish, at a sink nobody could have asked for.
  const unpublished = await post(
    {
      types: ["tech.rowing.worker-protocol.no-such-type"],
      sink: "https://sink.invalid/in",
      sinkCredential: "x",
    },
    "a subscription to a type the Worker does not publish",
  );
  if (unpublished.status === 422 && code(unpublished) === "unprocessable_content")
    say("SUB-3", "passes");
  else
    say(
      "SUB-3",
      "fails",
      `answered ${unpublished.status} with \`${code(unpublished) ?? "no code"}\``,
    );

  // SUB-5: a sink in plaintext, on a host nobody could exempt for development.
  const plaintext = await post(
    { types: [published], sink: "http://sink.invalid/in", sinkCredential: "x" },
    "a subscription to a sink in plaintext",
  );
  if (plaintext.status === 400 && code(plaintext) === "schema_mismatch") say("SUB-5", "passes");
  else
    say("SUB-5", "fails", `answered ${plaintext.status} with \`${code(plaintext) ?? "no code"}\``);

  // SUB-6, recommended: the inside of the Worker's own network.
  const loopback = await post(
    { types: [published], sink: "https://127.0.0.1:1/in", sinkCredential: "x" },
    "a subscription to a loopback sink",
  );
  if (loopback.status === 422) say("SUB-6", "passes");
  else say("SUB-6", "fails", `a loopback sink answered ${loopback.status}`);

  // From here on the rules happen at a sink, and need one.
  const sink = arrangement.sink;
  const trigger = arrangement.publishingAction;
  if (sink === undefined || trigger === undefined || actionsUrl === null || workerId === null) {
    allExcept("notExercised", "no sink and no Action that publishes were given to the verifier", [
      ...OBSERVED,
    ]);
    return results;
  }

  const credential = `conformance-${Date.now()}`;
  const subscription = { types: [trigger.publishes], sink: sink.url, sinkCredential: credential };
  const created = await post(subscription, "a subscription to the arranged sink");
  const id = idOf(created);
  if (created.status !== 201 || typeof id !== "string") {
    say("SUB-2", "fails", `answered ${created.status} with \`${code(created) ?? "no code"}\``);
    allExcept("notExercised", "the subscription to the arranged sink was not created", [
      ...OBSERVED,
      "SUB-2",
    ]);
    return results;
  }
  say("SUB-2", "passes");

  // A second subscription that no event can satisfy: SUB-13 is seen as what does NOT arrive.
  const filtered = await post(
    {
      ...subscription,
      sinkCredential: `${credential}-filtered`,
      filters: [{ exact: { subject: "conformance-no-such-subject" } }],
    },
    "a subscription whose filter nothing satisfies",
  );
  const filteredId = idOf(filtered);

  try {
    const seen = await sink.received();

    // SUB-10: the handshake reached the sink, naming this Worker, before anything was stored.
    const handshake = seen.find(
      (one) => one.method === "OPTIONS" && header(one, "webhook-request-origin") === workerId,
    );
    if (handshake !== undefined) say("SUB-10", "passes");
    else
      say(
        "SUB-10",
        "fails",
        "the sink saw no OPTIONS naming this Worker in WebHook-Request-Origin",
      );

    // SUB-7: the same caller, sink, types and filters finds the one that exists.
    const again = await post(subscription, "the same subscription again");
    if (again.status === 200 && idOf(again) === id) say("SUB-7", "passes");
    else say("SUB-7", "fails", `answered ${again.status}, not 200 with the same id`);

    // SUB-8, SUB-9: whose it is. Another caller neither sees it nor ends it.
    const own = await transcript.send(url, "this caller's subscriptions");
    const ownListed = subscriptionPage.safeParse(own.json);
    const other = arrangement.otherCallerCredential;
    if (!ownListed.success || !ownListed.data.items.some((one) => one.id === id)) {
      say("SUB-8", "fails", "the caller's own list does not carry the subscription it created");
    } else if (other === undefined) {
      say("SUB-8", "notExercised", "no credential of another caller was given to the verifier");
    } else {
      const theirs = await transcript.send(url, "another caller's subscriptions", {
        headers: { authorization: `Bearer ${other}` },
      });
      const listed = subscriptionPage.safeParse(theirs.json);
      if (listed.success && !listed.data.items.some((one) => one.id === id)) say("SUB-8", "passes");
      else say("SUB-8", "fails", "another caller's list carries this caller's subscription");
    }

    // SUB-11, EVT-15, SUB-13: perform the Action that publishes, and read the sink. EVT-1 is
    // judged in `arranged.ts`, from the event the arrangement hands over, and not twice.
    const performed = await transcript.send(
      withParams(actionsUrl, { action: trigger.name }),
      `\`${trigger.name}\`, which publishes ${trigger.publishes}`,
      {
        method: "POST",
        body: JSON.stringify(trigger.input),
        headers: {
          "content-type": "application/json",
          "idempotency-key": `conformance-${Date.now()}`,
        },
      },
    );
    const performedOk = performed.status >= 200 && performed.status <= 299;
    const delivered = performedOk
      ? await arrival(
          sink,
          (one) => one.method === "POST" && event(one)?.type === trigger.publishes,
        )
      : [];

    const mine = delivered.filter((one) => header(one, "authorization") === `Bearer ${credential}`);
    if (!performedOk) {
      for (const rule of ["SUB-11", "SUB-13", "SUB-16", "EVT-15"]) {
        say(rule, "notExercised", `\`${trigger.name}\` answered ${performed.status}`);
      }
    } else if (mine.length === 0) {
      say(
        "SUB-11",
        "fails",
        `nothing of type ${trigger.publishes} reached the sink with its credential`,
      );
      for (const rule of ["SUB-13", "SUB-16", "EVT-15"]) {
        say(rule, "notExercised", "no delivery reached the sink");
      }
    } else {
      const [first] = mine;
      const sent = first === undefined ? undefined : event(first);
      const structured =
        first !== undefined &&
        header(first, "content-type")?.startsWith("application/cloudevents+json");
      // SUB-11: structured mode, and the event's own `source` and `id` — CloudEvents 1.0 from this
      // Worker, of a type the entry declares.
      const intact =
        sent?.specversion === "1.0" &&
        sent.source === workerId &&
        typeof sent.id === "string" &&
        publishes.includes(sent.type ?? "");
      if (structured && intact) say("SUB-11", "passes");
      else say("SUB-11", "fails", "a delivery was not this Worker's CloudEvent in structured mode");

      // EVT-15: a lifecycle type carries the resource in `subject` and its property as an extension.
      const extension = LIFECYCLE[trigger.publishes];
      if (extension === undefined) {
        say("EVT-15", "notExercised", `${trigger.publishes} is not a lifecycle type`);
      } else if (typeof sent?.subject === "string" && typeof sent[extension] === "string") {
        say("EVT-15", "passes");
      } else {
        say(
          "EVT-15",
          "fails",
          `${trigger.publishes} carries no \`subject\` or no \`${extension}\``,
        );
      }

      // SUB-13: the filter nothing satisfies received nothing, while the unfiltered one did. The
      // two subscriptions share a sink and differ in their credential, which is how they are told
      // apart there.
      const leaked = delivered.some(
        (one) => header(one, "authorization") === `Bearer ${credential}-filtered`,
      );
      if (filteredId === undefined) {
        say("SUB-13", "notExercised", "the filtered subscription was not created");
      } else if (!leaked) {
        say("SUB-13", "passes");
      } else {
        say("SUB-13", "fails", "an event reached a subscription whose filter it does not satisfy");
      }

      // SUB-16: the delivery shows in the caller's list.
      const after = subscriptionPage.safeParse(
        (await transcript.send(url, "this caller's subscriptions, after a delivery")).json,
      );
      const state = after.success ? after.data.items.find((one) => one.id === id) : undefined;
      if (state?.lastDeliveredAt !== undefined) say("SUB-16", "passes");
      else say("SUB-16", "fails", "the subscription does not show when a delivery last succeeded");
    }

    // SUB-9: another caller cannot end it, and its owner can.
    if (other === undefined) {
      say("SUB-9", "notExercised", "no credential of another caller was given to the verifier");
      say("SUB-17", "notExercised", "no credential of another caller was given to the verifier");
    } else {
      const theirs = await end(id, {
        intent: "another caller ending this caller's subscription",
        as: other,
      });
      const ended = await end(id, { intent: "the caller ending its own subscription" });
      // SUB-9: refused, and nothing ended; SUB-17 recommends the refusal not say which.
      const refusedTheirs = theirs.status === 404 || theirs.status === 403;
      if (refusedTheirs && ended.status === 204) say("SUB-9", "passes");
      else
        say(
          "SUB-9",
          "fails",
          `another caller answered ${theirs.status}, the owner ${ended.status}`,
        );
      if (theirs.status === 404 && code(theirs) === "not_found") say("SUB-17", "passes");
      else
        say("SUB-17", "fails", `another caller's subscription answered ${theirs.status}, not 404`);
    }
  } finally {
    // Leave the Worker as it was found.
    for (const one of [id, filteredId]) {
      if (typeof one === "string") {
        await end(one, { intent: "ending the verifier's own subscription" });
      }
    }
  }

  return results;
}

/** A header of one exchange, case-insensitively. */
const header = (exchange: SinkExchange, name: string): string | undefined =>
  Object.entries(exchange.headers).find(([key]) => key.toLowerCase() === name)?.[1];

/** The CloudEvent a structured-mode delivery carried, or `undefined`. */
const event = (exchange: SinkExchange): Record<string, string | undefined> | undefined => {
  try {
    const parsed = JSON.parse(exchange.body) as unknown;
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Waits for what the predicate picks out to reach the sink, up to `PATIENCE_MS`, and answers it. */
const arrival = async (
  sink: NonNullable<Arrangement["sink"]>,
  wanted: (exchange: SinkExchange) => boolean,
): Promise<SinkExchange[]> => {
  const until = Date.now() + PATIENCE_MS;
  for (;;) {
    const found = (await sink.received()).filter(wanted);
    if (Date.now() > until) return found;
    if (found.length > 0) {
      // A moment more, so that a delivery that should not have arrived has had the time to.
      await new Promise((settle) => setTimeout(settle, 200));
      return (await sink.received()).filter(wanted);
    }
    await new Promise((settle) => setTimeout(settle, 50));
  }
};

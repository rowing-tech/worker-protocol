import { subscriptionPage, subscriptionsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Arrangement } from "../index.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Transcript, withParams } from "../transcript.ts";
import { agrees, type Declared } from "./inputs.ts";

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
  "EVT-18",
  "SUB-12",
  "SUB-14",
  "SUB-15",
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

/** How long a retry may take after the sink recovers: the backoff, then a Queue's own wait. */
const RETRY_PATIENCE_MS = 30_000;

/** How often an event is provoked while the verifier waits for a subscription to be abandoned. */
const ABANDONMENT_NUDGE_MS = 30_000;

/** The attributes CloudEvents 1.0 defines, and `data`: everything else on an event is an extension. */
const CONTEXT = new Set([
  "specversion",
  "id",
  "source",
  "type",
  "datacontenttype",
  "dataschema",
  "subject",
  "time",
  "data",
  "data_base64",
]);

const SUBSCRIPTION_ENDED = "tech.rowing.worker-protocol.subscription-ended";

export async function checkSubscriptions(given: {
  entry: Record<string, unknown> | undefined;
  url: string | null;
  workerId: string | null;
  /** EVT-12: what the `events` entry publishes, which is all a caller may subscribe to. */
  publishes: string[];
  /** EVT-17: the extensions each type declares, by type, for EVT-18 to judge a delivery against. */
  extensions: Record<string, Record<string, unknown>>;
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
  /** The Action that publishes, performed once more under a key of its own. */
  const provoke = (why: string) =>
    transcript.send(
      withParams(actionsUrl, { action: trigger.name }),
      `\`${trigger.name}\`, which publishes ${trigger.publishes}${why}`,
      {
        method: "POST",
        body: JSON.stringify(trigger.input),
        headers: {
          "content-type": "application/json",
          "idempotency-key": `conformance-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      },
    );
  /** This verifier's subscription as the caller's list shows it now. */
  const listedNow = async (intent: string) => {
    const page = subscriptionPage.safeParse((await transcript.send(url, intent)).json);
    return page.success ? page.data.items.find((one) => one.id === id) : undefined;
  };
  /** What reached the sink under this verifier's own credential. */
  const mine = (one: SinkExchange) =>
    one.method === "POST" && header(one, "authorization") === `Bearer ${credential}`;
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
    //
    // Where the sink can be made to fail, it fails from the first attempt: `503` with a
    // `Retry-After` of one second, so SUB-12 and SUB-16 watch a retry of the one event the Action
    // publishes — an Action that answers a Task publishes the moment it ends it, and only once.
    // The sink then answers again, and the retry is the delivery the other rules are judged on.
    const failing = sink.respond !== undefined;
    const ofType = (one: SinkExchange) =>
      one.method === "POST" && event(one)?.type === trigger.publishes;
    let failingShown = false;
    let delivered: SinkExchange[] = [];
    let performed: Awaited<ReturnType<typeof provoke>>;
    try {
      if (failing) sink.respond?.({ status: 503, retryAfter: "1" });
      performed = await provoke("");
      const performedNow = performed.status >= 200 && performed.status <= 299;
      if (performedNow && failing) {
        const refused = await arrival(sink, (one) => ofType(one) && mine(one));
        const refusedId = refused[0] === undefined ? undefined : event(refused[0])?.id;
        if (refusedId !== undefined) {
          failingShown =
            (await listedNow("this caller's subscriptions, while its sink fails"))?.failingSince !==
            undefined;
        }
        sink.respond?.(undefined);
        delivered = await arrival(
          sink,
          (one) => ofType(one) && (!mine(one) || event(one)?.id === refusedId),
          RETRY_PATIENCE_MS,
          2,
        );
      } else if (performedNow) {
        delivered = await arrival(sink, ofType);
      }
    } finally {
      if (failing) sink.respond?.(undefined);
    }
    const performedOk = performed.status >= 200 && performed.status <= 299;

    const ours = delivered.filter((one) => header(one, "authorization") === `Bearer ${credential}`);
    const later = ["SUB-12", "SUB-14", "SUB-15", "EVT-18"];
    if (!performedOk) {
      for (const rule of ["SUB-11", "SUB-13", "SUB-16", "EVT-15", ...later]) {
        say(rule, "notExercised", `\`${trigger.name}\` answered ${performed.status}`);
      }
    } else if (ours.length === 0) {
      say(
        "SUB-11",
        "fails",
        `nothing of type ${trigger.publishes} reached the sink with its credential`,
      );
      for (const rule of ["SUB-13", "SUB-16", "EVT-15", ...later]) {
        say(rule, "notExercised", "no delivery reached the sink");
      }
    } else {
      const [first] = ours;
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

      // EVT-18: every attribute the event carries beyond CloudEvents' own is an extension its type
      // declares, with a value that extension's schema accepts — as far as one value's schema says.
      const declaredHere = given.extensions[trigger.publishes] ?? {};
      const carried = Object.keys(sent ?? {}).filter((name) => !CONTEXT.has(name));
      const strays = carried.filter((name) => !(name in declaredHere));
      const refusedValues = carried.filter(
        (name) =>
          name in declaredHere &&
          !agrees(declaredHere[name] as Declared, (sent as Record<string, unknown>)[name]),
      );
      if (strays.length === 0 && refusedValues.length === 0) say("EVT-18", "passes");
      else
        say(
          "EVT-18",
          "fails",
          [
            ...strays.map((name) => `\`${name}\` is not declared`),
            ...refusedValues.map((name) => `\`${name}\` carries a value its schema refuses`),
          ].join("; "),
        );

      // SUB-16, the half every Worker shows: the delivery is on record in the caller's list.
      const lastDelivered = (await listedNow("this caller's subscriptions, after a delivery"))
        ?.lastDeliveredAt;

      // SUB-12 and SUB-16's other half, where the sink could be made to fail: the event it refused
      // arrived again once it answered, the list showed the failure while it lasted, and shows it
      // no longer.
      const retried = ours.length >= 2;
      const cleared =
        (await listedNow("this caller's subscriptions, after the sink recovered"))?.failingSince ===
        undefined;
      if (!failing) say("SUB-12", "notExercised", "the arranged sink cannot be told to fail");
      else if (retried) say("SUB-12", "passes");
      else
        say(
          "SUB-12",
          "fails",
          `an event the sink answered 503 to was not delivered again within ${RETRY_PATIENCE_MS / 1000} s`,
        );
      if (lastDelivered === undefined) {
        say("SUB-16", "fails", "the subscription does not show when a delivery last succeeded");
      } else if (failing && !failingShown) {
        say("SUB-16", "fails", "the subscription does not show since when its sink has failed");
      } else if (failing && !cleared) {
        say("SUB-16", "fails", "the subscription still shows its sink failing after it recovered");
      } else {
        say("SUB-16", "passes");
      }

      // SUB-14 and SUB-15, only where the operators accepted the wait: the sink fails without
      // interruption for the declared window, an event is provoked every so often so that an
      // attempt falls after it, and the Worker has to end the subscription and say so.
      const window = declared.data.abandonAfterSeconds * 1000;
      if (arrangement.abandonment !== true || sink.respond === undefined) {
        const why =
          arrangement.abandonment !== true
            ? "the arrangement does not wait `abandonAfterSeconds` for an abandonment"
            : "the arranged sink cannot be told to fail";
        say("SUB-14", "notExercised", why);
        say("SUB-15", "notExercised", why);
      } else {
        sink.respond({ status: 503 });
        let ended: Record<string, unknown> | undefined;
        try {
          const deadline = Date.now() + window + 60_000;
          while (ended === undefined && Date.now() < deadline) {
            await provoke(", while the sink keeps failing");
            const found = await arrival(
              sink,
              (one) =>
                mine(one) && event(one)?.type === SUBSCRIPTION_ENDED && event(one)?.subject === id,
              Math.min(ABANDONMENT_NUDGE_MS, Math.max(deadline - Date.now(), 0)),
            );
            ended =
              found[0] === undefined ? undefined : (event(found[0]) as Record<string, unknown>);
          }
        } finally {
          sink.respond(undefined);
        }
        const kept = await listedNow("this caller's subscriptions, after an abandonment");
        const data = ended?.data as { reason?: string; since?: string } | undefined;
        if (ended === undefined) {
          say(
            "SUB-14",
            "fails",
            `the subscription was not abandoned within ${window / 1000} s and a minute`,
          );
          say("SUB-15", "notExercised", "no subscription ended");
        } else {
          say("SUB-14", "passes");
          if (
            data?.reason === "abandoned" &&
            typeof data.since === "string" &&
            kept?.endedAt !== undefined &&
            kept.reason === "abandoned"
          )
            say("SUB-15", "passes");
          else
            say(
              "SUB-15",
              "fails",
              "the ending was not announced with its reason and instant, or not kept listed",
            );
        }
      }
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

/**
 * Waits for `count` exchanges the predicate picks out to reach the sink, up to `patience`
 * milliseconds, and answers them.
 */
const arrival = async (
  sink: NonNullable<Arrangement["sink"]>,
  wanted: (exchange: SinkExchange) => boolean,
  patience = PATIENCE_MS,
  count = 1,
): Promise<SinkExchange[]> => {
  const until = Date.now() + patience;
  for (;;) {
    const found = (await sink.received()).filter(wanted);
    if (Date.now() > until) return found;
    if (found.length >= count) {
      // A moment more, so that a delivery that should not have arrived has had the time to.
      await new Promise((settle) => setTimeout(settle, 200));
      return (await sink.received()).filter(wanted);
    }
    await new Promise((settle) => setTimeout(settle, 50));
  }
};

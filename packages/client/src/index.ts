import {
  activityPage,
  type activity as activitySchema,
  type alert,
  alertPage,
  descriptor as descriptorSchema,
  health as healthSchema,
  type logLevel,
  logPage,
  type logRecord,
  type metricBucket,
  metricPage,
  subscriptionPage,
  subscriptionReceipt,
  type subscriptionRequest,
  type subscription as subscriptionSchema,
  taskPage,
  type task as taskSchema,
} from "@worker-protocol/schemas";
import type * as z from "zod";
import { type CallerOptions, caller, collect, Malformed, type Page, page } from "./call.ts";

/**
 * `@worker-protocol/client` — read a Worker, and take work from it.
 *
 * `consume(url)` reads a Descriptor once, resolves every address the Worker declared (DESC-36) and
 * answers an object with one member per Capability that Worker implements — and nothing for the
 * ones it does not, because DESC-34 admits any combination including none.
 *
 * **It is the other half of `mount()` and it carries the same kind of thing.** A consumer that
 * wrote this itself would write the address resolution, the paging and its cursor, the retry that
 * must not happen on a `reject`, and the classification of an answer it cannot read. All of that
 * is fixed by rules — nine of which oblige a consumer rather than a Worker — and `call.ts` cites
 * every one.
 *
 * It depends on `@worker-protocol/schemas` and on `fetch`, and on nothing else. A Tower, a teams
 * app or a Worker that consumes another Worker installs no web framework to do it.
 *
 * **Strict about what this protocol fixes, and blind to what it does not.** Every document
 * `schemas/` describes is validated, and a Worker that answers something else raises `Malformed`
 * naming the rule. A Task's payload, an Action's input and result, an event's data are the
 * Worker's own — this protocol has no data model — and nothing here looks inside them.
 */

export {
  type Call,
  type Caller,
  type CallerOptions,
  Malformed,
  type Page,
  Refused,
  Unserved,
} from "./call.ts";

type Descriptor = z.infer<typeof descriptorSchema>;
type Task = z.infer<typeof taskSchema>;
type Alert = z.infer<typeof alert>;
type Activity = z.infer<typeof activitySchema>;
type Bucket = z.infer<typeof metricBucket>;
type LogRecord = z.infer<typeof logRecord>;
type LogLevel = z.infer<typeof logLevel>;
type Subscription = z.infer<typeof subscriptionSchema>;
type SubscriptionRequest = z.infer<typeof subscriptionRequest>;

/**
 * Where a reading resumes: exactly the `nextCursor` a page answered (ENDP-21), or absent for the
 * first page. A continuation of one reading and not a bookmark — see `page` in `call.ts`.
 */
export type PageRead = { cursor?: string };

/** A list read whole, with the one page of it a caller that keeps its own cursor asks for. */
/**
 * One way to answer a Task or act on an Alert: the Action to post, the JSON Schema of what it takes,
 * and the values the Worker already filled in for it (TASK-37, ALRT-9), where it filled any in.
 *
 * `prefill` is the owner's proposal and binds nothing: a console renders it into the form as
 * editable values, and what is posted is judged as any input is.
 */
export type Offered = { action: string; input: unknown; prefill?: Record<string, unknown> };

export type Listed<T> = (() => Promise<T[]>) & {
  /** One page, and the cursor for the next one where there is more (ENDP-20). */
  page: (read?: PageRead) => Promise<Page<T>>;
};

/** What one Worker offers, read from its Descriptor and never guessed. */
export type Consumed = {
  /** The document itself, validated. Everything below was read out of it. */
  descriptor: Descriptor;
  /** DESC-23. The edition this Worker declares it speaks. */
  edition: string;
  health?: () => Promise<z.infer<typeof healthSchema>>;
  metrics?: {
    /** MET-8. One metric, every bucket in the interval, paged through (ENDP-20, ENDP-31). */
    read: (metric: string, options?: MetricRead) => Promise<Bucket[]>;
    /** One page of the same read, for a caller that keeps the cursor itself. */
    page: (metric: string, options?: MetricRead & PageRead) => Promise<Page<Bucket>>;
  };
  actions?: {
    /** ACT-5. The body is the input and carries nothing else. */
    perform: (name: string, input: unknown, options?: PerformOptions) => Promise<unknown>;
    /** ACT-21. The document `configure` would accept, where this Worker exposes one. */
    settings?: () => Promise<unknown>;
  };
  /** ALRT-2. The Alerts whose conditions hold, whole; `.page()` for one page of them. */
  alerts?: Listed<Alert> & {
    /**
     * What an operator can do about this Alert: each Action it offers that the `actions` entry
     * accepts, with its schema and the values the Alert filled in (ALRT-7, ALRT-9). In the order the
     * Alert lists them. A name the entry does not accept is left out, as `tasks.answers` leaves one.
     */
    offers: (alert: Alert) => Offered[];
  };
  /** ACTV-2. What the Worker is doing and has undertaken to do. Read, never written. */
  activity?: Listed<Activity>;
  /**
   * LOG-2. What the Worker recorded, most recent first (LOG-3), from the window it still holds.
   *
   * `read` pages to the end of that window; `page` answers one page. Neither says what is new since
   * a previous read: a cursor walks towards older records and a record carries no identity (LOG-4),
   * so a caller that wants only the new ones reads again from the head with `from` (LOG-8) and drops
   * the records at the boundary instant it already holds. That is the caller's, and it is said in
   * this package's README rather than done here, because `spec/` says nothing about it.
   */
  logs?: {
    read: (query?: LogRead) => Promise<LogRecord[]>;
    page: (query?: LogRead & PageRead) => Promise<Page<LogRecord>>;
  };
  /**
   * NDG-2. Tell this Worker there is work of a Task type it answers.
   *
   * The one write in this package that is not an Action, and the one whose body this protocol
   * fixes rather than the Worker: a type, and nothing else. It buys latency and nothing else —
   * TASK-19 recommends it and binds nobody, because a consumer reading on its own schedule is
   * slower and never wrong, while one that reads only when told is a single dropped request away
   * from stalling silently. So this answers nothing and is safe to lose.
   *
   * NDG-3: a type this Worker declares no Skill for is refused, and `Refused` carries the code.
   * `skills.canAnswer` in this package is how a caller knows before sending one.
   */
  nudges?: (type: string) => Promise<void>;
  /**
   * SUB-2 to SUB-9. Subscribe to this Worker's events, and the Worker pushes each one to `sink`.
   *
   * `subscribe` is idempotent by content (SUB-7): the same sink, types and filters find the
   * subscription that exists, so an orchestrator calls it on every deploy and keeps no id. Nothing
   * is renewed; a subscription ends when this caller ends it, when its sink has failed for the
   * Worker's `abandonAfterSeconds`, or when its Contract is revoked — and `list` shows which, and
   * why (SUB-15, SUB-16). The receiving end is `sink()` in this package.
   */
  subscriptions?: {
    /** SUB-2, SUB-7. `created` tells a new subscription (`201`) from one that existed (`200`). */
    subscribe: (request: SubscriptionRequest) => Promise<{ id: string; created: boolean }>;
    /** SUB-8. This caller's subscriptions, with their state. */
    list: () => Promise<Subscription[]>;
    /** SUB-9. Ends one of this caller's subscriptions; one that is not is refused (`Refused`). */
    unsubscribe: (id: string) => Promise<void>;
  };
  tasks?: {
    /**
     * TASK-5. Every Task whose condition holds that this credential covers.
     *
     * Answering one is `actions.perform` with an Action the Task type names, and there is nothing
     * to claim and nothing to close: the condition stops holding and the Task is gone.
     */
    list: (type?: string) => Promise<Task[]>;
    /** One page of the same read, for a caller that keeps the cursor itself. */
    page: (read?: { type?: string } & PageRead) => Promise<Page<Task>>;
    /**
     * How to answer a Task of this type, or this Task: each Action that answers it, and the shape
     * each takes.
     *
     * A Task carries its id, its type, its payload and when its condition began — and nothing about
     * how to answer it, because that belongs to the Worker that raised it and is declared twice
     * over in its Descriptor: the Task type names the Actions that answer it (TASK-35), and each
     * Action declares the JSON Schema of its input (ACT-2). Reading both is two walks down a
     * document a consumer already holds, and every consumer was doing them by hand.
     *
     * The schemas are handed back as they travel, so a console can render a form for each answer
     * and an agent can pick the one it can produce, neither having been told anything about this
     * Worker. In the order the Worker declared them.
     *
     * Handed a Task rather than a type, it answers for that Task now: only the Actions it says are
     * `available` (TASK-38), each with the values it already filled in as `prefill` (TASK-37).
     *
     * `undefined` where this Worker does not raise the type, and empty where no Action answers it.
     * A name its own `actions` entry does not accept is left out — a Descriptor disagreeing with
     * itself is the verifier's to report against that Worker, and handing back a call that would
     * answer `404` is not a consumer's job.
     */
    answers: (of: string | Task) => Offered[] | undefined;
  };
};

export type MetricRead = {
  granularity?: string;
  from?: Date;
  to?: Date;
  /** MET-19. Dimensions to break down by, each one that declared its set of values. */
  by?: string[];
  /** MET-16. Dimensions to fix, each spelled as a parameter of its own name. */
  fixed?: Record<string, string>;
};

/** LOG-7 and LOG-8. What a read of `logs` narrows to. */
export type LogRead = {
  /** LOG-7. A floor: this level and every level above it. */
  level?: LogLevel;
  /** LOG-8. Inclusive. */
  from?: Date;
  /** LOG-8. Exclusive. */
  to?: Date;
};

export type PerformOptions = {
  /** ENDP-38. Where the Action declares it reads a key from the header. */
  idempotencyKey?: string;
};

const rfc3339 = (at: Date) => at.toISOString().replace(/\.\d{3}Z$/, "Z");

export { type Carried, type Change, compare } from "./compare.ts";
export {
  memorySeen,
  type ReceivedEvent,
  type SeenStore,
  type SinkOptions,
  sink,
} from "./sink.ts";
export { type Compatibility, canAnswer } from "./skills.ts";

export async function consume(baseUrl: string, options: CallerOptions = {}): Promise<Consumed> {
  // DESC-35: the one route this protocol fixes, and the only address a consumer ever assembles.
  // Everything else is declared, which is what ENDP-1 buys and why nothing below concatenates.
  const descriptorUrl = new URL(
    ".well-known/worker-protocol",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
  const call = caller(descriptorUrl, options);

  const descriptor = await call.validated(
    { url: descriptorUrl, addressLevel: true },
    descriptorSchema,
    "DESC-1",
  );

  const entry = (name: string) =>
    descriptor.capabilities[name] as Record<string, unknown> | undefined;
  const addressOf = (name: string): string | undefined => {
    const declared = entry(name)?.address;
    return typeof declared === "string" ? call.resolve(declared) : undefined;
  };

  /**
   * The named Actions as a console needs them: each one the `actions` entry accepts, with its input
   * schema and the values already filled in for it. A name the entry does not accept is the
   * Worker's Descriptor disagreeing with itself — the verifier's to report, and no call to offer.
   */
  const offering = (names: string[], inputs?: Record<string, Record<string, unknown>>) => {
    const accepts = (entry("actions") as { accepts?: Record<string, { input: unknown }> })?.accepts;
    return names.flatMap((action): Offered[] => {
      const taken = accepts?.[action];
      if (taken === undefined) return [];
      const prefill = inputs?.[action];
      return [{ action, input: taken.input, ...(prefill === undefined ? {} : { prefill }) }];
    });
  };

  const consumed: Consumed = { descriptor, edition: descriptor.edition };

  const healthAddress = addressOf("health");
  if (healthAddress !== undefined) {
    consumed.health = () =>
      call.validated({ url: healthAddress, addressLevel: true }, healthSchema, "HLTH-2");
  }

  const metricsAddress = addressOf("metrics");
  if (metricsAddress !== undefined) {
    const metricRead = (metric: string, read: MetricRead) => {
      // MET-19 travels as a repeated parameter — `?by=a&by=b` — which is why it goes on the URL
      // here rather than into the flat record of single-valued parameters below.
      const url = new URL(metricsAddress);
      for (const dimension of read.by ?? []) url.searchParams.append("by", dimension);

      const parameters: Record<string, string> = { metric };
      if (read.granularity !== undefined) parameters.granularity = read.granularity;
      // MET-11: RFC 3339 instants carrying an offset, and the interval is half-open.
      if (read.from !== undefined) parameters.from = rfc3339(read.from);
      if (read.to !== undefined) parameters.to = rfc3339(read.to);
      // MET-16: a dimension is fixed with a parameter named exactly as the dimension.
      for (const [name, value] of Object.entries(read.fixed ?? {})) parameters[name] = value;

      return { url: url.toString(), parameters };
    };
    consumed.metrics = {
      read: async (metric, read = {}) => {
        const { url, parameters } = metricRead(metric, read);
        return collect<Bucket>(call, url, metricPage, "MET-14", parameters);
      },
      page: async (metric, { cursor, ...read } = {}) => {
        const { url, parameters } = metricRead(metric, read);
        return page<Bucket>(call, url, metricPage, "MET-14", parameters, cursor);
      },
    };
  }

  const actionsAddress = addressOf("actions");
  if (actionsAddress !== undefined) {
    const perform = async (name: string, input: unknown, perform: PerformOptions = {}) => {
      // ACT-5: a POST to the declared address, naming the Action in the query parameter, with the
      // body the input and nothing else. A resource-level 404 is ACT-6 and not DESC-38's.
      const url = new URL(actionsAddress);
      url.searchParams.set("action", name);
      const answered = await call.call({
        url: url.toString(),
        method: "POST",
        body: JSON.stringify(input),
        idempotencyKey: perform.idempotencyKey,
      });
      // ACT-10, ACT-18: `200` with the Action's own result, `204` with none, `202` where it does
      // not complete within the call. The result is the Worker's shape and is not validated.
      return answered.status === 200 ? answered.json : undefined;
    };

    consumed.actions = { perform };

    const configure = (entry("actions")?.accepts as Record<string, { readAddress?: string }>)
      ?.configure;
    if (typeof configure?.readAddress === "string") {
      const settingsUrl = call.resolve(configure.readAddress);
      // ACT-21: a GET answers a document `configure` would accept. Its shape is the Worker's own,
      // so this reads it and does not judge it.
      consumed.actions.settings = async () =>
        (await call.call({ url: settingsUrl, addressLevel: true })).json;
    }
  }

  const alertsAddress = addressOf("alerts");
  if (alertsAddress !== undefined) {
    consumed.alerts = Object.assign(
      () => collect<Alert>(call, alertsAddress, alertPage, "ALRT-2"),
      {
        page: ({ cursor }: PageRead = {}) =>
          page<Alert>(call, alertsAddress, alertPage, "ALRT-2", {}, cursor),
        offers: (alert: Alert) => offering(alert.actions, alert.inputs),
      },
    );
  }

  const activityAddress = addressOf("activity");
  if (activityAddress !== undefined) {
    consumed.activity = Object.assign(
      () => collect<Activity>(call, activityAddress, activityPage, "ACTV-2"),
      {
        page: ({ cursor }: PageRead = {}) =>
          page<Activity>(call, activityAddress, activityPage, "ACTV-2", {}, cursor),
      },
    );
  }

  const logsAddress = addressOf("logs");
  if (logsAddress !== undefined) {
    // LOG-7 passes the floor through as named — the ladder is the Worker's to expand — and LOG-8
    // spells the interval as MET-11 does. Nothing here re-sorts a page: LOG-6 has the caller read
    // the order it arrives in, never one rebuilt from the instant.
    const logParameters = (query: LogRead): Record<string, string> => {
      const parameters: Record<string, string> = {};
      if (query.level !== undefined) parameters.level = query.level;
      if (query.from !== undefined) parameters.from = rfc3339(query.from);
      if (query.to !== undefined) parameters.to = rfc3339(query.to);
      return parameters;
    };
    consumed.logs = {
      read: (query = {}) =>
        collect<LogRecord>(call, logsAddress, logPage, "LOG-2", logParameters(query)),
      page: ({ cursor, ...query } = {}) =>
        page<LogRecord>(call, logsAddress, logPage, "LOG-2", logParameters(query), cursor),
    };
  }

  const nudgesAddress = addressOf("nudges");
  if (nudgesAddress !== undefined) {
    // NDG-2: a POST carrying the type and nothing else, answered `204`. Nothing comes back, so
    // nothing is parsed — a body here would be the receiver holding state about work it has not
    // looked at, which is the lease `spec/tasks.md` withdrew arriving through another door.
    consumed.nudges = async (type) => {
      await call.call({ url: nudgesAddress, method: "POST", body: JSON.stringify({ type }) });
    };
  }

  const subscriptionsAddress = addressOf("subscriptions");
  if (subscriptionsAddress !== undefined) {
    consumed.subscriptions = {
      subscribe: async (request) => {
        // SUB-2: a POST whose body is the request and nothing else. SUB-10's handshake runs against
        // the sink before the Worker answers, so a sink that refused it is `422` here, at once.
        const answered = await call.call({
          url: subscriptionsAddress,
          method: "POST",
          body: JSON.stringify(request),
        });
        const receipt = subscriptionReceipt.safeParse(answered.json);
        if (!receipt.success) {
          throw new Malformed(
            "SUB-2",
            subscriptionsAddress,
            "the answer carried no subscription id",
          );
        }
        return { id: receipt.data.id, created: answered.status === 201 };
      },
      list: () => collect<Subscription>(call, subscriptionsAddress, subscriptionPage, "SUB-8"),
      unsubscribe: async (id) => {
        // SUB-9: a DELETE naming the subscription in a parameter on the declared address — never a
        // path built from the id, which ENDP-1 forbids a caller to assemble.
        const url = new URL(subscriptionsAddress);
        url.searchParams.set("subscription", id);
        await call.call({ url: url.toString(), method: "DELETE" });
      },
    };
  }

  const tasksAddress = addressOf("tasks");
  if (tasksAddress !== undefined) {
    consumed.tasks = {
      list: (type) =>
        // TASK-8 filters by type where one is asked for; absent, the read is unfiltered and a
        // `404` from it would be DESC-38's rather than a resource's, which `pages` works out.
        collect<Task>(call, tasksAddress, taskPage, "TASK-5", type === undefined ? {} : { type }),
      page: ({ type, cursor } = {}) =>
        page<Task>(
          call,
          tasksAddress,
          taskPage,
          "TASK-5",
          type === undefined ? {} : { type },
          cursor,
        ),

      // TASK-35 names the Actions; ACT-2 declares each one's input. Both are already in the
      // document this consumer read, so this walks it rather than calling anything.
      answers: (of) => {
        const raises = (entry("tasks") as { raises?: Record<string, { answeredBy?: string[] }> })
          ?.raises;
        const one = typeof of === "string" ? undefined : of;
        const raised = raises?.[one?.type ?? (of as string)];
        if (raised === undefined) return undefined;
        // TASK-38: what applies to this Task now, where it says; every answer of the type where not.
        const names = one?.available ?? raised.answeredBy ?? [];
        return offering(names, one?.inputs);
      },
    };
  }

  return consumed;
}

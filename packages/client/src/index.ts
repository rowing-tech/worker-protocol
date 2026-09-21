import {
  activityPage,
  type activity as activitySchema,
  type alert,
  alertPage,
  descriptor as descriptorSchema,
  health as healthSchema,
  type metricBucket,
  metricPage,
  taskPage,
  type task as taskSchema,
} from "@worker-protocol/schemas";
import type * as z from "zod";
import { type CallerOptions, caller, collect } from "./call.ts";

/**
 * `@worker-protocol/client` — read a Worker, and take work from it.
 *
 * `consume(url)` reads a Descriptor once, resolves every address the Worker declared (DESC-12) and
 * answers an object with one member per Capability that Worker implements — and nothing for the
 * ones it does not, because DESC-2 admits any combination including none.
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
  Refused,
  Unserved,
} from "./call.ts";

type Descriptor = z.infer<typeof descriptorSchema>;
type Task = z.infer<typeof taskSchema>;
type Alert = z.infer<typeof alert>;
type Activity = z.infer<typeof activitySchema>;
type Bucket = z.infer<typeof metricBucket>;

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
  };
  actions?: {
    /** ACT-5. The body is the input and carries nothing else. */
    perform: (name: string, input: unknown, options?: PerformOptions) => Promise<unknown>;
    /** ACT-15. The document `configure` would accept, where this Worker exposes one. */
    settings?: () => Promise<unknown>;
  };
  alerts?: () => Promise<Alert[]>;
  /** ACTV-2. What the Worker is doing and has undertaken to do. Read, never written. */
  activity?: () => Promise<Activity[]>;
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
  tasks?: {
    /**
     * TASK-5. Every Task whose condition holds that this credential covers.
     *
     * Answering one is `actions.perform` with an Action the Task type names, and there is nothing
     * to claim and nothing to close: the condition stops holding and the Task is gone.
     */
    list: (type?: string) => Promise<Task[]>;
    /**
     * How to answer a Task of this type: the Action to post, and the shape it takes.
     *
     * A Task carries its id, its type, its payload and when its condition began — and nothing about
     * how to answer it, because that belongs to the Worker that raised it and is declared twice
     * over in its Descriptor: the Task type names the Action that answers it (TASK-32), and that
     * Action declares the JSON Schema of its input (ACT-2). Reading both is two walks down a
     * document a consumer already holds, and every consumer was doing them by hand.
     *
     * The schema is handed back as it travels, so a console can render a form from it and an agent
     * can build the document, neither having been told anything about this Worker. Where the Task
     * can end several ways, that schema is a discriminated union and each ending is a variant.
     *
     * `undefined` where this Worker does not raise the type, or names an Action its own `actions`
     * entry does not accept — a Descriptor disagreeing with itself is the verifier's to report
     * against that Worker, and handing back a call that would answer `404` is not a consumer's job.
     */
    answers: (type: string) => { action: string; input: unknown } | undefined;
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

export type PerformOptions = {
  /** ENDP-15. Where the Action declares it reads a key from the header. */
  idempotencyKey?: string;
};

const rfc3339 = (at: Date) => at.toISOString().replace(/\.\d{3}Z$/, "Z");

export { type Compatibility, canAnswer } from "./skills.ts";

export async function consume(baseUrl: string, options: CallerOptions = {}): Promise<Consumed> {
  // DESC-3: the one route this protocol fixes, and the only address a consumer ever assembles.
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

  const consumed: Consumed = { descriptor, edition: descriptor.edition };

  const healthAddress = addressOf("health");
  if (healthAddress !== undefined) {
    consumed.health = () =>
      call.validated({ url: healthAddress, addressLevel: true }, healthSchema, "HLTH-2");
  }

  const metricsAddress = addressOf("metrics");
  if (metricsAddress !== undefined) {
    consumed.metrics = {
      read: async (metric, read = {}) => {
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

        return collect<Bucket>(call, url.toString(), metricPage, "MET-14", parameters);
      },
    };
  }

  const actionsAddress = addressOf("actions");
  if (actionsAddress !== undefined) {
    const perform = async (name: string, input: unknown, perform: PerformOptions = {}) => {
      // ACT-5: a POST to the declared address, naming the Action in the query parameter, with the
      // body the input and nothing else. A resource-level 404 is ACT-6 and not DESC-30's.
      const url = new URL(actionsAddress);
      url.searchParams.set("action", name);
      const answered = await call.call({
        url: url.toString(),
        method: "POST",
        body: JSON.stringify(input),
        idempotencyKey: perform.idempotencyKey,
      });
      // ACT-10, ACT-11: `200` with the Action's own result, `204` with none, `202` where it does
      // not complete within the call. The result is the Worker's shape and is not validated.
      return answered.status === 200 ? answered.json : undefined;
    };

    consumed.actions = { perform };

    const configure = (entry("actions")?.accepts as Record<string, { readAddress?: string }>)
      ?.configure;
    if (typeof configure?.readAddress === "string") {
      const settingsUrl = call.resolve(configure.readAddress);
      // ACT-15: a GET answers a document `configure` would accept. Its shape is the Worker's own,
      // so this reads it and does not judge it.
      consumed.actions.settings = async () =>
        (await call.call({ url: settingsUrl, addressLevel: true })).json;
    }
  }

  const alertsAddress = addressOf("alerts");
  if (alertsAddress !== undefined) {
    consumed.alerts = () => collect<Alert>(call, alertsAddress, alertPage, "ALRT-2");
  }

  const activityAddress = addressOf("activity");
  if (activityAddress !== undefined) {
    consumed.activity = () => collect<Activity>(call, activityAddress, activityPage, "ACTV-2");
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

  const tasksAddress = addressOf("tasks");
  if (tasksAddress !== undefined) {
    consumed.tasks = {
      list: (type) =>
        // TASK-8 filters by type where one is asked for; absent, the read is unfiltered and a
        // `404` from it would be DESC-30's rather than a resource's, which `pages` works out.
        collect<Task>(call, tasksAddress, taskPage, "TASK-5", type === undefined ? {} : { type }),

      // TASK-32 names the Action; ACT-2 declares its input. Both are already in the document this
      // consumer read, so this walks it rather than calling anything.
      answers: (type) => {
        const raises = (entry("tasks") as { raises?: Record<string, { answeredBy: string }> })
          ?.raises;
        const accepts = (entry("actions") as { accepts?: Record<string, { input: unknown }> })
          ?.accepts;
        const action = raises?.[type]?.answeredBy;
        if (action === undefined) return undefined;
        const taken = accepts?.[action];
        return taken === undefined ? undefined : { action, input: taken.input };
      },
    };
  }

  return consumed;
}

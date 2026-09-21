import {
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
import { type CallerOptions, caller, pages } from "./call.ts";

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
  tasks?: {
    /**
     * TASK-5. Every Task whose condition holds that this credential covers.
     *
     * Answering one is `actions.perform` with an Action the Task type names (TASK-2), and there is
     * nothing to claim and nothing to close: the condition stops holding and the Task is gone.
     */
    list: (type?: string) => Promise<Task[]>;
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

        const buckets: Bucket[] = [];
        for await (const page of pages(call, url.toString(), metricPage, "MET-14", parameters)) {
          buckets.push(...page);
        }
        return buckets;
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

    const configure = (entry("actions")?.actions as Record<string, { readAddress?: string }>)
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
    consumed.alerts = async () => {
      const held: Alert[] = [];
      for await (const page of pages(call, alertsAddress, alertPage, "ALRT-2")) held.push(...page);
      return held;
    };
  }

  const tasksAddress = addressOf("tasks");
  if (tasksAddress !== undefined) {
    consumed.tasks = {
      list: async (type) => {
        const held: Task[] = [];
        // TASK-8 filters by type where one is asked for; absent, the read is unfiltered and a
        // `404` from it would be DESC-30's rather than a resource's, which `pages` works out.
        const parameters: Record<string, string> = type === undefined ? {} : { type };
        for await (const page of pages(call, tasksAddress, taskPage, "TASK-5", parameters)) {
          held.push(...page);
        }
        return held;
      },
    };
  }

  return consumed;
}

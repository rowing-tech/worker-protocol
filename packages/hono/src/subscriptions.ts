/**
 * The `subscriptions` surface, and what a Worker needs to push its events to whoever subscribed.
 *
 * `mount()` carries the address: who may subscribe to what, the sink rules, the handshake, the
 * idempotence, the caller scope (SUB-2 to SUB-10). `eventHub()` carries the push: matching an event
 * against every subscription that names its type, and delivering it with the retry decisions SUB-12
 * fixes, ending a subscription that is abandoned or revoked (SUB-14, SUB-15).
 *
 * **What depends on the platform is behind two interfaces, on `OutcomeStore`'s pattern.** A
 * `SubscriptionStore` keeps the subscriptions and has to be consistent, because subscribing is
 * idempotent (SUB-7) and two requests for the same thing must find one subscription. A
 * `DeliveryQueue` carries each delivery to whatever runs `deliver()` — a Cloudflare Queue, which
 * already retries with a delay, or the memory one below in a single process.
 */

import {
  alert as alertSchema,
  alertSeverity,
  extensionName,
  qualifiedName,
  type SubscriptionFilter,
  type subscriptionEndReason,
  subscriptionRequest,
  task as taskSchema,
} from "@worker-protocol/schemas";
import * as z from "zod";
import { readJson, schemaMismatch } from "./actions.ts";
import { rfc3339 } from "./buckets.ts";
import type { ErrorCode } from "./codes.ts";
import type { OpenTask } from "./tasks.ts";
import type { Alert, Answer, EventTypeDeclaration, Refusal, Worker } from "./worker.ts";

/** SUB-15: why a subscription ended without its subscriber ending it. */
export type EndReason = z.infer<typeof subscriptionEndReason>;

/** One subscription as a store holds it. Instants are epoch milliseconds on the Worker's clock. */
export type StoredSubscription = {
  id: string;
  /** SUB-8: the caller that created it, or `null` where `authenticate` names none. */
  caller: string | null;
  types: string[];
  filters?: SubscriptionFilter[];
  sink: string;
  /** SUB-11: presented on every delivery, and never listed back. */
  sinkCredential: string;
  createdAt: number;
  lastDeliveredAt?: number;
  failingSince?: number;
  endedAt?: number;
  reason?: EndReason;
};

/**
 * Where a Worker keeps its subscriptions.
 *
 * **It has to be consistent**, because SUB-7 makes subscribing idempotent: two requests naming the
 * same caller, sink, types and filters must find one subscription and never make two. `ensure` is
 * that operation and takes the place of a read followed by a write, for `OutcomeStore`'s reason. A
 * Durable Object is consistent by construction; a KV namespace is not.
 */
export type SubscriptionStore = {
  /** The live subscription stored under this key, if any. An ended one is not returned. */
  find: (key: string) => Promise<StoredSubscription | undefined> | StoredSubscription | undefined;
  /**
   * The live subscription under `key`, or `candidate` stored under it — in one operation. An ended
   * subscription under the key is replaced, because subscribing again after an ending creates a new
   * subscription (SUB-15).
   */
  ensure: (
    key: string,
    candidate: StoredSubscription,
  ) =>
    | Promise<{ subscription: StoredSubscription; created: boolean }>
    | { subscription: StoredSubscription; created: boolean };
  get: (id: string) => Promise<StoredSubscription | undefined> | StoredSubscription | undefined;
  /** SUB-8: every subscription of one caller, ended ones included until they are removed. */
  list: (caller: string | null) => Promise<StoredSubscription[]> | StoredSubscription[];
  /** The live subscriptions naming this event type. */
  forType: (type: string) => Promise<StoredSubscription[]> | StoredSubscription[];
  /**
   * Several by id in one read, ended ones included, missing ones left out. Optional: where a store
   * has it, a batch of deliveries reads each subscription once in one call rather than one call
   * per delivery.
   */
  getMany?: (ids: string[]) => Promise<StoredSubscription[]> | StoredSubscription[];
  /** Sets every member the patch names; one named with `undefined` is cleared. */
  update: (id: string, patch: Partial<StoredSubscription>) => Promise<void> | void;
  remove: (id: string) => Promise<void> | void;
};

/** One delivery in flight: which subscription, which event, and how many attempts so far. */
export type Delivery = {
  subscription: string;
  event: CloudEvent;
  /** When the event was published, which is what EVT-8's window is counted from (SUB-12). */
  publishedAt: number;
  /** 1 for the first attempt. The queue counts them. */
  attempt: number;
};

/**
 * Why a delivery was given up while its subscription still wanted it: the sink refused it for good
 * (SUB-12), EVT-8's window closed before it could arrive, or the subscription itself was abandoned
 * on this attempt (SUB-14). `status` is the sink's last answer, `null` where none came.
 */
export type GaveUp = { reason: "refused" | "expired" | "abandoned"; status: number | null };

/**
 * What `deliver()` decided: finished, or try again after this many seconds. A delivery finished
 * without arriving says so in `gaveUp`, so whatever carries it can keep the event for somebody to
 * inspect — a delivery that is simply no longer owed, to a subscription since ended, carries none.
 */
export type DeliveryOutcome = { done: true; gaveUp?: GaveUp } | { retryAfterSeconds: number };

/** Carries a delivery to whatever runs `deliver()` on it, and retries it when told to. */
export type DeliveryQueue = {
  /** One delivery, after `delaySeconds` where it says — a retry the hub asked to be made later. */
  send: (delivery: Delivery, options?: { delaySeconds?: number }) => Promise<void> | void;
  /** Many at once, where the carrier can: a Cloudflare Queue takes a hundred in one call. */
  sendBatch?: (deliveries: Delivery[]) => Promise<void> | void;
};

/** What a call to the address knows about who is calling. */
type SubscriptionCall = {
  caller: string | null;
  token: string | undefined;
  principal: unknown;
};

/**
 * What a Worker declares and hands `mount()` for `subscriptions`.
 */
export type SubscriptionFacts = {
  /** SUB-1. How long a sink may fail without interruption before its subscription ends. */
  abandonAfterSeconds: number;
  store: SubscriptionStore;
  queue: DeliveryQueue;
  /**
   * SUB-4. Whether the caller's Contract lets it consume this type. Absent, every caller may
   * subscribe to every type the entry publishes — right for a Worker whose callers are all its own.
   */
  allows?: (asked: SubscriptionCall & { type: string }) => boolean | Promise<boolean>;
  /**
   * SUB-14. Whether the Worker still accepts this caller, by the identity `authenticate` names.
   * Asked before every delivery; a no ends the subscription as `revoked`. Absent, a subscription
   * ends only by its subscriber or by abandonment. The subscriber's credential is never stored to
   * ask instead: a rotated credential would end a subscription whose caller is still entitled.
   */
  accepts?: (caller: string | null) => boolean | Promise<boolean>;
  /**
   * The sink origins exempted from SUB-5 and SUB-6, for development and nothing else — a local
   * backend at `http://127.0.0.1:3211`, say. A Worker running with any breaks both rules for those
   * origins on purpose, as a test over loopback breaks DESC-35. Every other sink is held to them.
   */
  insecureSinkOrigins?: string[];
  /**
   * How long one attempt at a sink may take before it counts as failed, in milliseconds. A sink
   * that answers slower than this is retried as one that did not answer, which bounds how long it
   * holds a batch beside other subscribers' events. Defaults to ten seconds.
   */
  attemptTimeoutMs?: number;
  /** For tests and for a runtime that needs its own agent. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
};

/** A CloudEvent as it travels in structured mode: the attributes and `data` in one object. */
export type CloudEvent = {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: "application/json";
  subject?: string;
  data: unknown;
  [extension: string]: unknown;
};

/** What a Worker publishes: the type, the subject, the data, and any extension attributes. */
export type Publishable = {
  type: string;
  subject?: string;
  data: unknown;
  /**
   * Extension attributes, each one its type declares (EVT-17, EVT-18): lower-case letters and
   * digits, no CloudEvents context attribute (EVT-19), and a value its schema accepts.
   */
  extensions?: Record<string, string | number | boolean>;
  /**
   * EVT-1, EVT-8. The id this event already has, for a Worker that publishes from an outbox and may
   * publish one row twice — a delivery queued and the broker then down, say. Under the same `source`
   * and `id` a republish is one event to every consumer; under a fresh id it would be two. Absent, a
   * new one is drawn.
   */
  id?: string;
  /** When the Fact occurred, where that is not the moment of publishing: an outbox row's instant. */
  time?: number | Date;
};

// ---- the six dialects ---------------------------------------------------------------------------

/** The value of one context attribute as a filter compares it, or `undefined` if not carried. */
const attribute = (event: CloudEvent, name: string): string | undefined => {
  const value = event[name];
  return value === undefined || value === null || typeof value === "object"
    ? undefined
    : String(value);
};

/** An `exact`, `prefix` or `suffix` map as a test of an event: every pair must match. */
const every =
  (map: Record<string, string>, test: (value: string, wanted: string) => boolean) =>
  (event: CloudEvent): boolean =>
    Object.entries(map).every(([name, wanted]) => {
      const value = attribute(event, name);
      return value !== undefined && test(value, wanted);
    });

/** SUB-13: whether one filter holds for an event. An attribute the event does not carry matches nothing. */
export const holds = (filter: SubscriptionFilter, event: CloudEvent): boolean => {
  if ("exact" in filter) return every(filter.exact, (value, wanted) => value === wanted)(event);
  if ("prefix" in filter) return every(filter.prefix, (value, w) => value.startsWith(w))(event);
  if ("suffix" in filter) return every(filter.suffix, (value, w) => value.endsWith(w))(event);
  if ("all" in filter) return filter.all.every((nested) => holds(nested, event));
  if ("any" in filter) return filter.any.some((nested) => holds(nested, event));
  return !holds(filter.not, event);
};

/** SUB-13: whether every filter in the list holds, which is how a list combines. */
export const matches = (filters: SubscriptionFilter[] | undefined, event: CloudEvent): boolean =>
  (filters ?? []).every((filter) => holds(filter, event));

// ---- the lifecycle of Tasks and Alerts (EVT-15) -------------------------------------------------

/** The four types EVT-15 names, under the specification's own namespace (NAME-8). */
export const LIFECYCLE = {
  taskRaised: "tech.rowing.worker-protocol.task-raised",
  taskEnded: "tech.rowing.worker-protocol.task-ended",
  alertRaised: "tech.rowing.worker-protocol.alert-raised",
  alertEnded: "tech.rowing.worker-protocol.alert-ended",
} as const;

/** EVT-15: a Task began. `subject` is its id; `tasktype` is what a subscriber filters on. */
export const taskRaised = (task: OpenTask): Publishable => ({
  type: LIFECYCLE.taskRaised,
  subject: task.id,
  extensions: { tasktype: task.type },
  data: {
    id: task.id,
    type: task.type,
    payload: task.payload,
    since: rfc3339(task.since),
    ...(task.inputs === undefined ? {} : { inputs: task.inputs }),
    ...(task.available === undefined ? {} : { available: task.available }),
  },
});

/** EVT-15: a Task ended — for whatever reason, and nobody closed it. */
export const taskEnded = (task: Pick<OpenTask, "id" | "type">): Publishable => ({
  type: LIFECYCLE.taskEnded,
  subject: task.id,
  extensions: { tasktype: task.type },
  data: { id: task.id, type: task.type },
});

/** EVT-15: an Alert began. `subject` is its id; `alertseverity` is what a subscriber filters on. */
export const alertRaised = (alert: Alert): Publishable => ({
  type: LIFECYCLE.alertRaised,
  subject: alert.id,
  extensions: { alertseverity: alert.severity },
  data: { ...alert, since: rfc3339(alert.since) },
});

/** EVT-15: an Alert ended (ALRT-8), and nobody dismissed it. */
export const alertEnded = (alert: Pick<Alert, "id" | "severity">): Publishable => ({
  type: LIFECYCLE.alertEnded,
  subject: alert.id,
  extensions: { alertseverity: alert.severity },
  data: { id: alert.id, severity: alert.severity },
});

/**
 * EVT-15, EVT-17: the declarations of the lifecycle types, for `events.publishes`.
 *
 * Each with the `data` EVT-15's table gives and the one extension a subscriber filters it by, so a
 * Worker that publishes them declares what it sends without writing either again. Spread them
 * beside the Worker's own types; one that carries more `data` than the table declares its own.
 */
export const lifecycleEvents = (which: {
  tasks?: boolean;
  alerts?: boolean;
}): Record<string, EventTypeDeclaration> => ({
  ...(which.tasks
    ? {
        [LIFECYCLE.taskRaised]: { data: taskSchema, extensions: { tasktype: qualifiedName } },
        [LIFECYCLE.taskEnded]: {
          data: z.object({ id: z.string(), type: qualifiedName }),
          extensions: { tasktype: qualifiedName },
        },
      }
    : {}),
  ...(which.alerts
    ? {
        [LIFECYCLE.alertRaised]: {
          data: alertSchema,
          extensions: { alertseverity: alertSeverity },
        },
        [LIFECYCLE.alertEnded]: {
          data: z.object({ id: z.string(), severity: alertSeverity }),
          extensions: { alertseverity: alertSeverity },
        },
      }
    : {}),
});

/**
 * What appeared and what disappeared between two snapshots, by id.
 *
 * Nothing calls it and it keeps nothing. It is for a Worker that chooses to find its transitions by
 * comparing snapshots, and accepts what that costs: a Task that came and went between two of them
 * is never seen, and the moment is when the comparison ran rather than when the Fact changed. Only
 * the Worker knows when a Task is born, which is why the SDK builds lifecycle events and never
 * detects them.
 */
export const lifecycleChanges = <T extends { id: string }>(snapshots: {
  previous: T[];
  current: T[];
}): { raised: T[]; ended: T[] } => {
  const before = new Set(snapshots.previous.map((one) => one.id));
  const now = new Set(snapshots.current.map((one) => one.id));
  return {
    raised: snapshots.current.filter((one) => !before.has(one.id)),
    ended: snapshots.previous.filter((one) => !now.has(one.id)),
  };
};

// ---- the push -----------------------------------------------------------------------------------

/** The type of the one event a subscriber is sent when its subscription ends without its doing. */
export const SUBSCRIPTION_ENDED = "tech.rowing.worker-protocol.subscription-ended";

/** SUB-12: whether an answer is worth retrying. A network failure is, and arrives as `null`. */
const retryable = (status: number | null): boolean =>
  status === null || status >= 500 || status === 408 || status === 429;

/** `Retry-After` as seconds, from either form it may take, or `undefined`. */
const retryAfter = (header: string | null, now: number): number | undefined => {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
};

/**
 * EVT-1: the CloudEvent a published event becomes, in structured mode, as the hub sends it — the
 * Worker's id as `source`, a fresh id where the event has none, and its extensions beside the
 * context attributes, which EVT-19 keeps from colliding with them.
 */
export const envelopeOf = (given: {
  source: string;
  published: Publishable;
  /** The instant of publishing, which is the event's `time` where it carries none of its own. */
  at: number;
}): CloudEvent => {
  const { source, published, at } = given;
  return {
    ...published.extensions,
    specversion: "1.0",
    id: published.id ?? crypto.randomUUID(),
    source,
    type: published.type,
    time: rfc3339(published.time ?? at),
    datacontenttype: "application/json",
    ...(published.subject === undefined ? {} : { subject: published.subject }),
    data: published.data,
  };
};

/**
 * Which of these events at least one of the given live subscriptions would receive: one that names
 * its type and whose filters hold (SUB-13), read off the envelope the hub would send, so a filter
 * sees the same attributes here as at publishing. Synchronous and with no hub, for the place that
 * holds the subscriptions and decides what enters an outbox — a Durable Object with
 * `withSubscriptions`, inside the transaction of the write that raised the events.
 *
 * `subscribed` answers the live subscriptions naming one type, and is asked once per type. It
 * answers for subscriptions and nothing else: a Worker that also publishes to a broker (EVT-13)
 * still owes the broker every event.
 */
export const wantedBy = (given: {
  /** The Worker's id, which is every event's `source` (EVT-1). */
  source: string;
  subscribed: (type: string) => StoredSubscription[];
  events: Publishable[];
}): boolean[] => {
  const { source, subscribed, events } = given;
  const at = Date.now();
  const byType = new Map<string, StoredSubscription[]>();
  const live = (type: string) => {
    let held = byType.get(type);
    if (held === undefined) {
      held = subscribed(type);
      byType.set(type, held);
    }
    return held;
  };
  return events.map((published) => {
    const subscriptions = live(published.type);
    if (subscriptions.length === 0) return false;
    // An id is only drawn for an event that has none, and a filter on `id` is meaningless then.
    const event = envelopeOf({ source, published: { ...published, id: published.id ?? "" }, at });
    return subscriptions.some((one) => matches(one.filters, event));
  });
};

/**
 * The part of a Worker's declaration the push reads: who publishes, what, and to whom.
 *
 * The same objects the Worker hands `mount()`, and not values copied out of them, because a copy is
 * a second place to disagree: an event's `source` is the Worker's id (EVT-1), every retry is bound
 * by the window its `events` entry declares (EVT-8, SUB-12), and what it publishes is what that
 * entry lists (EVT-12) — read from the one declaration the Descriptor is written from.
 */
export type Publisher = {
  id: Worker["id"];
  events: Pick<NonNullable<Worker["events"]>, "publishes"> & { republishWindowSeconds: number };
  subscriptions: SubscriptionFacts;
};

/**
 * What publishes a Worker's events and delivers them. The Worker calls `publish` from its own code
 * when a Fact changes, and whatever consumes its `DeliveryQueue` calls `deliver` on each delivery.
 */
export function eventHub(worker: Publisher) {
  const { id: source, events, subscriptions: facts } = worker;
  const { republishWindowSeconds } = events;
  const declared = new Set(Object.keys(events.publishes));

  // EVT-19, refused where the author is still looking: a name CloudEvents reserves would be lost
  // in the envelope below without a word, and nothing later could tell which value went.
  for (const [type, declaration] of Object.entries(events.publishes)) {
    for (const name of Object.keys(declaration.extensions ?? {})) {
      if (!extensionName.safeParse(name).success) {
        throw new Error(
          `EVT-19: ${type} declares the extension \`${name}\`, which is not lower-case letters ` +
            "and digits or is a CloudEvents context attribute.",
        );
      }
    }
  }

  /**
   * EVT-12, EVT-18: why one event cannot be published as declared, or `undefined` where it can. A
   * type the entry does not declare, an extension its type does not declare, or a value that
   * extension's schema refuses — each a mistake in the Worker's own code, which no retry mends.
   */
  const fault = (one: Publishable): string | undefined => {
    const declaration = events.publishes[one.type];
    if (declaration === undefined) {
      return `EVT-12: ${one.type} is not declared under \`events.publishes\`.`;
    }
    for (const [name, value] of Object.entries(one.extensions ?? {})) {
      const schema = declaration.extensions?.[name];
      if (schema === undefined) return `EVT-18: ${one.type} declares no extension \`${name}\`.`;
      if (!schema.safeParse(value).success) {
        return `EVT-18: \`${name}\` on ${one.type} carries a value its schema refuses.`;
      }
    }
    return undefined;
  };
  const send = facts.fetch ?? globalThis.fetch;
  const timeoutMs = facts.attemptTimeoutMs ?? 10_000;

  /**
   * SUB-11: one event to one sink, structured mode, the sink's own credential. `null` is no answer
   * — a network failure, or a sink slower than the attempt may take.
   */
  const post = async (sink: StoredSubscription, event: CloudEvent) => {
    try {
      return await send(sink.sink, {
        method: "POST",
        headers: {
          "content-type": "application/cloudevents+json",
          authorization: `Bearer ${sink.sinkCredential}`,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return null;
    }
  };

  const envelope = (published: Publishable, at: number): CloudEvent =>
    envelopeOf({ source, published, at });

  /** SUB-15: the subscription ends, one attempt at telling its sink, and it stays listed. */
  const end = async (subscription: StoredSubscription, reason: EndReason) => {
    const at = Date.now();
    await facts.store.update(subscription.id, { endedAt: at, reason });
    await post(
      subscription,
      envelope(
        {
          type: SUBSCRIPTION_ENDED,
          subject: subscription.id,
          data: { reason, since: rfc3339(at) },
        },
        at,
      ),
    );
  };

  /** The live subscriptions naming each type, read once per type rather than once per event. */
  const subscribedTo = async (types: string[]) =>
    new Map(
      await Promise.all(
        [...new Set(types)].map(async (type) => [type, await facts.store.forType(type)] as const),
      ),
    );

  /**
   * The events as they will be sent, and one delivery per live subscription that names each type
   * and whose filters hold (SUB-13) — computed, and nothing sent. A type the `events` entry does
   * not declare, or an extension its type does not, is refused first: publishing it would break
   * EVT-12 or EVT-18, and the mistake is in the Worker's own code, where a throw is what reaches
   * whoever wrote it.
   */
  const route = async (
    batch: Publishable[],
  ): Promise<{ events: CloudEvent[]; deliveries: Delivery[] }> => {
    for (const one of batch) {
      const refused = fault(one);
      if (refused !== undefined) throw new Error(refused);
    }
    const at = Date.now();
    const events = batch.map((one) => envelope(one, at));
    const subscribed = await subscribedTo(events.map((event) => event.type));
    const deliveries = events.flatMap((event) =>
      (subscribed.get(event.type) ?? [])
        .filter((one) => matches(one.filters, event))
        .map((one) => ({ subscription: one.id, event, publishedAt: at, attempt: 1 })),
    );
    return { events, deliveries };
  };

  /** Hands deliveries to the queue, together where it can: the queue promises no order. */
  const enqueue = async (deliveries: Delivery[]) => {
    if (deliveries.length === 0) return;
    if (facts.queue.sendBatch !== undefined) await facts.queue.sendBatch(deliveries);
    else await Promise.all(deliveries.map((one) => facts.queue.send(one)));
  };

  /** Publishes every event to every subscription it reaches, through the queue. */
  const publishAll = async (batch: Publishable[]): Promise<CloudEvent[]> => {
    const { events, deliveries } = await route(batch);
    await enqueue(deliveries);
    return events;
  };

  /**
   * One attempt at each delivery, and what to do next with each, in the order given (SUB-12,
   * SUB-14). Each subscription is read once however many of its deliveries the batch carries, and
   * written once at the end with what the attempts left it with; an ending is written at once,
   * because it is announced to the sink at once.
   */
  const deliverAll = async (deliveries: Delivery[]): Promise<DeliveryOutcome[]> => {
    const done = { done: true } as const;
    const ids = [...new Set(deliveries.map((one) => one.subscription))];
    const read =
      facts.store.getMany !== undefined
        ? await facts.store.getMany(ids)
        : (await Promise.all(ids.map((id) => facts.store.get(id)))).filter(
            (one): one is StoredSubscription => one !== undefined,
          );
    const held = new Map(read.map((one) => [one.id, { ...one }]));
    const patches = new Map<string, Partial<StoredSubscription>>();
    const accepted = new Map<string | null, Promise<boolean>>();
    const patch = (id: string, change: Partial<StoredSubscription>) =>
      patches.set(id, { ...patches.get(id), ...change });

    const attempt = async (delivery: Delivery): Promise<DeliveryOutcome> => {
      const subscription = held.get(delivery.subscription);
      if (subscription === undefined || subscription.endedAt !== undefined) return done;

      // SUB-14: a caller the Worker no longer accepts has no subscription, whatever its sink says.
      if (facts.accepts !== undefined) {
        const asked = accepted.get(subscription.caller) ?? facts.accepts(subscription.caller);
        accepted.set(subscription.caller, Promise.resolve(asked));
        if (!(await asked)) {
          if (subscription.endedAt === undefined) {
            subscription.endedAt = Date.now();
            await end(subscription, "revoked");
          }
          return done;
        }
      }

      const now = Date.now();
      const closes = delivery.publishedAt + republishWindowSeconds * 1000;
      const expired = now >= closes;
      // `null` is no answer; `undefined`, an event whose window closed before an attempt.
      const answer = expired ? undefined : await post(subscription, delivery.event);

      if (answer?.ok) {
        subscription.lastDeliveredAt = now;
        subscription.failingSince = undefined;
        patch(subscription.id, { lastDeliveredAt: now, failingSince: undefined });
        return done;
      }

      // A failure, or an event whose window closed before it could be delivered. Either way the
      // sink is not receiving, and SUB-14 counts how long that has gone on without interruption.
      const failingSince = subscription.failingSince ?? now;
      if (subscription.failingSince === undefined) {
        subscription.failingSince = failingSince;
        patch(subscription.id, { failingSince });
      }
      const status = answer?.status ?? null;
      const giveUp = (reason: GaveUp["reason"]): DeliveryOutcome => ({
        done: true,
        gaveUp: { reason, status },
      });
      if (now - failingSince >= facts.abandonAfterSeconds * 1000) {
        if (subscription.endedAt === undefined) {
          subscription.endedAt = now;
          await end(subscription, "abandoned");
        }
        return giveUp("abandoned");
      }
      if (expired) return giveUp("expired");
      if (!retryable(status)) return giveUp("refused");

      // SUB-12: backoff, or what the sink asked for, and never past EVT-8's window.
      const asked = retryAfter(answer?.headers.get("retry-after") ?? null, now);
      const wait = asked ?? Math.min(2 ** delivery.attempt, 3600);
      return now + wait * 1000 < closes ? { retryAfterSeconds: wait } : giveUp("expired");
    };

    const outcomes = await Promise.all(deliveries.map(attempt));
    await Promise.all(
      [...patches].map(([id, change]) =>
        // An ending was written as it happened; what is left is the delivery bookkeeping.
        facts.store.update(id, change),
      ),
    );
    return outcomes;
  };

  return {
    publishAll,
    route,
    deliverAll,

    /**
     * EVT-12: whether the `events` entry declares this type — what `publishAll` refuses a batch
     * over. A carrier asks first, so one undeclared event is set aside rather than failing the
     * events beside it.
     */
    declares: (type: string): boolean => declared.has(type),

    /**
     * EVT-12, EVT-18: why this event cannot be published as declared, or `undefined`. A carrier
     * asks it of each event, so one the Worker got wrong is set aside with the reason rather than
     * failing the batch beside it.
     */
    fault,

    /** `publishAll` for one event, which is how a Worker publishing as Facts change calls it. */
    async publish(published: Publishable): Promise<CloudEvent> {
      const [event] = await publishAll([published]);
      return event as CloudEvent;
    },

    /** One delivery attempt, and what to do next (SUB-12, SUB-14). */
    async deliver(delivery: Delivery): Promise<DeliveryOutcome> {
      const [outcome] = await deliverAll([delivery]);
      return outcome as DeliveryOutcome;
    },

    /**
     * A delivery handed back to the queue for a later attempt, after `delaySeconds` — what a
     * carrier that made the attempt itself does with an outcome that asks for a retry.
     */
    later: async (delivery: Delivery, delaySeconds?: number): Promise<void> => {
      await facts.queue.send(delivery, delaySeconds === undefined ? undefined : { delaySeconds });
    },

    /**
     * SUB-14, SUB-15: the Worker ends a subscription itself — `withdrawn` when it stops publishing
     * what was subscribed to, `revoked` when it stops accepting the caller. It stays listed, and
     * its sink is told once. A subscription already ended, or none under that id, is left alone;
     * the answer says whether this call ended it.
     */
    end: async (id: string, reason: EndReason): Promise<boolean> => {
      const subscription = await facts.store.get(id);
      if (subscription === undefined || subscription.endedAt !== undefined) return false;
      await end(subscription, reason);
      return true;
    },

    /**
     * Which of these events at least one live subscription would receive now, in order: one that
     * names its type and whose filters hold (SUB-13). For a Worker that keeps an outbox and wants
     * to leave out what nobody is subscribed to before it is ever stored. It answers for
     * subscriptions and nothing else — a Worker that also publishes to a broker (EVT-13) still
     * owes the broker every event — and for now, so a subscription made between this answer and
     * the publish does not see what was left out.
     */
    wanted: async (batch: Publishable[]): Promise<boolean[]> => {
      const subscribed = await subscribedTo(batch.map((one) => one.type));
      return wantedBy({ source, subscribed: (type) => subscribed.get(type) ?? [], events: batch });
    },
  };
}

// ---- in one process -----------------------------------------------------------------------------

/**
 * A store in memory: right in one long-lived process, and wrong everywhere else — the same terms
 * as `memoryOutcomes()`. Consistent by construction, because JavaScript does not interleave here.
 */
export const memorySubscriptions = (): SubscriptionStore => {
  const byId = new Map<string, StoredSubscription>();
  const byKey = new Map<string, string>();
  const live = (id: string | undefined) => {
    const found = id === undefined ? undefined : byId.get(id);
    return found?.endedAt === undefined ? found : undefined;
  };
  return {
    find: (key) => live(byKey.get(key)),
    ensure: (key, candidate) => {
      const existing = live(byKey.get(key));
      if (existing !== undefined) return { subscription: existing, created: false };
      byId.set(candidate.id, { ...candidate });
      byKey.set(key, candidate.id);
      return { subscription: candidate, created: true };
    },
    get: (id) => byId.get(id),
    list: (caller) => [...byId.values()].filter((one) => one.caller === caller),
    forType: (type) =>
      [...byId.values()].filter((one) => one.endedAt === undefined && one.types.includes(type)),
    update: (id, patch) => {
      const found = byId.get(id);
      if (found === undefined) return;
      const next: Record<string, unknown> = { ...found };
      for (const [name, value] of Object.entries(patch)) {
        if (value === undefined) delete next[name];
        else next[name] = value;
      }
      byId.set(id, next as StoredSubscription);
    },
    remove: (id) => {
      byId.delete(id);
      for (const [key, value] of byKey) if (value === id) byKey.delete(key);
    },
  };
};

/**
 * A queue in memory, for one process: each delivery is attempted on the next turn, and retried on a
 * timer when `deliver` asks. `idle()` resolves once nothing is in flight, which is what a test
 * waits on. A Worker across isolates uses a real queue, which survives the isolate.
 */
export const memoryDeliveries = () => {
  let deliver: ((delivery: Delivery) => Promise<DeliveryOutcome>) | undefined;
  let pending = 0;
  let waiters: (() => void)[] = [];
  const settle = () => {
    if (pending > 0) return;
    for (const wake of waiters) wake();
    waiters = [];
  };
  const attempt = (delivery: Delivery, afterMs: number) => {
    pending += 1;
    setTimeout(async () => {
      try {
        const outcome = deliver === undefined ? ({ done: true } as const) : await deliver(delivery);
        if ("retryAfterSeconds" in outcome) {
          attempt({ ...delivery, attempt: delivery.attempt + 1 }, outcome.retryAfterSeconds * 1000);
        }
      } finally {
        pending -= 1;
        settle();
      }
    }, afterMs);
  };
  const queue: DeliveryQueue & {
    consume: (handler: (delivery: Delivery) => Promise<DeliveryOutcome>) => void;
    idle: () => Promise<void>;
  } = {
    send: (delivery, options) => attempt(delivery, (options?.delaySeconds ?? 0) * 1000),
    consume: (handler) => {
      deliver = handler;
    },
    idle: () =>
      pending === 0
        ? Promise.resolve()
        : new Promise<void>((wake) => {
            waiters.push(wake);
          }),
  };
  return queue;
};

// ---- the address --------------------------------------------------------------------------------

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/** SUB-6: a host that is a loopback, private or link-local address, as far as a name can tell. */
const privateHost = (host: string): boolean => {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  const v4 = name.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return (
    name === "::1" || name.startsWith("fc") || name.startsWith("fd") || name.startsWith("fe80")
  );
};

/** The request schema with SUB-5 lifted, for a sink whose origin the Worker exempted by name. */
const exemptRequest = subscriptionRequest.extend({ sink: z.string().url() });

/** SUB-8, SUB-16: a stored subscription as its caller lists it, never with its credential. */
const listed = (one: StoredSubscription) => ({
  id: one.id,
  types: one.types,
  ...(one.filters === undefined ? {} : { filters: one.filters }),
  sink: one.sink,
  ...(one.lastDeliveredAt === undefined ? {} : { lastDeliveredAt: rfc3339(one.lastDeliveredAt) }),
  ...(one.failingSince === undefined ? {} : { failingSince: rfc3339(one.failingSince) }),
  ...(one.endedAt === undefined ? {} : { endedAt: rfc3339(one.endedAt), reason: one.reason }),
});

export function subscriptionsSurface(config: {
  facts: SubscriptionFacts;
  /** DESC-6: what the handshake names as its origin. */
  workerId: string;
  /** EVT-12: the types the `events` entry publishes, which are all a caller may subscribe to. */
  publishes: string[];
}) {
  const { facts, workerId, publishes } = config;
  const send = facts.fetch ?? globalThis.fetch;
  const exempt = new Set(facts.insecureSinkOrigins ?? []);

  /** SUB-10: the webhook handshake. A sink that does not allow this Worker's origin is refused. */
  const allowed = async (sink: string): Promise<boolean> => {
    try {
      const answer = await send(sink, {
        method: "OPTIONS",
        headers: { "webhook-request-origin": workerId },
      });
      const origin = answer.headers.get("webhook-allowed-origin");
      return answer.ok && (origin === workerId || origin === "*");
    } catch {
      return false;
    }
  };

  return {
    /** SUB-8: this caller's subscriptions, ended ones until `abandonAfterSeconds` has passed. */
    async list(call: SubscriptionCall): Promise<Record<string, unknown>> {
      const now = Date.now();
      const all = await facts.store.list(call.caller);
      const gone = (one: StoredSubscription) =>
        one.endedAt !== undefined && now - one.endedAt > facts.abandonAfterSeconds * 1000;
      await Promise.all(all.filter(gone).map((one) => facts.store.remove(one.id)));
      const kept = all.filter((one) => !gone(one));
      kept.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      return { items: kept.map(listed) };
    },

    /** SUB-9: ends a subscription of this caller's, or answers that there is none. */
    async unsubscribe(asked: { id: string; call: SubscriptionCall }): Promise<Answer | Refusal> {
      const found = await facts.store.get(asked.id);
      if (found === undefined || found.caller !== asked.call.caller) {
        return refuse("not_found", "No such subscription.");
      }
      await facts.store.remove(found.id);
      return { status: 204, body: null };
    },

    /** SUB-2 to SUB-7, SUB-10: subscribes, or finds the subscription that already exists. */
    async subscribe(asked: { raw: string; call: SubscriptionCall }): Promise<Answer | Refusal> {
      const read = readJson(asked.raw);
      if ("code" in read) return read;
      const { parsed } = read;

      const sink = (parsed as { sink?: unknown } | null)?.sink;
      const origin = typeof sink === "string" && URL.canParse(sink) ? new URL(sink).origin : null;
      const exempted = origin !== null && exempt.has(origin);
      const request = (exempted ? exemptRequest : subscriptionRequest).safeParse(parsed);
      if (!request.success) return schemaMismatch(request.error);
      const { types, filters, sinkCredential } = request.data;

      // SUB-3: a type the entry does not publish is a request read and refused on its content.
      const unknown = types.find((type) => !publishes.includes(type));
      if (unknown !== undefined) {
        return refuse("unprocessable_content", `This Worker does not publish ${unknown}.`);
      }
      // SUB-4: the Contract speaks, and the type is refused rather than quietly dropped.
      const allows = facts.allows;
      if (allows !== undefined) {
        const verdicts = await Promise.all(types.map((type) => allows({ type, ...asked.call })));
        if (verdicts.includes(false)) return refuse("forbidden", "No.");
      }
      // SUB-6: the inside of the Worker's own network is nobody's sink.
      if (!exempted && privateHost(new URL(request.data.sink).hostname)) {
        return refuse("unprocessable_content", "A sink may not be a private or loopback address.");
      }

      // SUB-7: the content is the identity. Types are a set, so their order is not.
      const sorted = [...new Set(types)].sort();
      const key = JSON.stringify([asked.call.caller, request.data.sink, sorted, filters ?? null]);
      const existing = await facts.store.find(key);
      if (existing !== undefined) return { status: 200, body: { id: existing.id } };

      // SUB-10: the sink has to have asked for this, before anything is stored.
      if (!(await allowed(request.data.sink))) {
        return refuse("unprocessable_content", "The sink did not allow this Worker's origin.");
      }

      const { subscription, created } = await facts.store.ensure(key, {
        id: crypto.randomUUID(),
        caller: asked.call.caller,
        types: sorted,
        ...(filters === undefined ? {} : { filters }),
        sink: request.data.sink,
        sinkCredential,
        createdAt: Date.now(),
      });
      return { status: created ? 201 : 200, body: { id: subscription.id } };
    },
  };
}

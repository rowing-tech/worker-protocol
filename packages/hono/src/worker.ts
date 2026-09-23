import type {
  activityState,
  alertSeverity,
  eventsEntry,
  eventTypeDeclaration,
  health,
} from "@worker-protocol/schemas";
import type * as z from "zod";
import type { ActionFacts } from "./actions.ts";
import type { ErrorCode } from "./codes.ts";
import type { LogFacts } from "./logs.ts";
import type { MetricFacts } from "./metrics.ts";
import type { TaskFacts, TaskTypes } from "./tasks.ts";

/**
 * What a Worker author implements, and the whole of it.
 *
 * **Everything this protocol fixes is `mount()`'s.** The addresses, the verbs, the two headers on
 * every response, the error envelope, the page envelope and its cursor, the refusal for a version
 * this Worker cannot speak or a filter it does not know, the bucket boundaries cut in a declared
 * zone, the idempotency window. None of it is a decision a Worker gets to make, so none of it is
 * asked for here.
 *
 * What is left is what only the Worker knows, and it is a short list: who it is, whether a
 * credential is good, how it is doing, which Tasks' conditions hold, how much of something
 * happened, what an Action does. That division is the measure this package is held to —
 * `examples/minimal-worker` is a conformant Worker in under 150 lines, and anything above that
 * line is a rule `mount()` should have carried.
 *
 * A Capability left `undefined` is one the Descriptor does not declare (DESC-2), and its address is
 * not served: a Descriptor naming a Capability that answers nothing is DESC-18's fault, and a
 * Worker built through this interface cannot produce one.
 */
export type Worker = {
  /**
   * The Worker's own id. DESC-6 and DESC-27: not the URL, and not derived from it — so it is a
   * constant a Worker is deployed with, never anything read from the address at boot.
   */
  id: string;
  /** The edition this Worker speaks (DESC-23). Defaults to the one `@worker-protocol/schemas` encodes. */
  edition?: string;
  /**
   * TASK-31. The Task types this Worker answers, which IS its Skill, keyed by type.
   *
   * Beside the id rather than inside `tasks`, because a Skill is served at no address: it is what
   * this Worker is, and a Capability is what it serves. A Worker that only ANSWERS Tasks declares
   * this and no `tasks` Capability at all.
   *
   * Each entry says what this Worker NEEDS to receive to answer a Task of that type — which is the
   * other half of what the owner's `raises` says it sends, and what a Tower compares to answer
   * "can this Worker take that one's Tasks?" before any work changes hands.
   */
  skills?: Record<string, SkillDeclaration>;
  /**
   * Whether a presented credential is good, on every address this protocol defines (REG-21).
   *
   * `token` is what followed `Bearer ` (REG-3), or `undefined` where nothing readable was
   * presented. `unauthenticated` is `401`, `forbidden` is `403` (ENDP-29), and how the Worker
   * decides is its own. Left out, the Worker reads openly, which `spec/registration.md` permits.
   *
   * It may answer a promise, and it has to: `spec/registration.md` names *a Worker that validates
   * an API key against an identity provider* as the first example of what REG-3 admits, and that
   * is a network call. A signature that could not await it forbade the case the rule was written
   * around, and left a Worker comparing against a secret it was deployed with as the only kind
   * this package could serve.
   */
  authenticate?: (
    token: string | undefined,
  ) =>
    | "accepted"
    | "unauthenticated"
    | "forbidden"
    | Promise<"accepted" | "unauthenticated" | "forbidden">;
  /** `health`: the answer to a poll (HLTH-2). HLTH-5 makes it `200` whatever it reports. */
  health?: () => z.infer<typeof health> | Promise<z.infer<typeof health>>;
  /** `metrics`: what the entry declares (MET-1 to MET-6), and the Worker's own values. */
  metrics?: MetricFacts;
  /** `actions`: the Actions this Worker accepts, each with its input and what it does. */
  actions?: ActionFacts;
  /** `alerts`: the Alerts whose conditions hold (ALRT-2). `mount()` orders, serializes and pages. */
  alerts?: () => Alert[] | Promise<Alert[]>;
  /**
   * `activity`: what this Worker is doing and has undertaken to do (ACTV-2).
   *
   * The Worker answers its own domain — an id, a state, when it entered it, a line for a person —
   * and `mount()` carries the rest: the instant's format, the order ENDP-23 requires, the page
   * envelope. It is the consumer's own Fact about its work and not a Claim; `spec/activity.md`
   * holds the argument.
   */
  activity?: () => Activity[] | Promise<Activity[]>;
  /**
   * `logs`: what this Worker recorded while it was working (LOG-2).
   *
   * Unlike `alerts` and `activity`, this is a read the Worker performs rather than a list it hands
   * over, and `logs.ts` says why: a feed is not bounded by what is happening now, so the store that
   * holds it is the only thing that can filter and page it. What `mount()` carries is the decoding
   * — LOG-7's floor expanded into the levels it means, LOG-8's half-open interval, the instant's
   * format, the refusals and the envelope.
   *
   * What is left with the Worker is LOG-3's order and ENDP-33's cursor, and no library can take
   * either: both are properties of a query against a store this package never sees.
   */
  logs?: LogFacts;
  /**
   * `nudges`: told that there is work of a Task type this Worker answers (NDG-2).
   *
   * Everything about the call is `mount()`'s, and more of it than usual: the body's shape is NDG-2's
   * rather than this Worker's, a type it declares no Skill for is refused `404` before this is
   * reached (NDG-3), and the answer is `204` because there is nothing to say. What is left is the
   * one thing only the Worker knows — that it should go and read that work sooner than its next
   * sweep would have.
   *
   * It is handed the type and nothing else, and TASK-15 is why: the owner is authoritative over
   * whether the condition still holds, so a Task that travelled here would be a claim that may
   * already be false. The Worker reads, and what it reads is true when it reads it.
   *
   * Declaring it is optional and what it buys is latency. Without it this Worker is told nothing and
   * works from its own schedule, which is slower and never wrong (TASK-19).
   */
  nudges?: (type: string) => void | Promise<void>;
  /**
   * `events`: the entry and nothing else, because there is no address to serve (EVT-11).
   *
   * Each event type's `data` is a Zod object, as an Action's input and a Task's payload are.
   * `mount()` writes the JSON Schema the Descriptor carries, so a Worker declares one shape.
   */
  events?: Omit<z.infer<typeof eventsEntry>, "version" | "address" | "publishes"> & {
    publishes: Record<
      string,
      Omit<z.infer<typeof eventTypeDeclaration>, "data"> & { data: z.ZodType }
    >;
  };
  /** `tasks`: what the entry declares (TASK-27, TASK-2 to TASK-4), and which conditions hold. */
  tasks?: {
    /** TASK-2. Every Task type this Worker raises, with its payload schema and answering Actions. */
    raises: TaskTypes;
  } & TaskFacts;
};

/**
 * TASK-31. What a Worker declares about one Skill: the payload it needs to receive to answer one.
 *
 * A Zod object, as an Action's input and a Task's payload are, and `mount()` writes the JSON Schema
 * the Descriptor carries. It is this Worker's own requirement — NAME-6 judges it against what an
 * owner sends, and a Tower holding both knows at enrollment whether the work can be read.
 *
 * Optional: `{}` claims the type and says nothing about what it needs, which is what a Worker that
 * takes whatever arrives should say. It costs the check, and nothing else.
 */
export type SkillDeclaration = {
  /** What this Worker needs to RECEIVE in order to answer one. */
  payload?: z.ZodType;
  /** What this Worker PRODUCES in answer, judged against the owner's answering Action. */
  produces?: z.ZodType;
};

/** What a Worker says about a condition an operator should see: the domain, and no more (ALRT-3). */
export type Alert = {
  /** ALRT-3. The Worker's own id for this Alert. Opaque to everyone else. */
  id: string;
  /** ALRT-4. `warning` or `critical`, and this edition defines no third value. */
  severity: z.infer<typeof alertSeverity>;
  /**
   * ALRT-3. When the condition began — a `Date`, which `mount()` writes as the instant the rule
   * fixes. It is what lets a console tell `this is new` from `this is the same as yesterday`.
   */
  since: Date;
  /** ALRT-3. Human-readable, and parsed by nothing. */
  summary: string;
  /** ALRT-3, ALRT-7. The Actions this Alert offers, by the names the `actions` entry holds. */
  actions: string[];
};

/** What a Worker says about one thing it holds: the domain, and the whole of it (ACTV-3). */
export type Activity = {
  /** ACTV-3. The Worker's own id, opaque to everyone else. */
  id: string;
  /** ACTV-4. `scheduled`, `pending` or `running`. */
  state: z.infer<typeof activityState>;
  /**
   * ACTV-3. When it entered its current state — began running, joined the queue, was undertaken.
   * A Worker that answers `new Date()` here is answering *now* and telling an operator nothing.
   */
  since: Date;
  /** ACTV-3. For a person. Nothing parses it. */
  summary: string;
};

/**
 * A refusal. The code fixes the status and the class (ENDP-26), so only the code is chosen and a
 * Worker cannot answer a code under a status the vocabulary does not give it.
 */
export type Refusal = { code: ErrorCode; message: string };

/** A success. `body: null` is no body at all — not the four bytes `null` (ACT-10, ACT-11). */
export type Answer = { status: number; body: unknown };

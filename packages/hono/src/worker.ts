import type { alert, eventsEntry, health } from "@worker-protocol/schemas";
import type * as z from "zod";
import type { ActionFacts } from "./actions.ts";
import type { ClaimStore } from "./claims.ts";
import type { ErrorCode } from "./codes.ts";
import type { MetricFacts } from "./metrics.ts";
import type { TaskFacts, TaskTypes } from "./tasks.ts";

/**
 * What a Worker author implements, and the whole of it.
 *
 * **Everything this protocol fixes is `mount()`'s.** The addresses, the verbs, the two headers on
 * every response, the error envelope, the page envelope and its cursor, the refusal for a version
 * this Worker cannot speak or a filter it does not know, the Claim lifecycle with its lease and its
 * fencing token, the bucket boundaries cut in a declared zone, the idempotency window. None of it
 * is a decision a Worker gets to make, so none of it is asked for here.
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
   * Whether a presented credential is good, on every address this protocol defines (REG-21).
   *
   * `token` is what followed `Bearer ` (REG-3), or `undefined` where nothing readable was
   * presented. `unauthenticated` is `401`, `forbidden` is `403` (ENDP-29), and how the Worker
   * decides is its own. Left out, the Worker reads openly, which `spec/registration.md` permits.
   */
  authenticate?: (token: string | undefined) => "accepted" | "unauthenticated" | "forbidden";
  /**
   * TASK-26. Whether a credential is one recorded for this Worker at enrollment, as against one
   * issued under a Contract.
   *
   * Only a Task's `holder` turns on it. **It defaults to every credential this Worker
   * authenticated**, because TASK-26 is required and the ordinary Worker has one credential, which
   * is the recorded one: a default of `false` would have made the common case non-conformant in
   * order to guard a case that only arises once a Tower has brokered a Contract. A Worker that
   * issues Contract credentials knows it does, and answers this.
   */
  enrolled?: (token: string | undefined) => boolean;
  /** `health`: the answer to a poll (HLTH-2). HLTH-5 makes it `200` whatever it reports. */
  health?: () => z.infer<typeof health> | Promise<z.infer<typeof health>>;
  /** `metrics`: what the entry declares (MET-1 to MET-6), and the Worker's own values. */
  metrics?: MetricFacts;
  /** `actions`: the Actions this Worker accepts, each with its input and what it does. */
  actions?: ActionFacts;
  /** `alerts`: the Alerts whose conditions hold (ALRT-2). `mount()` pages them. */
  alerts?: () => z.infer<typeof alert>[] | Promise<z.infer<typeof alert>[]>;
  /** `events`: the entry and nothing else, because there is no address to serve (EVT-2). */
  events?: Omit<z.infer<typeof eventsEntry>, "version" | "address">;
  /** `tasks`: what the entry declares (TASK-1 to TASK-4), and which conditions hold. */
  tasks?: {
    /** TASK-2. Every Task type this Worker raises, with its payload schema and answering Actions. */
    raises: TaskTypes;
    /** TASK-3. The Task types this Worker answers, which IS its Skill. */
    answers: string[];
    /** Where the Claims live. Defaults to a Map, which is every test and some Workers. */
    claims?: ClaimStore;
  } & TaskFacts;
};

/**
 * A refusal. The code fixes the status and the class (ENDP-26), so only the code is chosen and a
 * Worker cannot answer a code under a status the vocabulary does not give it.
 */
export type Refusal = { code: ErrorCode; message: string };

/** A success. `body: null` is no body at all — not the four bytes `null` (ACT-10, ACT-11). */
export type Answer = { status: number; body: unknown };

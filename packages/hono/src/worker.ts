import type {
  actionsEntry,
  alertPage,
  eventsEntry,
  health,
  metricPage,
  metricsEntry,
  taskPage,
  tasksEntry,
} from "@worker-protocol/schemas";
import type * as z from "zod";
import type { ErrorCode } from "./codes.ts";

/**
 * What a Worker author implements, and the whole of it.
 *
 * Everything this protocol fixes about a call — the addresses, the verbs, the two headers on every
 * response, the error envelope, which refusal answers a version this Worker cannot speak or a
 * filter it does not know — is `mount()`'s, so that no Worker writes it twice and no two Workers
 * write it differently. What is left is what only the Worker knows: its id, whether a credential is
 * good, how it is doing, what it counts, what it does, what it has raised.
 *
 * A Capability left `undefined` is a Capability the Descriptor does not declare (DESC-2), and its
 * address is not served. A Descriptor naming a Capability that answers nothing is a fault in the
 * Descriptor (DESC-18); a Worker built through this interface cannot produce one.
 *
 * The declaration half of each Capability is typed as its entry schema minus what `mount()` fills
 * in — the version and the addresses — so a Worker declares exactly what `schemas/` says an entry
 * carries and nothing here restates it.
 */
// A mapped type rather than `Omit`: the shared Capability entry is a loose object, so its inferred
// type carries an index signature, and `Omit` over one collapses the named keys into it.
type Declared<Entry extends z.ZodType> = {
  [K in keyof z.infer<Entry> as K extends "version" | "address" | "claimAddress"
    ? never
    : K]: z.infer<Entry>[K];
};

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
   * decides is its own — an identity provider, one secret it was deployed with, two secrets so
   * that rotation is an overlap (REG-28). Left out, the Worker reads openly, which
   * `spec/registration.md` says a Worker may.
   */
  authenticate?: (token: string | undefined) => "accepted" | "unauthenticated" | "forbidden";
  /** `health`: the answer to a poll (HLTH-2). */
  health?: () => z.infer<typeof health>;
  /** `metrics`: what the entry declares (MET-1 to MET-6), and one read (MET-8 onward). */
  metrics?: Declared<typeof metricsEntry> & {
    /**
     * The raw query, because a dimension is fixed with a parameter of its own name (MET-16) and
     * only the Worker knows those names. `metric`, `granularity`, `from`, `to`, `by` and `cursor`
     * have already been validated against `readMetric`'s declaration when this is called.
     */
    read: (query: URLSearchParams) => z.infer<typeof metricPage> | Refusal;
  };
  /** `actions`: what the entry declares (ACT-1 to ACT-4), one performance, and the settings. */
  actions?: Declared<typeof actionsEntry> & {
    /**
     * The body arrives raw and unparsed (ACT-5): it is the Action's own input and this protocol has
     * no data model, so the Worker parses it and answers `malformed_request` or `schema_mismatch`
     * itself (ENDP-4, ACT-8). `name` has been validated as present; whether it is declared is the
     * Worker's to answer (ACT-6). `key` is the `Idempotency-Key` header where one was sent.
     * `claim` is the `Worker-Protocol-Claim` header where one was sent (TASK-20): the Claim this
     * Action answers a Task under, which the Worker checks before performing anything and refuses
     * with `conflict` where it is not current or its Task's type does not list the Action
     * (TASK-21). Absent, the call is a performance and answers no Claim.
     */
    perform: (
      name: string,
      body: string,
      key: string | undefined,
      claim: string | undefined,
    ) => Answer | Refusal;
    /**
     * The document `configure` would accept (ACT-15). Where it is given, `mount()` serves it at
     * the reading address and writes that address into the `configure` declaration, so the two
     * cannot disagree.
     */
    settings?: () => unknown;
  };
  /** `tasks`: what the entry declares (TASK-1 to TASK-4), one read and one write. */
  tasks?: Declared<typeof tasksEntry> & {
    /**
     * `token` is the presented credential, for TASK-6: only the Tasks it covers are answered. And
     * for TASK-26: a Task under a Claim carries `holder` to a credential recorded at enrollment
     * and to no other, and which credentials those are is the Worker's to know.
     */
    read: (query: URLSearchParams, token: string | undefined) => z.infer<typeof taskPage> | Refusal;
    /**
     * A claim by Task or by type, a renewal or an outcome (TASK-9 to TASK-14, TASK-17, TASK-22 to
     * TASK-25), told apart by the query. `type` reaches here only where the entry declares
     * `claimByType`; `mount()` refuses it otherwise (TASK-23). `token` is the presented credential,
     * for TASK-24's `covers` and for whatever the Worker mints as `holder`.
     */
    write: (query: URLSearchParams, token: string | undefined) => Answer | Refusal;
  };
  /** `alerts`: the Alerts whose conditions hold (ALRT-2). */
  alerts?: () => z.infer<typeof alertPage>;
  /** `events`: the entry and nothing else, because there is no address to serve (EVT-2). */
  events?: Declared<typeof eventsEntry>;
};

/**
 * A refusal. The code fixes the status and the class (ENDP-26), so only the code is chosen and a
 * Worker cannot answer a code under a status the vocabulary does not give it.
 */
export type Refusal = { code: ErrorCode; message: string };

/** A success. `body: null` is no body at all — not the four bytes `null` (ACT-10, ACT-11). */
export type Answer = { status: number; body: unknown };

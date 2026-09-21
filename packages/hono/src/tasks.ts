/**
 * The `tasks` surface, which is everything in `spec/tasks-and-claims.md` that is not a Fact.
 *
 * A Worker declares what it raises and answers, and says which Tasks' conditions hold right now.
 * That is the whole of what it owes, because TASK-15 makes a Task a condition over the Worker's own
 * Facts and nothing else here can know one. Everything around it — the page envelope, the filter
 * that must be refused rather than ignored, the counts, whether a Task may be claimed, who holds
 * it, the lease and its clock — is fixed by rules, and a Worker writing any of it again would be
 * re-deriving the specification.
 */

import type { qualifiedName, taskPage, task as taskSchema } from "@worker-protocol/schemas";
import type * as z from "zod";
import type { Claims, LeasePolicy, TaskCounts } from "./claims.ts";
import type { ErrorCode } from "./codes.ts";
import type { Answer, Refusal } from "./worker.ts";

/** What a Worker says about a Task whose condition holds: the domain, and the whole of it. */
export type OpenTask = {
  /** TASK-7. The Worker's own id, opaque to everyone else. */
  id: string;
  /** TASK-4, NAME-7. One of the types the entry declares under `raises`. */
  type: z.infer<typeof qualifiedName>;
  /** TASK-7. Against the schema that type declared. The Worker's own shape. */
  payload: unknown;
};

export type TaskTypes = Record<string, { payload: unknown; answeredBy: string[] }>;

/** What a Worker author implements for `tasks`, beside the declaration itself. */
export type TaskFacts = {
  /**
   * TASK-15. The Tasks whose conditions hold, derived from this Worker's own Facts.
   *
   * It is called on every read and on every claim, so it answers the present rather than a cache:
   * a Task closes when its condition stops holding, and nothing else in this protocol closes one.
   */
  open: () => OpenTask[] | Promise<OpenTask[]>;
  /**
   * TASK-6. Which Task ids the credential presented covers, or `undefined` for all of them.
   *
   * The owner filters rather than the consumer discarding, and the file gives two reasons: a list
   * showing every Task to every holder of any Contract is a disclosure the owner cannot take back,
   * and a consumer reading through work it may not take costs both sides.
   */
  covers?: (token: string | undefined) => string[] | undefined;
  /**
   * TASK-11. Whether the owner will grant a lease on this Task now. Defaults to always.
   *
   * The counts are TASK-7's, over Claims and never over the condition, and a cap over them is the
   * ordinary reason to stop granting — which is the owner's to choose and not this protocol's.
   */
  claimable?: (task: OpenTask, counts: TaskCounts) => boolean;
  /**
   * TASK-26. What this Worker calls whoever presented this credential.
   *
   * Defaults to an opaque id minted per credential, which is enough for an operator to tell two
   * holders apart and tells a consumer nothing. A Worker that knows real identities answers one.
   */
  holder?: (token: string | undefined) => string | undefined;
  /** TASK-23, TASK-24. Whether a claim may name a Task type rather than a Task. */
  claimByType?: boolean;
  /** TASK-12, TASK-25. What this Worker grants, and the most it will grant. */
  lease?: LeasePolicy;
  /** ENDP-19 (recommended). The most Tasks one page carries. */
  pageSize?: number;
};

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/** The parameters TASK-5 and ENDP-20 define on this read; ENDP-24 refuses everything else. */
const READ_PARAMETERS = new Set(["type", "cursor"]);

export type TaskSurface = {
  read: (query: URLSearchParams, token: string | undefined) => Promise<Refusal | TaskPage>;
  write: (query: URLSearchParams, token: string | undefined) => Promise<Refusal | Answer>;
  /** TASK-21, asked by the Actions surface before it performs anything. */
  allows: (claim: string, action: string) => Promise<boolean>;
};

type TaskPage = z.infer<typeof taskPage>;
type Task = z.infer<typeof taskSchema>;

export function tasks(
  raises: TaskTypes,
  facts: TaskFacts,
  held: Claims,
  enrolled: (token: string | undefined) => boolean,
  /**
   * TASK-26. The opaque id this Worker calls each credential by, handed in rather than held here.
   *
   * `mount()` may answer a different `Worker` object on every request — which is what a Cloudflare,
   * Vercel or Deno runtime forces — and a map that started again with each one would mint a second
   * id for a holder that already had one, so an operator would see two names for one party.
   */
  minted: Map<string, string>,
): TaskSurface {
  const cap = facts.pageSize ?? 50;
  const answeredBy = (type: string): string[] => raises[type]?.answeredBy ?? [];

  /** TASK-26. The Worker's own, or an opaque id per credential that tells a consumer nothing. */
  const holderFor = (token: string | undefined): string => {
    const own = facts.holder?.(token);
    if (own !== undefined) return own;
    const key = token ?? "";
    let id = minted.get(key);
    if (id === undefined) {
      id = `holder-${minted.size + 1}`;
      minted.set(key, id);
    }
    return id;
  };

  /** TASK-6. The Tasks whose conditions hold that this credential may see. */
  const visible = async (token: string | undefined): Promise<OpenTask[]> => {
    const covers = facts.covers?.(token);
    const open = await facts.open();
    return covers === undefined ? open : open.filter((task) => covers.includes(task.id));
  };

  /** TASK-7, TASK-26. One Task as it travels, with what only the owner can put beside it. */
  const onTheWire = (task: OpenTask, token: string | undefined): Task => {
    const counts = held.counts(task.id);
    const claim = held.on(task.id);
    return {
      id: task.id,
      type: task.type,
      payload: task.payload,
      failedClaims: counts.failed,
      lapsedClaims: counts.lapsed,
      claimable: facts.claimable?.(task, counts) ?? true,
      // TASK-26: to a credential recorded at enrollment and to no other. A Worker that reads
      // openly has recorded none, so `enrolled` is false and nobody is told who holds anything.
      ...(claim !== undefined && enrolled(token) ? { holder: claim.holder } : {}),
    };
  };

  const claimable = (task: OpenTask): boolean =>
    (facts.claimable?.(task, held.counts(task.id)) ?? true) && held.on(task.id) === undefined;

  return {
    async read(query, token) {
      // ENDP-24: an unrecognized filter is `400` and is never ignored. A filter dropped in silence
      // answers with MORE than the caller asked for, in a shape it will happily parse.
      for (const key of query.keys()) {
        if (!READ_PARAMETERS.has(key)) {
          return refuse("unknown_filter", `This address takes no parameter named ${key}.`);
        }
      }

      // TASK-8: a type the entry does not declare. The surface exists and the caller asked about
      // something this Worker never raises, which is a parameter whose VALUE it will not accept.
      const type = query.get("type");
      if (type !== null && !(type in raises)) {
        return refuse("invalid_parameter", `No Task type named ${type} is declared.`);
      }

      const matching = (await visible(token)).filter((task) => type === null || task.type === type);

      // ENDP-19 (recommended): the Worker caps rather than negotiating. ENDP-23: the collection
      // declares an order and holds it, so paging terminates — by id, which the owner mints and
      // which is the only field every Task has that nothing else here reorders.
      const ordered = [...matching].sort((a, b) => a.id.localeCompare(b.id));
      const from = Number(query.get("cursor") ?? "0");
      if (!Number.isInteger(from) || from < 0) {
        return refuse("invalid_parameter", "That cursor was not produced by this Worker.");
      }
      const items = ordered.slice(from, from + cap).map((task) => onTheWire(task, token));
      const next = from + cap;

      // ENDP-20: the cursor is absent at the end of the collection — absent, not null.
      return next < ordered.length ? { items, nextCursor: String(next) } : { items };
    },

    async write(query, token) {
      const task = query.get("task");
      const type = query.get("type");
      const claim = query.get("claim");
      const outcome = query.get("outcome");

      // TASK-25: a duration a holder proposes, which binds the owner to nothing.
      const asked = query.get("lease");
      if (asked !== null && !/^\d+$/.test(asked)) {
        return refuse("invalid_parameter", "`lease` is a whole number of seconds.");
      }
      const lease = asked === null ? undefined : Number(asked);

      if (task !== null) {
        // TASK-9: a claim names the Task. One whose condition no longer holds is not there to be
        // claimed, and a Task the owner will not grant a lease on is TASK-11's `409`.
        const open = (await visible(token)).find((candidate) => candidate.id === task);
        if (open === undefined) return refuse("not_found", `No Task named ${task} is open.`);
        if (!(facts.claimable?.(open, held.counts(open.id)) ?? true)) {
          return refuse("conflict", "This Task is not being granted leases.");
        }
        const granted = held.grant(open.id, open.type, holderFor(token), lease);
        if ("code" in granted) return granted;
        return { status: 200, body: wire(granted) };
      }

      if (type !== null) {
        // TASK-23: a type this Worker does not raise. `mount()` has already refused `type` where
        // the entry declares no `claimByType`, which is the other half of the same rule.
        if (!(type in raises)) {
          return refuse("invalid_parameter", `No Task type named ${type} is declared.`);
        }
        const one = (await visible(token)).find(
          (candidate) => candidate.type === type && claimable(candidate),
        );
        // TASK-24: nothing claimable is `204` and not a refusal. An empty queue is neither `you
        // are wrong` nor `I am busy`, and classing it `reject` would tell a consumer polling a
        // quiet queue that its request will be wrong again.
        if (one === undefined) return { status: 204, body: null };
        const granted = held.grant(one.id, one.type, holderFor(token), lease);
        if ("code" in granted) return { status: 204, body: null };
        // TASK-24: the Claim carries the Task it holds, so a nudge is answered in one call.
        return { status: 200, body: { ...wire(granted), held: onTheWire(one, token) } };
      }

      if (claim === null) {
        return refuse("invalid_parameter", "A write names a Task, a Task type or a Claim.");
      }

      // TASK-13: naming a Claim with no outcome renews it.
      if (outcome === null) {
        const renewed = held.renew(claim, lease);
        if ("code" in renewed) return renewed;
        return { status: 200, body: wire(renewed) };
      }

      // TASK-14: `done`, `failed` or `released`, and nothing else is an outcome.
      if (outcome !== "done" && outcome !== "failed" && outcome !== "released") {
        return refuse("invalid_parameter", "An outcome is done, failed or released.");
      }
      // TASK-15, TASK-22: the Claim closes and the Task does not — and a Task that closed by
      // condition while this was in flight does not close the Claim either, so this is accepted.
      const closed = held.close(claim, outcome);
      return closed ?? { status: 204, body: null };
    },

    // TASK-21, and it consults no Task: the type is on the Claim, so this answers the same way
    // after the Action has already closed the Task it was answering (TASK-22).
    allows: async (claim, action) => held.allows(claim, action, answeredBy),
  };
}

/** TASK-9, TASK-12. The Claim as it travels: the expiry is an RFC 3339 instant with an offset. */
const wire = (record: { id: string; task: string; expires: number }) => ({
  id: record.id,
  task: record.task,
  expires: new Date(record.expires).toISOString().replace(/\.\d{3}Z$/, "Z"),
});

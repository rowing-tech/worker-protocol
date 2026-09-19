/**
 * The Claim lifecycle, which is the protocol's and never a Worker's.
 *
 * Every Worker that declares `tasks` would otherwise write this same code: mint a Claim, refuse a
 * second one, decide whether a lease has lapsed, count what lapsed and what failed, refuse a call
 * naming a Claim that is no longer current, keep a Claim current after its Task closed (TASK-22).
 * None of it is a decision a Worker gets to make — `spec/tasks-and-claims.md` makes all of them —
 * so a Worker that wrote it again would be re-deriving the specification, and the ones that got a
 * detail wrong would be non-conformant in a way only a verifier would ever find.
 *
 * What is left to the Worker is the one thing the protocol does not fix: WHERE the records live. A
 * Worker on Cloudflare keeps them in a durable object, one on Convex in a table, one in a test in a
 * Map. That is `ClaimStore`, and it is six methods with no logic in any of them.
 */

import type { ErrorCode } from "./codes.ts";

/** One Claim as a store keeps it. The instant is epoch milliseconds: TASK-18's clock is here. */
export type ClaimRecord = {
  id: string;
  task: string;
  /**
   * The type of the Task this Claim holds, recorded when the lease was granted.
   *
   * It is carried rather than looked up, and TASK-22 is why: a Claim outlives its Task, so a Claim
   * whose Task closed while an Action was in flight would have nowhere to read its type from at
   * the moment TASK-21 has to answer whether that Action was one the type named.
   */
  type: string;
  /** When the owner's lease lapses. The owner's clock is the only one that decides (TASK-18). */
  expires: number;
  /** TASK-26. What the owner minted for whoever holds this Claim. */
  holder: string;
};

/** TASK-7. Counted over Claims and never over the condition, so neither ever removes a Task. */
export type TaskCounts = { failed: number; lapsed: number };

/**
 * Where a Worker keeps its Claims. Six methods, each a lookup or a write, and no rule in any of
 * them: everything the specification decides is in `claims()` below.
 *
 * Nothing here is asked to sweep. A lapsed lease is noticed when the Claim is next looked at, which
 * is TASK-18 read exactly — the owner's clock decides at write time — and which spares a Worker a
 * timer it would otherwise need for correctness rather than for latency.
 */
export type ClaimStore = {
  /** The Claim currently held on a Task, lapsed or not. */
  byTask: (task: string) => ClaimRecord | undefined;
  /** One Claim by its id, lapsed or not, whether or not its Task still exists (TASK-22). */
  byId: (id: string) => ClaimRecord | undefined;
  grant: (record: ClaimRecord) => void;
  close: (id: string) => void;
  counts: (task: string) => TaskCounts;
  count: (task: string, of: "failed" | "lapsed") => void;
};

/** The store a Worker gets when it declares none: a Map, which is every test and some Workers. */
export function memoryClaims(): ClaimStore {
  const byId = new Map<string, ClaimRecord>();
  const byTask = new Map<string, string>();
  const counted = new Map<string, TaskCounts>();

  return {
    byTask: (task) => {
      const id = byTask.get(task);
      return id === undefined ? undefined : byId.get(id);
    },
    byId: (id) => byId.get(id),
    grant: (record) => {
      byId.set(record.id, record);
      byTask.set(record.task, record.id);
    },
    close: (id) => {
      const record = byId.get(id);
      if (record === undefined) return;
      byId.delete(id);
      if (byTask.get(record.task) === id) byTask.delete(record.task);
    },
    counts: (task) => counted.get(task) ?? { failed: 0, lapsed: 0 },
    count: (task, of) => {
      const held = counted.get(task) ?? { failed: 0, lapsed: 0 };
      counted.set(task, { ...held, [of]: held[of] + 1 });
    },
  };
}

/**
 * TASK-12, TASK-25 — what the owner grants, and what it will do with a duration a holder proposes.
 *
 * The protocol fixes no duration and says why: a number here would be one every Worker in every
 * deployment was measured against, invented by somebody who had seen none of them. So this is the
 * Worker's, with a default that is merely a number that works.
 */
export type LeasePolicy = {
  /** What a Claim gets when the holder proposes nothing. */
  seconds: number;
  /** The longest this Worker will grant, however much a holder asks for. Defaults to `seconds`. */
  maxSeconds?: number;
};

const DEFAULT_LEASE: LeasePolicy = { seconds: 60, maxSeconds: 900 };

export type Granted = { record: ClaimRecord; task: string };
export type Refused = { code: ErrorCode; message: string };

const refuse = (code: ErrorCode, message: string): Refused => ({ code, message });

export const refused = (answer: object): answer is Refused => "code" in answer;

export type Claims = ReturnType<typeof claims>;

/**
 * The state machine `spec/tasks-and-claims.md` describes, over whatever store it is handed.
 *
 * Every method below cites the rules it carries, and none of them decides anything those rules do
 * not: this is the specification compiled, which is the only standing `packages/README.md` gives
 * anything here. A Worker author never calls these — `mount()` does, from the claim address.
 */
export function claims(store: ClaimStore, policy: LeasePolicy = DEFAULT_LEASE, now = Date.now) {
  const lease = { ...DEFAULT_LEASE, ...policy };
  let issued = 0;

  /**
   * One Claim, or nothing, having lapsed it if its lease has run out.
   *
   * TASK-17's three cases — a released Claim, a lapsed lease, a Task reclaimed by somebody else —
   * are one lookup here, and the lapse is counted at the moment it is noticed. TASK-22 is the
   * clause that is easy to get wrong and is load-bearing: this never asks whether the Task still
   * exists, because a Task closing does not close the Claim on it.
   */
  const live = (record: ClaimRecord | undefined): ClaimRecord | undefined => {
    if (record === undefined) return undefined;
    if (record.expires > now()) return record;
    store.close(record.id);
    store.count(record.task, "lapsed");
    return undefined;
  };

  /** What a holder asked for, bounded by what this Worker will grant (TASK-25). */
  const granted = (proposed: number | undefined): number => {
    const cap = lease.maxSeconds ?? lease.seconds;
    const asked = proposed === undefined ? lease.seconds : proposed;
    return Math.min(Math.max(asked, 1), cap) * 1000;
  };

  return {
    /** The live Claim on a Task, for a read that wants its holder (TASK-26). */
    on: (task: string) => live(store.byTask(task)),

    /** TASK-7. What a read puts beside a Task, and what a claimable policy is decided from. */
    counts: (task: string) => store.counts(task),

    /**
     * TASK-9, TASK-10, TASK-12. One exclusive lease, or the `409` a held Task answers.
     *
     * Contention needs no policy here and the file says why: the store settles it by first commit,
     * so two consumers posting at the same instant produce one grant and one refusal.
     */
    grant: (
      task: string,
      type: string,
      holder: string,
      proposed?: number,
    ): ClaimRecord | Refused => {
      if (live(store.byTask(task)) !== undefined) {
        return refuse("conflict", "This Task is already claimed.");
      }
      issued += 1;
      const record: ClaimRecord = {
        id: `wp-${Date.now().toString(36)}-${issued.toString(36)}`,
        task,
        type,
        expires: now() + granted(proposed),
        holder,
      };
      store.grant(record);
      return record;
    },

    /** TASK-13, TASK-25. A new expiry, or TASK-17's refusal. */
    renew: (id: string, proposed?: number): ClaimRecord | Refused => {
      const record = live(store.byId(id));
      if (record === undefined) {
        return refuse("conflict", "That Claim is no longer this Task's current one.");
      }
      const renewed = { ...record, expires: now() + granted(proposed) };
      store.grant(renewed);
      return renewed;
    },

    /**
     * TASK-14, TASK-15, TASK-22. The Claim closes and the Task does not.
     *
     * TASK-22 is what makes the ordinary end of a Response work: the Action resolved the condition
     * and the Task is already gone, and the outcome naming its Claim is still accepted — because
     * currency is a fact about the Claim, which is what `live` is asked and the Task is not.
     */
    close: (id: string, outcome: "done" | "failed" | "released"): Refused | null => {
      const record = live(store.byId(id));
      if (record === undefined) {
        return refuse("conflict", "That Claim is no longer this Task's current one.");
      }
      store.close(id);
      if (outcome === "failed") store.count(record.task, "failed");
      return null;
    },

    /**
     * TASK-21. Whether an Action may be performed under a Claim, asked before anything is done.
     *
     * Two clauses, and the second is TASK-2's closed list binding on a call at last: a Claim on one
     * Task type does not license an Action that type never named. `answeredBy` is read from the
     * Worker's own `raises` declaration, so the Worker states it once and never checks it — and the
     * type comes off the record, so this still answers after the Task closed (TASK-22).
     */
    allows: (id: string, action: string, answeredBy: (type: string) => string[]): boolean => {
      const record = live(store.byId(id));
      return record !== undefined && answeredBy(record.type).includes(action);
    },
  };
}

/**
 * The `tasks` Capability, arranged to be checked.
 *
 * Two Task types and a handful of open Tasks, one of which the Worker will not currently grant a
 * lease on — because TASK-11 has no witness against a Worker that always grants, and TASK-7's
 * `claimable` would otherwise be a field nobody has ever seen be false.
 *
 * The verify-vehicle Tasks hold by a condition this Worker can actually resolve: no verification on
 * record for the vehicle. That is what lets `record-verification` close one, which is TASK-15
 * working, and what gives TASK-22 something to witness — an outcome posted on a Claim whose Task is
 * already gone.
 */

import type { Answer, Refusal } from "@worker-protocol/hono";
import type { taskPage, task as taskSchema, taskTypeDeclaration } from "@worker-protocol/schemas";
import type * as z from "zod";

const NAMESPACE = "tech.rowing.worker-protocol";
export const VERIFY_VEHICLE = `${NAMESPACE}.verify-vehicle`;
export const PRICE_A_QUOTE = `${NAMESPACE}.price-a-quote`;

export const RAISES: Record<string, z.infer<typeof taskTypeDeclaration>> = {
  [VERIFY_VEHICLE]: {
    payload: {
      type: "object",
      properties: { vehicle: { type: "string", minLength: 1 } },
      required: ["vehicle"],
      additionalProperties: false,
    },
    // TASK-2: the closed list is a list of the OWNER's own Actions, by the names its `actions`
    // entry holds them under. A name that entry does not hold is a Descriptor disagreeing with
    // itself, which is the fault DESC-18 describes one level up.
    answeredBy: ["record-verification"],
  },
  [PRICE_A_QUOTE]: {
    payload: {
      type: "object",
      properties: { amount: { type: "number" } },
      required: ["amount"],
      additionalProperties: false,
    },
    answeredBy: ["price-quote"],
  },
};

/** TASK-3: the Task types this Worker answers, which is its Skill. */
export const ANSWERS: string[] = [VERIFY_VEHICLE];

/** A Task as this Worker keeps it. `holder` is added on the way out, and only for some readers. */
type Open = Omit<z.infer<typeof taskSchema>, "holder">;

const INITIAL: Open[] = [
  {
    id: "task-1",
    type: VERIFY_VEHICLE,
    payload: { vehicle: "ABC-123" },
    failedClaims: 0,
    lapsedClaims: 0,
    claimable: true,
  },
  {
    id: "task-2",
    type: VERIFY_VEHICLE,
    payload: { vehicle: "DEF-456" },
    failedClaims: 0,
    lapsedClaims: 0,
    claimable: true,
  },
  {
    // TASK-7, TASK-11: the owner stopped granting past a cap of its own choosing, and says so on
    // the Task rather than leaving a consumer to infer it from a pattern of 409s. The Task itself
    // is untouched — its condition still holds, so it still exists, stuck where somebody can see
    // it with the count beside it.
    id: "task-3",
    type: PRICE_A_QUOTE,
    payload: { amount: 100 },
    failedClaims: 3,
    lapsedClaims: 1,
    claimable: false,
  },
];

const LEASE_MS = 60_000;
const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

type Held = { claim: string; expires: number; holder: string };

export function createTasks() {
  const tasks: Open[] = INITIAL.map((task) => ({ ...task }));
  /** A Fact of this Worker's: the vehicles with a verification on record. */
  const verified = new Set<string>();
  /** The Task a Claim holds, and which Claim is currently the Task's — TASK-17's fencing token. */
  const held = new Map<string, Held>();
  /** TASK-26: an identifier of this Worker's own per credential, minted on the first claim. */
  const holders = new Map<string, string>();
  let issued = 0;

  const reject = (code: Refusal["code"], message: string): Refusal => ({ code, message });

  // TASK-15: whether a Task's condition holds is derived from this Worker's own Facts and from
  // nothing anybody declared. A verify-vehicle Task exists while its vehicle has no verification
  // on record; a price-a-quote Task, here, holds until somebody restarts the process.
  const holds = (task: Open) =>
    task.type !== VERIFY_VEHICLE || !verified.has((task.payload as { vehicle: string }).vehicle);

  const open = () => tasks.filter(holds);
  const byId = (id: string) => tasks.find((task) => task.id === id);

  // A lapsed lease is not current (TASK-17), and the lapse is counted on the Task (TASK-7). Swept
  // on every call rather than on a timer, because the only clock that decides is this one and it
  // is consulted at write time (TASK-18).
  const sweep = () => {
    const now = Date.now();
    for (const [taskId, entry] of held) {
      if (entry.expires > now) continue;
      held.delete(taskId);
      const task = byId(taskId);
      if (task) task.lapsedClaims += 1;
    }
  };

  const holderOf = (token: string | undefined): string => {
    const key = token ?? "";
    let holder = holders.get(key);
    if (holder === undefined) {
      holder = `holder-${holders.size + 1}`;
      holders.set(key, holder);
    }
    return holder;
  };

  // TASK-25: the holder may propose a duration and the owner grants what it decides. This one
  // grants the proposal up to its own cap, which is the one number it holds an opinion about.
  const leaseFor = (query: URLSearchParams): number => {
    const asked = Number(query.get("lease"));
    return Number.isInteger(asked) && asked >= 1 ? Math.min(asked * 1000, LEASE_MS) : LEASE_MS;
  };

  const grant = (task: Open, token: string | undefined, query: URLSearchParams): Held => {
    issued += 1;
    const entry = {
      claim: `claim-${issued}`,
      expires: Date.now() + leaseFor(query),
      holder: holderOf(token),
    };
    held.set(task.id, entry);
    return entry;
  };

  const claimOf = (claimId: string): [string, Held] | undefined =>
    [...held.entries()].find(([, entry]) => entry.claim === claimId);

  return {
    /** The Action `record-verification` changes this Worker's Facts, and the Tasks follow. */
    verify(vehicle: string): void {
      verified.add(vehicle);
    },

    /**
     * TASK-21: whether a Claim is its Task's current one and that Task's type lists the Action.
     * TASK-22: a Task that closed keeps its Claim current, so `held` is consulted and not `open()`.
     */
    allows(claimId: string, action: string): boolean {
      sweep();
      const entry = claimOf(claimId);
      if (entry === undefined) return false;
      const task = byId(entry[0]);
      return task !== undefined && RAISES[task.type]?.answeredBy.includes(action) === true;
    },

    /** TASK-5, TASK-8, TASK-26 — a read of what is open. */
    read(
      query: URLSearchParams,
      covers?: string[],
      enrolled = false,
    ): Refusal | z.infer<typeof taskPage> {
      sweep();
      // ENDP-24: an unrecognized filter parameter is 400 and is never ignored. This surface takes
      // one filter and the cursor of ENDP-20, so everything else is a parameter it cannot know.
      for (const key of query.keys()) {
        if (key === "type" || key === "cursor") continue;
        return reject("unknown_filter", `This address takes no parameter named ${key}.`);
      }

      const type = query.get("type");
      if (type !== null && !(type in RAISES)) {
        // TASK-8: a type the entry does not declare. The surface exists and the caller asked
        // about something this Worker never raises, which is a parameter whose VALUE this Worker
        // will not accept — MET-10's division rather than MET-9's.
        return reject("invalid_parameter", `No Task type named ${type} is declared.`);
      }
      const matching = open()
        .filter((task) => type === null || task.type === type)
        // TASK-6: only what this credential covers. Absent, it covers everything.
        .filter((task) => covers === undefined || covers.includes(task.id))
        // TASK-26: who holds the current Claim, to a credential recorded at enrollment and to no
        // other. The id is this Worker's own; nothing about the credential leaves here.
        .map((task) => {
          const entry = held.get(task.id);
          return enrolled && entry !== undefined ? { ...task, holder: entry.holder } : task;
        });

      // ENDP-19 recommends that a Worker CAP the page size rather than negotiating it, and ENDP-31
      // makes the caller read how many items it received rather than how many it asked for. The
      // cap is two so that this Worker's own three Tasks actually page — a cap nothing ever
      // reaches is a cap nobody has seen work.
      const CAP = 2;
      const from = Number(query.get("cursor") ?? "0");
      const items = matching.slice(from, from + CAP);
      const next = from + CAP;

      // ENDP-20: the cursor is absent at the end of the collection — absent, not null. ENDP-21: it
      // is opaque, produced only here, and never constructed by a caller.
      return next < matching.length ? { items, nextCursor: String(next) } : { items };
    },

    /** TASK-9 to TASK-14, TASK-17, TASK-22 to TASK-25 — everything that changes a Claim. */
    write(query: URLSearchParams, token: string | undefined, covers?: string[]): Refusal | Answer {
      sweep();
      const taskId = query.get("task");
      const type = query.get("type");
      const claimId = query.get("claim");

      if (taskId !== null) {
        const task = open().find((candidate) => candidate.id === taskId);
        if (task === undefined) {
          return reject("not_found", `No Task named ${taskId} is open.`);
        }
        // TASK-11: a Task the Worker will not currently grant a lease on.
        if (!task.claimable) {
          return reject("conflict", "This Task is not being granted leases.");
        }
        // TASK-10: claiming is exclusive, and the store settles contention by first commit.
        if (held.has(task.id)) {
          return reject("conflict", "This Task is already claimed.");
        }
        const granted = grant(task, token, query);
        // TASK-9, TASK-12: the Claim, and the instant the owner's lease expires.
        return {
          status: 200,
          body: { id: granted.claim, task: task.id, expires: rfc3339(granted.expires) },
        };
      }

      if (type !== null) {
        // TASK-23: a type this Worker does not raise. `mount()` has already refused `type` where
        // `claimByType` is not declared, which is the other half of the same rule.
        if (!(type in RAISES)) {
          return reject("invalid_parameter", `No Task type named ${type} is declared.`);
        }
        // TASK-24: one claimable Task of that type the credential covers — the first this store
        // finds, which is how it settles contention everywhere else too.
        const task = open().find(
          (candidate) =>
            candidate.type === type &&
            candidate.claimable &&
            !held.has(candidate.id) &&
            (covers === undefined || covers.includes(candidate.id)),
        );
        if (task === undefined) {
          return reject("not_found", `No claimable Task of type ${type} is open.`);
        }
        const granted = grant(task, token, query);
        return {
          status: 200,
          body: {
            id: granted.claim,
            task: task.id,
            expires: rfc3339(granted.expires),
            held: task,
          },
        };
      }

      if (claimId === null) {
        return reject("invalid_parameter", "A write names a Task, a Task type or a Claim.");
      }

      const entry = claimOf(claimId);
      // TASK-17: a call naming a Claim that is no longer the Task's current one. A lapsed lease, a
      // released Claim and a Task reclaimed by somebody else are all this same check, and it is a
      // precondition at write time rather than two clocks agreeing about an instant. TASK-22: a
      // Task that closed is NOT on that list — its Claim is still in `held`, and this finds it.
      if (entry === undefined) {
        return reject("conflict", "That Claim is no longer this Task's current one.");
      }
      const [taskOfClaim, current] = entry;

      const outcome = query.get("outcome");
      if (outcome === null) {
        // TASK-13: a renewal. The owner answers a new expiry, or refuses. TASK-25: a proposed
        // duration is taken into account here as on a claim.
        current.expires = Date.now() + leaseFor(query);
        return {
          status: 200,
          body: { id: claimId, task: taskOfClaim, expires: rfc3339(current.expires) },
        };
      }

      if (!["done", "failed", "released"].includes(outcome)) {
        return reject("invalid_parameter", "An outcome is done, failed or released.");
      }

      // TASK-14, TASK-15: the Claim closes and the Task does not. Its condition is derived from
      // this Worker's own Facts and nothing a consumer said bears on it. TASK-7: a failure is
      // counted on the Task, over Claims and never over the condition.
      held.delete(taskOfClaim);
      if (outcome === "failed") {
        const task = byId(taskOfClaim);
        if (task) task.failedClaims += 1;
      }
      return { status: 204, body: null };
    },
  };
}

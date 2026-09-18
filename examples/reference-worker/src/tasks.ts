/**
 * The `tasks` Capability, arranged to be checked.
 *
 * Two Task types and a handful of open Tasks, one of which the Worker will not currently grant a
 * lease on — because TASK-11 has no witness against a Worker that always grants, and TASK-7's
 * `claimable` would otherwise be a field nobody has ever seen be false.
 */

const NAMESPACE = "tech.rowing.worker-protocol";

export const RAISES = {
  [`${NAMESPACE}.verify-vehicle`]: {
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
  [`${NAMESPACE}.price-a-quote`]: {
    payload: {
      type: "object",
      properties: { amount: { type: "number" } },
      required: ["amount"],
      additionalProperties: false,
    },
    answeredBy: ["price-quote"],
  },
} as const;

/** TASK-3: the Task types this Worker answers, which is its Skill. */
export const ANSWERS = [`${NAMESPACE}.verify-vehicle`] as const;

type Open = {
  id: string;
  type: string;
  payload: unknown;
  failedClaims: number;
  lapsedClaims: number;
  claimable: boolean;
};

const OPEN: Open[] = [
  {
    id: "task-1",
    type: `${NAMESPACE}.verify-vehicle`,
    payload: { vehicle: "ABC-123" },
    failedClaims: 0,
    lapsedClaims: 0,
    claimable: true,
  },
  {
    id: "task-2",
    type: `${NAMESPACE}.verify-vehicle`,
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
    type: `${NAMESPACE}.price-a-quote`,
    payload: { amount: 100 },
    failedClaims: 3,
    lapsedClaims: 1,
    claimable: false,
  },
];

export type Refusal = { status: number; code: string; message: string };
export type Answer = { status: number; body: unknown };

const LEASE_MS = 60_000;
const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function createTasks() {
  /** The Task a Claim holds, and which Claim is currently the Task's — TASK-17's fencing token. */
  const held = new Map<string, { claim: string; expires: number }>();
  let issued = 0;

  const reject = (status: number, code: string, message: string): Refusal => ({
    status,
    code,
    message,
  });

  const open = () => OPEN.filter((task) => !held.has(task.id));

  return {
    /** TASK-5, TASK-8 — a read of what is open. */
    read(query: URLSearchParams, covers?: string[]): Refusal | Answer {
      // ENDP-24: an unrecognized filter parameter is 400 and is never ignored. This surface takes
      // one filter and the cursor of ENDP-20, so everything else is a parameter it cannot know.
      for (const key of query.keys()) {
        if (key === "type" || key === "cursor") continue;
        return reject(400, "unknown_filter", `This address takes no parameter named ${key}.`);
      }

      const type = query.get("type");
      if (type !== null && !(type in RAISES)) {
        // TASK-8: a type the entry does not declare. The surface exists and the caller asked
        // about something this Worker never raises, which is a parameter whose VALUE this Worker
        // will not accept — MET-10's division rather than MET-9's.
        return reject(400, "invalid_parameter", `No Task type named ${type} is declared.`);
      }
      const matching = open()
        .filter((task) => type === null || task.type === type)
        // TASK-6: only what this credential covers. Absent, it covers everything.
        .filter((task) => covers === undefined || covers.includes(task.id));

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
      return next < matching.length
        ? { status: 200, body: { items, nextCursor: String(next) } }
        : { status: 200, body: { items } };
    },

    /** TASK-9 to TASK-14, TASK-17 — everything that changes a Claim. */
    write(query: URLSearchParams): Refusal | Answer {
      const taskId = query.get("task");
      const claimId = query.get("claim");

      if (taskId !== null) {
        const task = OPEN.find((candidate) => candidate.id === taskId);
        if (task === undefined) {
          return reject(404, "not_found", `No Task named ${taskId} is open.`);
        }
        // TASK-11: a Task the Worker will not currently grant a lease on.
        if (!task.claimable) {
          return reject(409, "conflict", "This Task is not being granted leases.");
        }
        // TASK-10: claiming is exclusive, and the store settles contention by first commit.
        if (held.has(task.id)) {
          return reject(409, "conflict", "This Task is already claimed.");
        }
        issued += 1;
        const expires = Date.now() + LEASE_MS;
        const claim = `claim-${issued}`;
        held.set(task.id, { claim, expires });
        // TASK-9, TASK-12: the Claim, and the instant the owner's lease expires.
        return { status: 200, body: { id: claim, task: task.id, expires: rfc3339(expires) } };
      }

      if (claimId === null) {
        return reject(400, "invalid_parameter", "A write names a Task or a Claim.");
      }

      const entry = [...held.entries()].find(([, value]) => value.claim === claimId);
      // TASK-17: a call naming a Claim that is no longer the Task's current one. A lapsed lease, a
      // released Claim and a Task reclaimed by somebody else are all this same check, and it is a
      // precondition at write time rather than two clocks agreeing about an instant.
      if (entry === undefined) {
        return reject(409, "conflict", "That Claim is no longer this Task's current one.");
      }
      const [taskOfClaim, current] = entry;

      const outcome = query.get("outcome");
      if (outcome === null) {
        // TASK-13: a renewal. The owner answers a new expiry, or refuses.
        current.expires = Date.now() + LEASE_MS;
        return {
          status: 200,
          body: { id: claimId, task: taskOfClaim, expires: rfc3339(current.expires) },
        };
      }

      if (!["done", "failed", "released"].includes(outcome)) {
        return reject(400, "invalid_parameter", "An outcome is done, failed or released.");
      }

      // TASK-14, TASK-15: the Claim closes and the Task does not. Its condition is derived from
      // this Worker's own Facts and nothing a consumer said bears on it, so `OPEN` is untouched.
      held.delete(taskOfClaim);
      return { status: 204, body: null };
    },
  };
}

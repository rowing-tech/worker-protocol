/**
 * The `tasks` Capability, arranged to be checked.
 *
 * Two Task types and a handful of open Tasks, one of which the Worker will not currently grant a
 * lease on — because TASK-11 has no witness against a Worker that always grants, and TASK-7's
 * `claimable` would otherwise be a field nobody has ever seen be false.
 *
 * The verify-vehicle Tasks hold by a condition this Worker can actually resolve: no verification
 * on record for the vehicle. That is what lets `record-verification` close one, which is TASK-15
 * working, and what gives TASK-22 something to witness — an outcome posted on a Claim whose Task
 * is already gone.
 *
 * What is NOT here any more is the whole Claim lifecycle: the lease, the fencing token, the lapse
 * counting, the paging, the filter refusal, who holds what. All of it is `mount()`'s now, which is
 * why this file is a third of what it was and none of what is left is a rule.
 */

import type { OpenTask } from "@worker-protocol/hono";
import type { taskTypeDeclaration } from "@worker-protocol/schemas";
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

const RAISED: (OpenTask & { vehicle?: string })[] = [
  { id: "task-1", type: VERIFY_VEHICLE, payload: { vehicle: "ABC-123" }, vehicle: "ABC-123" },
  { id: "task-2", type: VERIFY_VEHICLE, payload: { vehicle: "DEF-456" }, vehicle: "DEF-456" },
  // TASK-11: one the owner has stopped granting leases on, so `claimable` is a field a verifier
  // has seen be false. Its condition still holds, so it is stuck where an operator can see it.
  { id: "task-3", type: PRICE_A_QUOTE, payload: { amount: 100 } },
];

export function createTasks() {
  /** A Fact of this Worker's: the vehicles with a verification on record. */
  const verified = new Set<string>();

  return {
    /** The Action `record-verification` changes this Worker's Facts, and the Tasks follow. */
    verify: (vehicle: string) => verified.add(vehicle),

    /**
     * TASK-15: the condition, derived from this Worker's own Facts and from nothing anybody
     * declared. A verify-vehicle Task exists while its vehicle has no verification on record.
     */
    open: (): OpenTask[] =>
      RAISED.filter((task) => task.vehicle === undefined || !verified.has(task.vehicle)).map(
        ({ id, type, payload }) => ({ id, type, payload }),
      ),

    /** TASK-11: the owner stopped granting past a cap of its own choosing, and says so. */
    claimable: (task: OpenTask) => task.id !== "task-3",
  };
}

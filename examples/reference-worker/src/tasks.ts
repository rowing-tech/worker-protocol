/**
 * The `tasks` Capability, arranged to be checked.
 *
 * Two Task types, and conditions of different ages so that TASK-28's `since` carries something an
 * operator would read differently.
 *
 * The verify-vehicle Tasks hold by a condition this Worker can actually resolve: no verification
 * on record for the vehicle. That is what lets `record-verification` close one, which is TASK-15
 * working and is the only way anything here closes.
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

/** TASK-29: the Task types this Worker answers, which is its Skill. */
export const SKILLS: string[] = [VERIFY_VEHICLE];

const HOUR = 3_600_000;

const RAISED: (OpenTask & { vehicle?: string })[] = [
  {
    id: "task-1",
    type: VERIFY_VEHICLE,
    payload: { vehicle: "ABC-123" },
    vehicle: "ABC-123",
    since: new Date(Date.now() - HOUR),
  },
  {
    id: "task-2",
    type: VERIFY_VEHICLE,
    payload: { vehicle: "DEF-456" },
    vehicle: "DEF-456",
    since: new Date(Date.now() - 2 * HOUR),
  },
  // TASK-28: a condition that began three days ago, so the field a stuck Task is read from has
  // been seen carrying something an operator would act on rather than always saying `just now`.
  {
    id: "task-3",
    type: PRICE_A_QUOTE,
    payload: { amount: 100 },
    since: new Date(Date.now() - 72 * HOUR),
  },
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
    current: (): OpenTask[] =>
      RAISED.filter((task) => task.vehicle === undefined || !verified.has(task.vehicle)).map(
        ({ id, type, payload, since }) => ({ id, type, payload, since }),
      ),
  };
}

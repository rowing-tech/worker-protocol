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

import type { OpenTask, SkillDeclaration, TaskTypes } from "@worker-protocol/hono";
import * as z from "zod";

const NAMESPACE = "tech.rowing.worker-protocol";
export const VERIFY_VEHICLE = `${NAMESPACE}.verify-vehicle`;
export const PRICE_A_QUOTE = `${NAMESPACE}.price-a-quote`;

export const RAISES: TaskTypes = {
  [VERIFY_VEHICLE]: {
    payload: z.strictObject({ vehicle: z.string().min(1) }),
    // TASK-2: the closed list is a list of the OWNER's own Actions, by the names its `actions`
    // entry holds them under. A name that entry does not hold is a Descriptor disagreeing with
    // itself, which is the fault DESC-18 describes one level up.
    answeredBy: ["record-verification"],
  },
  [PRICE_A_QUOTE]: {
    payload: z.strictObject({ amount: z.number() }),
    answeredBy: ["price-quote"],
  },
};

/**
 * TASK-30: the Task types this Worker answers, each with the payload it needs to receive.
 *
 * It answers the type it also raises, which `examples/minimal-worker` deliberately does not — a
 * Worker that needs somebody to go and look at a vehicle cannot be that somebody, and the template
 * shows the ordinary case where the two point in opposite directions. Here they are the same on
 * purpose: a check that compares what one Worker sends against what another requires needs both
 * sides, and one arranged Worker standing on both is one server to start instead of two.
 */
export const SKILLS: Record<string, SkillDeclaration> = {
  [VERIFY_VEHICLE]: { payload: z.strictObject({ vehicle: z.string().min(1) }) },
};

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

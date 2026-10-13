import type { OpenTask } from "@worker-protocol/hono";
import type { Env } from "./env.ts";

/**
 * The domain, apart from where it is kept: what a quiet vehicle is, and the Task it becomes.
 *
 * Its own module because two others need it and need each other: `fleet.ts`, the object that keeps
 * the Facts and answers the protocol from inside itself, and `protocol.ts`, the declaration it
 * answers with. A constant either of those exported to the other would be read before the module
 * defining it had finished loading.
 */

/** What `wrangler.jsonc`'s cron runs at. `ingest` rewinds by it to find what crossed this cycle. */
export const CYCLE_MS = 60_000;

/** How long a vehicle may say nothing before it is quiet. The domain's number, not the protocol's. */
export const QUIET_AFTER_MS = 15 * CYCLE_MS;

/**
 * The window a deployment runs with: `QUIET_AFTER_MINUTES` where it is set, the default otherwise.
 *
 * A variable rather than only a constant because it is calibration, as a sensor's threshold is, and
 * because a Worker under test needs a vehicle to go quiet now rather than in fifteen minutes: the
 * conformance suite runs it at zero, so the cycle it performs raises a Task the verifier can watch
 * arrive at its sink.
 */
export const quietAfterMs = (env: Pick<Env, "QUIET_AFTER_MINUTES">): number => {
  const minutes =
    env.QUIET_AFTER_MINUTES === undefined ? Number.NaN : Number(env.QUIET_AFTER_MINUTES);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : QUIET_AFTER_MS;
};

/** The one Task type this Worker raises: a quiet vehicle, for whoever can go and look. */
export const QUIET_VEHICLE = "tech.rowing.fleet.inspect-quiet-vehicle";

/**
 * A quiet vehicle as the Task it is (TASK-28), written once for the two places that need it: what
 * `tasks` lists, and the `task-raised` and `task-ended` events this object enqueues at the moment
 * the condition starts and stops holding. Two spellings of the id would be a Task whose events name
 * something the list never shows.
 */
export const quietTask = (one: Quiet): OpenTask => ({
  id: `quiet:${one.vehicle}`,
  type: QUIET_VEHICLE,
  payload: { vehicle: one.vehicle },
  since: new Date(one.since),
});

/** One vehicle's last sign of life. */
export type Reading = { vehicle: string; at: number };

/** A vehicle whose condition holds, with the instant it began (TASK-28). */
export type Quiet = { vehicle: string; since: number };

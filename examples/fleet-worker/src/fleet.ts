import { DurableObject } from "cloudflare:workers";
import { withLogs, withOutbox, withOutcomes, withSubscriptions } from "@worker-protocol/cloudflare";
import { type OpenTask, taskEnded, taskRaised } from "@worker-protocol/hono";
import type { Env } from "./env.ts";

/**
 * Everything this Worker knows, in one Durable Object.
 *
 * **This is the object the rest of the repository has been describing and never had.** A Worker is
 * answered on every request and its Facts are not; the protocol's rules need state that outlives a
 * call — the Tasks whose conditions hold, the counters a metric is read from, the outcome ENDP-16
 * promised to replay — and until now every one of those lived in a `Map` in a process, which is
 * right in one deployment shape and wrong in the one this protocol's architecture names first.
 *
 * **What is the protocol's comes from `@worker-protocol/cloudflare`**, one mixin per piece: the
 * outcomes ENDP-16 replays, the subscriptions SUB-7 keeps, the outbox the events leave through and
 * the window of records LOG-2 serves. This Worker watches one fleet, so it composes all four in its
 * one object; a Worker that keeps an object per vehicle puts the outbox in each of those and the
 * subscriptions in the one it has for the fleet.
 *
 * **What is the domain's is below**, in the object's key-value API, because it needs ordering and
 * prefixes and nothing more. Every method is one logical operation: a Durable Object is
 * single-threaded and holds incoming events while a storage operation is outstanding, so a read and
 * a write inside one method cannot interleave with another request — and the outbox row a method
 * enqueues is written in the same transaction as the readings that raised it.
 */

/** What `wrangler.jsonc`'s cron runs at. `ingest` rewinds by it to find what crossed this cycle. */
const CYCLE_MS = 60_000;

/** How long a vehicle may say nothing before it is quiet. The domain's number, not the protocol's. */
export const QUIET_AFTER_MS = 15 * CYCLE_MS;

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

/**
 * The one object this Worker is authoritative over. It watches one fleet, so there is one.
 *
 * It lives here rather than in `worker.ts` for a reason worth knowing before writing a Worker on
 * this platform: **the entrypoint module may export only handlers and Durable Object classes.** A
 * constant exported beside them is refused by the runtime at startup — `Incorrect type for map
 * entry` — and refused at DEPLOY time rather than by the compiler, so the tests that import the
 * module rather than deploy it go on passing while `wrangler dev` will not start.
 */
export const fleetOf = (env: Pick<Env, "FLEET">) => env.FLEET.get(env.FLEET.idFromName("fleet"));

const READING = "reading:";
const INSPECTION = "inspection:";
const COUNTER = "counter:";

/** LOG-2. The window of records this Worker keeps. Its operators' number, not the protocol's. */
const KEEP_RECORDS = 500;

/** One vehicle's last sign of life. */
export type Reading = { vehicle: string; at: number };

/** A vehicle whose condition holds, with the instant it began (TASK-28). */
export type Quiet = { vehicle: string; since: number };

export class Fleet extends withLogs(
  withOutbox(withSubscriptions(withOutcomes(DurableObject<Env>)), {
    events: (env) => env.EVENTS,
  }),
  { keep: KEEP_RECORDS },
) {
  /**
   * One cycle's readings. Records what the source said, counts it, and raises events for each
   * vehicle that crossed into quiet on this cycle and not before, and for each that left it.
   *
   * The crossing is what makes an event rather than the state: `vehicle.went-quiet` is a Fact about
   * a moment, and publishing it on every cycle a vehicle stayed quiet would be publishing a state
   * under a name that says *changed*. The same crossing is when the Task is born, so `task-raised`
   * (EVT-15) is enqueued beside it — this is the moment only the Worker knows, and the reason the
   * SDK builds lifecycle events rather than detecting them. Answers how many events it sent.
   */
  async ingest(readings: Reading[], now: number, quietAfterMs: number): Promise<number> {
    // Who was already quiet one cycle ago. The window is a rewind rather than `now` on purpose: a
    // vehicle that crosses the threshold during THIS cycle is quiet at `now` and was not quiet a
    // cycle earlier, which is exactly the difference an event is raised for. Asking at `now` both
    // times would put every vehicle in both sets and raise nothing, ever.
    const before = await this.quiet(now - CYCLE_MS, quietAfterMs);
    const wasQuiet = new Set(before.map((one) => one.vehicle));

    // One write for every reading and one delete for every inspection it ends, rather than a pair
    // of awaits per vehicle. A reading is a sign of life, so it ends an inspection: this is not the
    // vehicle that was quiet, and the next silence is a new condition rather than the one somebody
    // already looked at.
    if (readings.length > 0) {
      await this.ctx.storage.put(
        Object.fromEntries(readings.map((one) => [`${READING}${one.vehicle}`, one.at])),
      );
      await this.ctx.storage.delete(readings.map((one) => `${INSPECTION}${one.vehicle}`));
    }
    await this.bump("readings-ingested", now, readings.length);

    // The crossings, derived once. Counting them as `nowQuiet.length - before.length` would have
    // been a second derivation of the same number, and the two disagree on any cycle where one
    // vehicle crossed into quiet while another reported its way out of it.
    const after = await this.quiet(now, quietAfterMs);
    const isQuiet = new Set(after.map((one) => one.vehicle));
    const crossed = after.filter((one) => !wasQuiet.has(one.vehicle));
    // The other direction: quiet a cycle ago and not now, because a reading arrived. Its Task ends
    // for that reason, and EVT-15's `task-ended` says only that it ended — nobody closed it.
    const recovered = before.filter((one) => !isQuiet.has(one.vehicle));
    await this.bump("vehicles-quiet", now, crossed.length);
    this.enqueue(now, [
      ...crossed.flatMap((one) => [
        {
          type: "tech.rowing.fleet.vehicle-went-quiet",
          data: { vehicle: one.vehicle, since: new Date(one.since).toISOString() },
        },
        taskRaised(quietTask(one)),
      ]),
      ...recovered.map((one) => taskEnded(quietTask(one))),
    ]);
    // The call ends by sending what it raised. What the events Queue does not take stays, in
    // order, and the alarm `withOutbox` keeps tries again — nothing here has to.
    return (await this.flush()).sent;
  }

  /** TASK-15: the condition. A vehicle is quiet while its last reading is old and uninspected. */
  async quiet(now: number, quietAfterMs: number): Promise<Quiet[]> {
    const readings = await this.ctx.storage.list<number>({ prefix: READING });
    const inspections = await this.ctx.storage.list<number>({ prefix: INSPECTION });
    const held: Quiet[] = [];
    for (const [key, at] of readings) {
      const vehicle = key.slice(READING.length);
      if (now - at < quietAfterMs) continue;
      if (inspections.has(`${INSPECTION}${vehicle}`)) continue;
      // TASK-28: the instant the condition began, which is when the vehicle fell silent and not
      // when somebody asked. A Worker that answered `now` here would tell an operator nothing.
      held.push({ vehicle, since: at + quietAfterMs });
    }
    return held.sort((a, b) => a.vehicle.localeCompare(b.vehicle));
  }

  /**
   * What `record-inspection` does: somebody looked, so the condition stops holding — and the Task
   * with it, which is the other moment only this Worker knows. An inspection of a vehicle that was
   * not quiet ends nothing, so it raises nothing.
   */
  async inspect(vehicle: string, at: number): Promise<void> {
    const ending = (await this.quiet(at, QUIET_AFTER_MS)).find((one) => one.vehicle === vehicle);
    await this.ctx.storage.put(`${INSPECTION}${vehicle}`, at);
    if (ending === undefined) return;
    this.enqueue(at, [taskEnded(quietTask(ending))]);
    await this.flush();
  }

  // ---- metrics -----------------------------------------------------------------------------

  /** One hour's bucket, which is the finest this Worker keeps and what coarser ones sum from. */
  private async bump(metric: string, now: number, by: number): Promise<void> {
    if (by <= 0) return;
    const hour = Math.floor(now / 3_600_000) * 3_600_000;
    const key = `${COUNTER}${metric}:${hour}`;
    await this.ctx.storage.put(key, ((await this.ctx.storage.get<number>(key)) ?? 0) + by);
  }

  /**
   * What a metric read answers, over buckets `mount()` already cut.
   *
   * The hourly counters are summed into whatever period was asked for, which is what MET-3's
   * `additive` declares of these two — and the reason a Worker declares it rather than a reader
   * assuming it.
   */
  async counters(metric: string, buckets: { start: number; end: number }[]): Promise<number[]> {
    const prefix = `${COUNTER}${metric}:`;
    const held = await this.ctx.storage.list<number>({ prefix });
    // Parsed once, not once per bucket: a year of hourly rows read over a month of daily buckets
    // is thirty passes of `slice` and `Number` over the same keys, for one pass of arithmetic.
    const hours = [...held].map(
      ([key, value]) => [Number(key.slice(prefix.length)), value] as const,
    );
    return buckets.map((bucket) =>
      hours.reduce(
        (total, [at, value]) => (at >= bucket.start && at < bucket.end ? total + value : total),
        0,
      ),
    );
  }
}

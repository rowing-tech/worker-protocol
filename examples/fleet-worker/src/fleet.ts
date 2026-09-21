import { DurableObject } from "cloudflare:workers";
import type { Recorded, Reservation } from "@worker-protocol/hono";
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
 * Storage is the durable object's own key-value API rather than SQL, because the domain below needs
 * ordering and prefixes and nothing more. Every method here is one logical operation, which is what
 * makes them safe: a durable object is single-threaded and its input gate holds incoming events
 * while a storage operation is outstanding, so a read and a write inside one method cannot
 * interleave with another request. That is the property `OutcomeStore.begin` needs and could not
 * have got from two calls.
 */

/** What `wrangler.jsonc`'s cron runs at. `ingest` rewinds by it to find what crossed this cycle. */
const CYCLE_MS = 60_000;

/** How long a vehicle may say nothing before it is quiet. The domain's number, not the protocol's. */
export const QUIET_AFTER_MS = 15 * CYCLE_MS;

/**
 * The one object this Worker is authoritative over. It watches one fleet, so there is one.
 *
 * It lives here rather than in `worker.ts` for a reason worth knowing before writing a Worker on
 * this platform: **the entrypoint module may export only handlers and Durable Object classes.** A
 * constant exported beside them is refused by the runtime at startup — `Incorrect type for map
 * entry` — and refused at DEPLOY time rather than by the compiler, so the tests that import the
 * module rather than deploy it go on passing while `wrangler dev` will not start.
 */
export const fleetOf = (env: Env) => env.FLEET.get(env.FLEET.idFromName("fleet"));

const READING = "reading:";
const INSPECTION = "inspection:";
const COUNTER = "counter:";
const OUTBOX = "outbox:";
const OUTCOME = "outcome:";

/** One vehicle's last sign of life. */
export type Reading = { vehicle: string; at: number };

/** A vehicle whose condition holds, with the instant it began (TASK-28). */
export type Quiet = { vehicle: string; since: number };

/**
 * What an event's `data` may be here: one flat record of scalars.
 *
 * It is spelled out rather than left as `unknown` because a durable object's methods are RPC, and
 * an RPC type carries only what structured clone carries — a method whose return type is not
 * serializable is not a method the stub has, which the compiler reports as `never` rather than as
 * anything mentioning serialization. It is flat rather than a recursive `Json` for the sequel to
 * that: the serializable check is itself a conditional type, and recursion through it exceeds the
 * compiler's instantiation depth. A real Worker with nested payloads keeps the envelope as a string
 * and parses it at publish. This one has two string fields and does not need to.
 */
export type Json = Record<string, string | number | boolean>;

/** One event waiting to reach the broker, as it is stored: its id is the key it is held under. */
type Row = { type: string; at: number; data: Json };

/** One event waiting to reach the broker, in the order it was raised, with its id read off the key. */
export type Pending = Row & { id: string };

/** A reservation is a row with no answer yet; both carry the instant they expire. */
type Outcome = { until: number; answer?: Recorded };

export class Fleet extends DurableObject<Env> {
  /**
   * One cycle's readings. Records what the source said, counts it, and raises an event for each
   * vehicle that crossed into quiet on this cycle and not before.
   *
   * The crossing is what makes an event rather than the state: `vehicle.went-quiet` is a Fact about
   * a moment, and publishing it on every cycle a vehicle stayed quiet would be publishing a state
   * under a name that says *changed*.
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
    const crossed = (await this.quiet(now, quietAfterMs)).filter(
      (one) => !wasQuiet.has(one.vehicle),
    );
    await this.bump("vehicles-quiet", now, crossed.length);
    await this.enqueue(
      now,
      crossed.map((one) => ({
        type: "tech.rowing.fleet.vehicle-went-quiet",
        data: { vehicle: one.vehicle, since: new Date(one.since).toISOString() },
      })),
    );
    return readings.length;
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

  /** What `record-inspection` does: somebody looked, so the condition stops holding. */
  async inspect(vehicle: string, at: number): Promise<void> {
    await this.ctx.storage.put(`${INSPECTION}${vehicle}`, at);
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

  // ---- the outbox --------------------------------------------------------------------------

  /**
   * An event raised and not yet published.
   *
   * It is a queue because publishing can fail and a Fact that was true does not stop being true
   * because a broker was down. EVT-8's republish window is what makes retrying safe: `source` and
   * `id` do not change between attempts, so a consumer that remembers them sees one event.
   */
  private async enqueue(at: number, events: { type: string; data: Json }[]): Promise<void> {
    if (events.length === 0) return;
    // The id is the key and is not repeated in the value: two copies of one fact are two things to
    // keep in step, and `pending` reads it back off the key it already has.
    await this.ctx.storage.put(
      Object.fromEntries(
        events.map((one) => [
          `${OUTBOX}${at}-${crypto.randomUUID()}`,
          { ...one, at } satisfies Row,
        ]),
      ),
    );
  }

  async pending(limit = 50): Promise<Pending[]> {
    const held = await this.ctx.storage.list<Row>({ prefix: OUTBOX, limit });
    return [...held].map(([key, row]) => ({ id: key.slice(OUTBOX.length), ...row }));
  }

  /**
   * How deep the outbox is and when the oldest event was raised, in one read.
   *
   * Both facts come off the same scan because both callers want them together: HLTH-3 takes the
   * Worker to `degraded` on the depth and ALRT-3 needs the instant the condition began. Asking
   * twice was two round trips to this object for one list.
   */
  async outbox(): Promise<{ depth: number; oldestAt: number | undefined }> {
    const held = await this.ctx.storage.list<Row>({ prefix: OUTBOX });
    return { depth: held.size, oldestAt: [...held.values()][0]?.at };
  }

  /** What went is forgotten; what did not stays, in order, for the next cycle. */
  async published(ids: string[]): Promise<void> {
    await this.ctx.storage.delete(ids.map((id) => `${OUTBOX}${id}`));
  }

  // ---- ENDP-16 -----------------------------------------------------------------------------

  /**
   * `OutcomeStore.begin`, and the reason this object exists at all rather than a Map.
   *
   * The read and the write below are one storage operation as far as another request is concerned:
   * the input gate holds incoming events while a storage operation is outstanding, so nothing
   * interleaves between finding the key free and taking it. Two callers under one key meet a
   * reservation, and only one of them performs.
   *
   * The return type is `Reservation` by name rather than the same union spelled out, and that is
   * worth a line: a durable object's methods are reached through a stub whose types are mapped, and
   * the mapping was wide enough to accept a shape `OutcomeStore` does not take. Spelled out, this
   * method shipped the wrong one and the compiler said nothing; named, it does not compile.
   */
  async beginOutcome(key: string, until: number): Promise<Reservation> {
    const row = await this.ctx.storage.get<Outcome>(`${OUTCOME}${key}`);
    const live = row !== undefined && row.until > Date.now();
    if (live && row.answer !== undefined) return { held: row.answer };
    if (live) return "in-flight";
    await this.ctx.storage.put(`${OUTCOME}${key}`, { until } satisfies Outcome);
    return "reserved";
  }

  async completeOutcome(key: string, answer: Recorded): Promise<void> {
    await this.ctx.storage.put(`${OUTCOME}${key}`, { until: answer.until, answer });
  }

  async releaseOutcome(key: string): Promise<void> {
    await this.ctx.storage.delete(`${OUTCOME}${key}`);
  }
}

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

const READING = "reading:";
const CHECK = "check:";
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

/** One event waiting to reach the broker, in the order it was raised. */
export type Pending = { id: string; type: string; at: number; data: Json };

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
    const before = await this.quiet(now - 60_000, quietAfterMs);
    const wasQuiet = new Set(before.map((one) => one.vehicle));

    for (const reading of readings) {
      await this.ctx.storage.put(`${READING}${reading.vehicle}`, reading.at);
      // A reading is a sign of life, so it ends a check: the vehicle is not the one that was quiet.
      await this.ctx.storage.delete(`${CHECK}${reading.vehicle}`);
    }
    await this.bump("readings-ingested", now, readings.length);

    const nowQuiet = await this.quiet(now, quietAfterMs);
    await this.bump("vehicles-quiet", now, nowQuiet.length - before.length);
    for (const one of nowQuiet) {
      if (wasQuiet.has(one.vehicle)) continue;
      await this.enqueue("tech.rowing.fleet.vehicle-went-quiet", now, {
        vehicle: one.vehicle,
        since: new Date(one.since).toISOString(),
      });
    }
    return readings.length;
  }

  /** TASK-15: the condition. A vehicle is quiet while its last reading is old and unchecked. */
  async quiet(now: number, quietAfterMs: number): Promise<Quiet[]> {
    const readings = await this.ctx.storage.list<number>({ prefix: READING });
    const checks = await this.ctx.storage.list<number>({ prefix: CHECK });
    const held: Quiet[] = [];
    for (const [key, at] of readings) {
      const vehicle = key.slice(READING.length);
      if (now - at < quietAfterMs) continue;
      if (checks.has(`${CHECK}${vehicle}`)) continue;
      // TASK-28: the instant the condition began, which is when the vehicle fell silent and not
      // when somebody asked. A Worker that answered `now` here would tell an operator nothing.
      held.push({ vehicle, since: at + quietAfterMs });
    }
    return held.sort((a, b) => a.vehicle.localeCompare(b.vehicle));
  }

  /** What `record-check` does: a verification is on record, so the condition stops holding. */
  async check(vehicle: string, at: number): Promise<void> {
    await this.ctx.storage.put(`${CHECK}${vehicle}`, at);
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
    const held = await this.ctx.storage.list<number>({ prefix: `${COUNTER}${metric}:` });
    return buckets.map((bucket) => {
      let total = 0;
      for (const [key, value] of held) {
        const at = Number(key.slice(`${COUNTER}${metric}:`.length));
        if (at >= bucket.start && at < bucket.end) total += value;
      }
      return total;
    });
  }

  // ---- the outbox --------------------------------------------------------------------------

  /**
   * An event raised and not yet published.
   *
   * It is a queue because publishing can fail and a Fact that was true does not stop being true
   * because a broker was down. EVT-8's republish window is what makes retrying safe: `source` and
   * `id` do not change between attempts, so a consumer that remembers them sees one event.
   */
  private async enqueue(type: string, at: number, data: Json): Promise<void> {
    const id = `${at}-${crypto.randomUUID()}`;
    await this.ctx.storage.put(`${OUTBOX}${id}`, { id, type, at, data } satisfies Pending);
  }

  async pending(limit = 50): Promise<Pending[]> {
    const held = await this.ctx.storage.list<Pending>({ prefix: OUTBOX, limit });
    return [...held.values()];
  }

  async depth(): Promise<number> {
    return (await this.ctx.storage.list({ prefix: OUTBOX })).size;
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

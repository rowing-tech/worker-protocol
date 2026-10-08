import { DurableObject } from "cloudflare:workers";
import type { OpenTask } from "@worker-protocol/hono";
import {
  type Flushed,
  type LifecycleSnapshot,
  withLifecycle,
  withLogs,
  withOutbox,
  withOutcomes,
  withSubscriptions,
} from "../src/index.ts";
import { outbound, TYPE } from "./outbound.ts";

/**
 * The two shapes a Worker on Cloudflare takes, as Durable Objects for this suite to run against.
 *
 * `Whole` carries every piece in one object, as `examples/fleet-worker` does. `Shard` carries an
 * outbox and nothing else, as each per-vehicle object of the Worker in production does — the shape
 * that decided this package would be mixins rather than one base class.
 */

export type TestEnv = {
  WHOLE: DurableObjectNamespace<Whole>;
  SHARD: DurableObjectNamespace<Shard>;
  CLOCK: DurableObjectNamespace<Clock>;
};

export class Whole extends withLogs(
  withOutbox(withSubscriptions(withOutcomes(DurableObject<TestEnv>)), {
    events: () => outbound.queue,
  }),
  { keep: 5 },
) {
  /** A domain write and the event it raises, in one call, then the flush — the pattern itself. */
  async change(id: string, at: number): Promise<Flushed> {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS thing (id TEXT PRIMARY KEY)");
    sql.exec("INSERT OR IGNORE INTO thing (id) VALUES (?)", id);
    this.enqueue(at, [{ type: TYPE, subject: id, data: { id }, id: `changed:${id}` }]);
    return this.flush();
  }

  /** How many times the domain's own instant came. */
  woken(): number {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS woken (at INTEGER)");
    return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM woken").one().n;
  }

  override wake(): void {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS woken (at INTEGER)");
    sql.exec("INSERT INTO woken (at) VALUES (?)", Date.now());
  }
}

export class Shard extends withOutbox(DurableObject<TestEnv>, { events: () => outbound.queue }) {
  async change(id: string, at: number): Promise<Flushed> {
    this.enqueue(at, [{ type: TYPE, data: { id }, id }]);
    return this.flush();
  }

  /** What Soriana's per-asset objects do once an asset is gone for long enough: empty themselves. */
  override async wake(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

/** The Task type `Clock` raises. */
export const CHECK = "tech.rowing.fleet.check";

/**
 * A domain whose Tasks are rows with an instant they begin and, maybe, one they end — so that what
 * holds at any instant is known and `withLifecycle` can be watched comparing it.
 */
export class Clock extends withLifecycle(
  withOutbox(DurableObject<TestEnv>, { events: () => outbound.queue }),
  { catchUpMs: 60 * 60_000 },
) {
  private rows() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS condition (id TEXT PRIMARY KEY, since INTEGER NOT NULL, until INTEGER)",
    );
    return sql;
  }

  /** A condition that holds from `since` until `until`, written without anybody announcing it. */
  hold(id: string, since: number, until?: number): void {
    this.rows().exec(
      "INSERT OR REPLACE INTO condition (id, since, until) VALUES (?, ?, ?)",
      id,
      since,
      until ?? null,
    );
  }

  /** An Action: ends a condition now, and owes what that changed in the same call. */
  async resolve(id: string, now: number): Promise<void> {
    this.changing(now, () =>
      this.rows().exec("UPDATE condition SET until = ? WHERE id = ?", now, id),
    );
    await this.flush();
  }

  /**
   * The Worker's own method under the name the mixin once used internally. It must change nothing
   * about what the mixin owes: a mixin's internals are functions of its module, which no subclass
   * reaches.
   */
  owe(): string {
    return "the domain's own";
  }

  /** Sets the mark, as a first run would, at `at`. */
  async start(at: number): Promise<void> {
    await this.advance(at);
  }

  snapshot(at: number): LifecycleSnapshot {
    const tasks: OpenTask[] = this.rows()
      .exec<{ id: string; since: number }>(
        "SELECT id, since FROM condition WHERE since <= ? AND (until IS NULL OR until > ?)",
        at,
        at,
      )
      .toArray()
      .map((row) => ({ id: row.id, type: CHECK, payload: {}, since: new Date(row.since) }));
    return { tasks, alerts: [] };
  }

  nextChange(after: number): number {
    const edges = this.rows()
      .exec<{ at: number }>(
        "SELECT since AS at FROM condition WHERE since > ? UNION SELECT until FROM condition WHERE until > ?",
        after,
        after,
      )
      .toArray()
      .map((row) => row.at);
    return Math.min(after + 60_000, ...edges);
  }
}

export default {
  fetch: () => new Response(null, { status: 404 }),
};

import { DurableObject } from "cloudflare:workers";
import {
  type Flushed,
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

export default {
  fetch: () => new Response(null, { status: 404 }),
};

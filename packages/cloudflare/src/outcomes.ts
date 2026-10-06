import type { OutcomeStore, Recorded, Reservation } from "@worker-protocol/hono";
import { type DurableObjectClass, ensure, first, type Mixed, type Rpc } from "./durable.ts";

/**
 * ENDP-16's store, in whichever Durable Object a Worker keeps its outcomes in.
 *
 * `beginOutcome` is the reason it is a Durable Object at all rather than a KV namespace: finding a
 * key free and taking it are one method, and a method is synchronous from its first statement to
 * its last, so no other request interleaves between the two. Two callers under one key meet a
 * reservation, and only one of them performs.
 */

const TABLES = [
  `CREATE TABLE IF NOT EXISTS wp_outcome (
    key TEXT PRIMARY KEY,
    until INTEGER NOT NULL,
    answer TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS wp_outcome_until ON wp_outcome (until)",
];

/** What `withOutcomes` adds to a Durable Object. */
export interface OutcomeMethods {
  beginOutcome(key: string, until: number): Reservation;
  completeOutcome(key: string, answer: Recorded): void;
  releaseOutcome(key: string): void;
}

export function withOutcomes<B extends DurableObjectClass>(Base: B): Mixed<B, OutcomeMethods> {
  abstract class WithOutcomes extends Base implements OutcomeMethods {
    /**
     * `OutcomeStore.begin`. The return type is `Reservation` by name: a stub's types are mapped,
     * and the mapping once accepted a shape `OutcomeStore` does not take when it was spelled out.
     */
    beginOutcome(key: string, until: number): Reservation {
      const sql = ensure(this.ctx.storage.sql, TABLES);
      const now = Date.now();
      // What has expired is nobody's any more, so it goes as soon as anybody asks: a window rather
      // than an archive, without a schedule of its own.
      sql.exec("DELETE FROM wp_outcome WHERE until <= ?", now);
      const row = first(
        sql.exec<{ answer: string | null }>("SELECT answer FROM wp_outcome WHERE key = ?", key),
      );
      if (row?.answer != null) return { held: JSON.parse(row.answer) as Recorded };
      if (row !== undefined) return "in-flight";
      sql.exec("INSERT INTO wp_outcome (key, until, answer) VALUES (?, ?, NULL)", key, until);
      return "reserved";
    }

    completeOutcome(key: string, answer: Recorded): void {
      const sql = ensure(this.ctx.storage.sql, TABLES);
      sql.exec(
        "INSERT OR REPLACE INTO wp_outcome (key, until, answer) VALUES (?, ?, ?)",
        key,
        answer.until,
        JSON.stringify(answer),
      );
    }

    releaseOutcome(key: string): void {
      const sql = ensure(this.ctx.storage.sql, TABLES);
      sql.exec("DELETE FROM wp_outcome WHERE key = ?", key);
    }
  }
  return WithOutcomes;
}

/** What `durableOutcomes` needs of a stub: the three methods `withOutcomes` adds, over RPC. */
export type OutcomesRpc = Rpc<OutcomeMethods>;

/** `actions.outcomes` for `mount()`, over the object that carries `withOutcomes`. */
export const durableOutcomes = (stub: OutcomesRpc): OutcomeStore => ({
  begin: (key, until) => stub.beginOutcome(key, until),
  complete: (key, held) => stub.completeOutcome(key, held),
  release: (key) => stub.releaseOutcome(key),
});

import type { StoredSubscription, SubscriptionStore } from "@worker-protocol/hono";
import { type DurableObjectClass, first, type Mixed, type Rpc } from "./durable.ts";
import { migrate, type Schema } from "./schema.ts";

/**
 * SUB-7's store, in the one Durable Object that holds a Worker's subscriptions.
 *
 * **One object, never one per shard.** SUB-7 has two requests for the same thing find one
 * subscription, which only a single consistent store can promise — so a Worker that keeps an object
 * per vehicle keeps its subscriptions in the one object it has for the whole fleet, and puts this
 * mixin there and nowhere else.
 *
 * SQL, because every publish asks for the live subscriptions naming a type (SUB-13) and every list
 * for one caller's (SUB-8), and both are filters. Each method is synchronous between its first
 * statement and its last, so nothing interleaves inside one — which is what `ensureSubscription`
 * needs, as `beginOutcome` does.
 *
 * **A subscription crosses the RPC boundary as JSON.** Its filters nest by definition, and a stub's
 * types are a conditional mapping that exceeds the compiler's instantiation depth on a recursive
 * type. `durableSubscriptions` does the parsing, so a Worker never sees the strings.
 */

/** `migrate` applies these; a new step goes at the end, and a published one is never edited. */
const SCHEMA: Schema = {
  piece: "worker-protocol.subscriptions",
  steps: [
    // 1. The tables as first released, `IF NOT EXISTS` so an object that already has them adopts them.
    [
      // The subscription itself is `record`. `key`, `caller` and `ended` are copied out of it only
      // because a query filters on them; nothing reads them back.
      `CREATE TABLE IF NOT EXISTS wp_subscription (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        caller TEXT,
        ended INTEGER NOT NULL,
        record TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS wp_subscription_key ON wp_subscription (key)",
    ],
  ],
};

/** What `withSubscriptions` adds to a Durable Object. Every subscription crosses as JSON. */
export interface SubscriptionMethods {
  findSubscription(key: string): string | null;
  ensureSubscription(key: string, candidate: string): { record: string; created: boolean };
  getSubscription(id: string): string | null;
  subscriptionsOf(caller: string | null): string[];
  subscriptionsFor(type: string): string[];
  updateSubscription(id: string, change: { set: string; clear: string[] }): void;
  removeSubscription(id: string): void;
}

export function withSubscriptions<B extends DurableObjectClass>(
  Base: B,
): Mixed<B, SubscriptionMethods> {
  abstract class WithSubscriptions extends Base implements SubscriptionMethods {
    findSubscription(key: string): string | null {
      const sql = migrate(this.ctx.storage, SCHEMA);
      const row = first(
        sql.exec<{ record: string }>(
          "SELECT record FROM wp_subscription WHERE key = ? AND ended = 0 LIMIT 1",
          key,
        ),
      );
      return row?.record ?? null;
    }

    /** SUB-7, SUB-15: the live one under `key`, or the candidate. An ended one stays, listed. */
    ensureSubscription(key: string, candidate: string): { record: string; created: boolean } {
      const held = this.findSubscription(key);
      if (held !== null) return { record: held, created: false };
      const one = JSON.parse(candidate) as StoredSubscription;
      migrate(this.ctx.storage, SCHEMA).exec(
        "INSERT INTO wp_subscription (id, key, caller, ended, record) VALUES (?, ?, ?, 0, ?)",
        one.id,
        key,
        one.caller,
        candidate,
      );
      return { record: candidate, created: true };
    }

    getSubscription(id: string): string | null {
      const sql = migrate(this.ctx.storage, SCHEMA);
      const row = first(
        sql.exec<{ record: string }>("SELECT record FROM wp_subscription WHERE id = ?", id),
      );
      return row?.record ?? null;
    }

    /** SUB-8: one caller's, ended ones included. `IS` because a caller may be `null`. */
    subscriptionsOf(caller: string | null): string[] {
      const sql = migrate(this.ctx.storage, SCHEMA);
      return sql
        .exec<{ record: string }>("SELECT record FROM wp_subscription WHERE caller IS ?", caller)
        .toArray()
        .map((row) => row.record);
    }

    /** SUB-13: the live ones naming this type. The filters are the hub's to apply. */
    subscriptionsFor(type: string): string[] {
      const sql = migrate(this.ctx.storage, SCHEMA);
      return sql
        .exec<{ record: string }>(
          `SELECT record FROM wp_subscription
            WHERE ended = 0
              AND EXISTS (SELECT 1 FROM json_each(record, '$.types') WHERE value = ?)`,
          type,
        )
        .toArray()
        .map((row) => row.record);
    }

    /**
     * A patch, as two lists because JSON cannot say *cleared*: `JSON.stringify` drops a member
     * whose value is `undefined`, which is exactly how `SubscriptionStore.update` names one to
     * clear.
     */
    updateSubscription(id: string, change: { set: string; clear: string[] }): void {
      const held = this.getSubscription(id);
      if (held === null) return;
      const next: Record<string, unknown> = { ...JSON.parse(held), ...JSON.parse(change.set) };
      for (const name of change.clear) delete next[name];
      migrate(this.ctx.storage, SCHEMA).exec(
        "UPDATE wp_subscription SET ended = ?, record = ? WHERE id = ?",
        next.endedAt === undefined ? 0 : 1,
        JSON.stringify(next),
        id,
      );
    }

    removeSubscription(id: string): void {
      const sql = migrate(this.ctx.storage, SCHEMA);
      sql.exec("DELETE FROM wp_subscription WHERE id = ?", id);
    }
  }
  return WithSubscriptions;
}

/** What `durableSubscriptions` needs of a stub: the methods `withSubscriptions` adds, over RPC. */
export type SubscriptionsRpc = Rpc<SubscriptionMethods>;

const parse = (record: string) => JSON.parse(record) as StoredSubscription;

/** `subscriptions.store` for `mount()` and `eventHub()`, over the object with `withSubscriptions`. */
export const durableSubscriptions = (stub: SubscriptionsRpc): SubscriptionStore => {
  const read = (record: string | null) => (record === null ? undefined : parse(record));
  return {
    find: async (key) => read(await stub.findSubscription(key)),
    ensure: async (key, candidate) => {
      const { record, created } = await stub.ensureSubscription(key, JSON.stringify(candidate));
      return { subscription: parse(record), created };
    },
    get: async (id) => read(await stub.getSubscription(id)),
    list: async (caller) => (await stub.subscriptionsOf(caller)).map(parse),
    forType: async (type) => (await stub.subscriptionsFor(type)).map(parse),
    // `undefined` names a member to clear, and JSON drops it — so the cleared ones go by name.
    update: (id, patch) =>
      stub.updateSubscription(id, {
        set: JSON.stringify(patch),
        clear: Object.entries(patch)
          .filter(([, value]) => value === undefined)
          .map(([name]) => name),
      }),
    remove: (id) => stub.removeSubscription(id),
  };
};

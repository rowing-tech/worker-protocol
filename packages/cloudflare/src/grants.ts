import type { GrantStore, StoredGrant } from "@worker-protocol/hono";
import { type DurableObjectClass, first, type Mixed, type Rpc } from "./durable.ts";
import { migrate, type Schema } from "./schema.ts";

/**
 * The grant store, in the one Durable Object that holds a Worker's grants.
 *
 * **`putGrant` compares and sets, and that is the one thing a grant store has to be consistent
 * about.** Applying a grant reads it, mints a credential, then writes (GRANT-4, GRANT-5), and two
 * applications racing through that would both answer a credential while the second write silently
 * invalidated the first. The write here happens only where the serial held under the grant's
 * applicant and id is the one the caller expected, and a method is synchronous from its first
 * statement to its last, so the comparison and the write cannot interleave with another request —
 * which a KV namespace could not promise, and which is why this is a Durable Object at all, as
 * `beginOutcome` is.
 *
 * **One object, never one per shard**, for the reason the subscriptions have: a Worker that keeps
 * an object per vehicle keeps its grants in the one it has for the fleet.
 *
 * `grantByDigest` is asked on every request that carries a credential, grant or not (GRANT-8), so
 * the digest is indexed and a miss is one lookup. A grant crosses the RPC boundary as JSON, as a
 * subscription does, so the mixin and `durableGrants` agree on one shape.
 */

/** `migrate` applies these; a new step goes at the end, and a published one is never edited. */
const SCHEMA: Schema = {
  piece: "worker-protocol.grants",
  steps: [
    // 1. The table as first released, `IF NOT EXISTS` so an object that already has it adopts it.
    [
      // The grant itself is `record`. `serial` is copied out because the compare-and-set reads it,
      // and `digest` because every credentialed request looks one up.
      `CREATE TABLE IF NOT EXISTS wp_grant (
        applicant TEXT NOT NULL,
        id TEXT NOT NULL,
        serial INTEGER NOT NULL,
        digest TEXT NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (applicant, id)
      )`,
      "CREATE INDEX IF NOT EXISTS wp_grant_digest ON wp_grant (digest)",
    ],
  ],
};

/** What `withGrants` adds to a Durable Object. Every grant crosses as JSON. */
export interface GrantMethods {
  getGrant(applicant: string, id: string): string | null;
  grantByDigest(digest: string): string | null;
  putGrant(record: string, expected: number | null): boolean;
  removeGrant(applicant: string, id: string): boolean;
  grantsOf(applicant: string): string[];
}

export function withGrants<B extends DurableObjectClass>(Base: B): Mixed<B, GrantMethods> {
  abstract class WithGrants extends Base implements GrantMethods {
    getGrant(applicant: string, id: string): string | null {
      const sql = migrate(this.ctx.storage, SCHEMA);
      const row = first(
        sql.exec<{ record: string }>(
          "SELECT record FROM wp_grant WHERE applicant = ? AND id = ?",
          applicant,
          id,
        ),
      );
      return row?.record ?? null;
    }

    /** GRANT-8, GRANT-9: the grant whose CURRENT credential has this digest, or none. */
    grantByDigest(digest: string): string | null {
      const sql = migrate(this.ctx.storage, SCHEMA);
      const row = first(
        sql.exec<{ record: string }>("SELECT record FROM wp_grant WHERE digest = ?", digest),
      );
      return row?.record ?? null;
    }

    /**
     * `GrantStore.put`: written only where the serial held is `expected` — `null` for none — and
     * answers whether it wrote. Replacing the row replaces the digest, so a credential issued
     * before a rotation is no longer found by `grantByDigest` (GRANT-9).
     */
    putGrant(record: string, expected: number | null): boolean {
      const sql = migrate(this.ctx.storage, SCHEMA);
      const grant = JSON.parse(record) as StoredGrant;
      const held = first(
        sql.exec<{ serial: number }>(
          "SELECT serial FROM wp_grant WHERE applicant = ? AND id = ?",
          grant.applicant,
          grant.id,
        ),
      );
      if ((held?.serial ?? null) !== expected) return false;
      sql.exec(
        "INSERT OR REPLACE INTO wp_grant (applicant, id, serial, digest, record) VALUES (?, ?, ?, ?, ?)",
        grant.applicant,
        grant.id,
        grant.serial,
        grant.digest,
        record,
      );
      return true;
    }

    /** GRANT-7: whether there was a grant to revoke. */
    removeGrant(applicant: string, id: string): boolean {
      const sql = migrate(this.ctx.storage, SCHEMA);
      const held = this.getGrant(applicant, id) !== null;
      if (held) sql.exec("DELETE FROM wp_grant WHERE applicant = ? AND id = ?", applicant, id);
      return held;
    }

    /** GRANT-6: one applicant's grants, and nobody else's. */
    grantsOf(applicant: string): string[] {
      const sql = migrate(this.ctx.storage, SCHEMA);
      return sql
        .exec<{ record: string }>(
          "SELECT record FROM wp_grant WHERE applicant = ? ORDER BY id",
          applicant,
        )
        .toArray()
        .map((row) => row.record);
    }
  }
  return WithGrants;
}

/** What `durableGrants` needs: the methods `withGrants` adds, from a stub or the object itself. */
export type GrantsRpc = Rpc<GrantMethods> | GrantMethods;

const parse = (record: string) => JSON.parse(record) as StoredGrant;

/**
 * `grants.store` for `mount()` and `eventHub()`, over the object with `withGrants`: a stub, or the
 * object itself where `mount()` runs inside it and every call is local.
 */
export const durableGrants = (stub: GrantsRpc): GrantStore => {
  const read = (record: string | null) => (record === null ? undefined : parse(record));
  return {
    get: async (applicant, id) => read(await stub.getGrant(applicant, id)),
    byDigest: async (digest) => read(await stub.grantByDigest(digest)),
    put: (grant, expected) => stub.putGrant(JSON.stringify(grant), expected),
    remove: (applicant, id) => stub.removeGrant(applicant, id),
    list: async (applicant) => (await stub.grantsOf(applicant)).map(parse),
  };
};

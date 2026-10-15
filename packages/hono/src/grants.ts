/**
 * The `grants` surface: what a Contract's credential covers on this Worker, applied ahead of time by
 * whoever brokered the Contract, and the credential the Worker issues for it.
 *
 * **The Worker never holds a credential it issued, only its digest.** `mount()` mints an opaque
 * token on creation and on a rotation, answers it once, and hands the store its SHA-256; a
 * credential presented later is looked up by the same digest. A store that leaks leaks no
 * credential, and there is nothing at rest for a window to answer twice — which is why applying is
 * not idempotent through a key (`spec/grants.md`).
 *
 * **Coverage is derived here, so a Worker that declares `grants` needs no `covers`.** A credential
 * issued for a grant reads the Tasks of the types it names, performs the Actions it names and
 * subscribes to the event types it names, and never more (GRANT-8). The Worker's own `tasks.covers`,
 * `actions.covers` and `subscriptions.allows` are still asked, and may only narrow inside the grant:
 * the grant bounds, the Worker refuses by rules of its own domain. A credential no grant issued —
 * the Tower's, the operator's — is covered by those hooks alone, as before.
 */

import { grantRequest } from "@worker-protocol/schemas";
import type * as z from "zod";
import { readJson, schemaMismatch } from "./actions.ts";
import type { ErrorCode } from "./codes.ts";
import type { Answer, Refusal } from "./worker.ts";

/** GRANT-3: one of a grant's three lists — every name, or these. */
export type Covered = "all" | string[];

/** GRANT-8: what a credential issued for a grant covers. */
export type Coverage = { tasks: Covered; actions: Covered; events: Covered };

/** One grant as a store holds it. */
export type StoredGrant = Coverage & {
  /** GRANT-2: the caller that applied it, or `null` where `authenticate` names none. */
  applicant: string | null;
  /** GRANT-4: the applicant's id for it, unique only beside the applicant. */
  id: string;
  /** The SHA-256 of the credential issued for it last, base64url. Never the credential itself. */
  digest: string;
  /**
   * How many credentials have been issued for it. A rotation moves it, and the caller a grant's
   * credential is named by carries it, so a subscription made under the previous credential is
   * one the current one does not own (GRANT-9).
   */
  serial: number;
};

/**
 * Where a Worker keeps its grants.
 *
 * **`put` compares and sets, and that is the one thing a store has to be consistent about.** It
 * writes only where the serial it holds under the grant's applicant and id is `expected` — `null`
 * for none — and answers whether it wrote. Applying reads the grant, mints, then writes, and two
 * applications racing through that would both answer a credential while the second write silently
 * invalidated the first; with the comparison the loser writes nothing and is answered `503`, and
 * its applicant tries again. A store split across calls — a query, then a mutation — is exactly
 * where the race is reachable, so the comparison belongs inside the write, as `SubscriptionStore`'s
 * `ensure` does. A write replaces the digest too, so a credential issued before a rotation is no
 * longer found by `byDigest`.
 *
 * `byDigest` is asked on every request that carries a credential, grant or not, so a store answers a
 * miss cheaply: an index on the digest.
 */
export type GrantStore = {
  get: (
    applicant: string | null,
    id: string,
  ) => StoredGrant | undefined | Promise<StoredGrant | undefined>;
  /** The grant whose current credential has this digest. */
  byDigest: (digest: string) => StoredGrant | undefined | Promise<StoredGrant | undefined>;
  put: (grant: StoredGrant, expected: number | null) => boolean | Promise<boolean>;
  /** Whether there was a grant to remove. */
  remove: (applicant: string | null, id: string) => boolean | Promise<boolean>;
  /** GRANT-6: every grant of one applicant. */
  list: (applicant: string | null) => StoredGrant[] | Promise<StoredGrant[]>;
};

/** What a Worker declares and hands `mount()` for `grants`. */
export type GrantFacts = {
  store: GrantStore;
  /**
   * GRANT-2. Whether this caller may apply grants here — by the identity `authenticate` names, and
   * with whom it accepted. Required, so nobody becomes an applicant by omission; a credential
   * issued for a grant is refused before this is asked.
   */
  applicants: (caller: string | null, principal: unknown) => boolean | Promise<boolean>;
};

/** A store in memory: right in one long-lived process, on `memoryOutcomes()`'s terms. */
export const memoryGrants = (): GrantStore => {
  const held = new Map<string, StoredGrant>();
  const digests = new Map<string, string>();
  const keyOf = (applicant: string | null, id: string) => JSON.stringify([applicant, id]);
  return {
    get: (applicant, id) => held.get(keyOf(applicant, id)),
    byDigest: (digest) => {
      const key = digests.get(digest);
      return key === undefined ? undefined : held.get(key);
    },
    put: (grant, expected) => {
      const key = keyOf(grant.applicant, grant.id);
      const before = held.get(key);
      if ((before?.serial ?? null) !== expected) return false;
      if (before !== undefined) digests.delete(before.digest);
      held.set(key, grant);
      digests.set(grant.digest, key);
      return true;
    },
    remove: (applicant, id) => {
      const key = keyOf(applicant, id);
      const before = held.get(key);
      if (before === undefined) return false;
      digests.delete(before.digest);
      return held.delete(key);
    },
    list: (applicant) => [...held.values()].filter((one) => one.applicant === applicant),
  };
};

/** The digest a credential is stored and looked up under. */
export const digestOf = async (credential: string): Promise<string> => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  return base64url(new Uint8Array(bytes));
};

/** A fresh credential: 32 random bytes, which is more than anybody guesses. */
const mint = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/**
 * The caller a grant's credential is named by (ENDP-34, SUB-8). A JSON tuple, so no applicant or id
 * can forge another's, and carrying the serial, so a rotation is a new caller.
 */
export const grantCaller = (grant: Pick<StoredGrant, "applicant" | "id" | "serial">): string =>
  JSON.stringify(["grant", grant.applicant, grant.id, grant.serial]);

/** The grant a caller names, where it is a grant's credential's. */
export const grantOf = (
  caller: string | null,
): { applicant: string | null; id: string; serial: number } | undefined => {
  if (caller === null || !caller.startsWith('["grant",')) return undefined;
  try {
    const [, applicant, id, serial] = JSON.parse(caller) as [string, string | null, string, number];
    return { applicant, id, serial };
  } catch {
    return undefined;
  }
};

/** Whether a list covers one name. */
export const covers = (list: Covered, name: string): boolean =>
  list === "all" || list.includes(name);

/**
 * GRANT-8: the names a credential covers, where the grant bounds and the Worker's own hook may only
 * narrow. `undefined` is every name: no grant list and no hook, or `all` and no hook.
 */
export const within = (granted: Covered | undefined, own: string[] | undefined) => {
  const bound = granted === undefined || granted === "all" ? undefined : granted;
  if (bound === undefined) return own;
  return own === undefined ? bound : bound.filter((name) => own.includes(name));
};

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

const listed = (grant: StoredGrant) => ({
  id: grant.id,
  tasks: grant.tasks,
  actions: grant.actions,
  events: grant.events,
});

export function grantsSurface(config: {
  facts: GrantFacts;
  /** GRANT-3: what the Worker declares, which is all a grant may name. */
  declared: { tasks: string[]; actions: string[]; events: string[] };
}) {
  const { facts, declared } = config;

  return {
    /** GRANT-6: this applicant's grants, by id, and never a credential. */
    async list(applicant: string | null): Promise<Record<string, unknown>> {
      const all = await facts.store.list(applicant);
      return { items: [...all].sort((a, b) => a.id.localeCompare(b.id)).map(listed) };
    },

    /** GRANT-7: revokes one of this applicant's grants, or answers that it holds none. */
    async revoke(asked: { applicant: string | null; id: string }): Promise<Answer | Refusal> {
      const removed = await facts.store.remove(asked.applicant, asked.id);
      if (!removed) return refuse("not_found", "No such grant.");
      return { status: 204, body: null };
    },

    /** GRANT-3 to GRANT-5: creates, replaces, or rotates. */
    async apply(asked: { applicant: string | null; raw: string }): Promise<Answer | Refusal> {
      const read = readJson(asked.raw);
      if ("code" in read) return read;
      const request = grantRequest.safeParse(read.parsed);
      if (!request.success) return schemaMismatch(request.error);
      const { id, rotate, ...lists } = request.data as z.infer<typeof grantRequest>;

      // GRANT-3: a name the Worker does not declare is refused rather than quietly dropped.
      for (const which of ["tasks", "actions", "events"] as const) {
        const list = lists[which];
        const unknown = list === "all" ? undefined : list.find((n) => !declared[which].includes(n));
        if (unknown !== undefined) {
          return refuse("unprocessable_content", `This Worker declares no ${unknown}.`);
        }
      }

      const existing = await facts.store.get(asked.applicant, id);
      // GRANT-4: creating issues a credential. GRANT-5: replacing does not, unless asked to rotate.
      const issues = existing === undefined || rotate === true;
      const credential = issues ? mint() : undefined;
      const stored: StoredGrant = {
        applicant: asked.applicant,
        id,
        ...lists,
        digest:
          credential === undefined ? (existing as StoredGrant).digest : await digestOf(credential),
        serial: (existing?.serial ?? 0) + (issues ? 1 : 0),
      };
      // Another application of the same grant wrote between the read and this write: nothing is
      // written, no credential is handed out, and the applicant tries again (ENDP-40's `retry`).
      if (!(await facts.store.put(stored, existing?.serial ?? null))) {
        return refuse("unavailable", "This grant is being applied right now.");
      }
      return {
        status: existing === undefined ? 201 : 200,
        body: { ...listed(stored), ...(credential === undefined ? {} : { credential }) },
      };
    },
  };
}

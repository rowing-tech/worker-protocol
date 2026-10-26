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
import { readJson, schemaMismatch } from "./actions.ts";
import type { ErrorCode } from "./codes.ts";
import type { Answer, CallContext, Refusal } from "./worker.ts";

/** GRANT-3: one of a grant's three lists — every name, or these. */
export type Covered = "all" | string[];

/** GRANT-8: what a credential issued for a grant covers. */
export type Coverage = { tasks: Covered; actions: Covered; events: Covered };

/** One grant as a store holds it. */
export type StoredGrant = Coverage & {
  /** GRANT-2: the caller that applied it, as `authenticate` named it. Never unnamed. */
  applicant: string;
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
    applicant: string,
    id: string,
  ) => StoredGrant | undefined | Promise<StoredGrant | undefined>;
  /** The grant whose current credential has this digest. */
  byDigest: (digest: string) => StoredGrant | undefined | Promise<StoredGrant | undefined>;
  put: (grant: StoredGrant, expected: number | null) => boolean | Promise<boolean>;
  /** Whether there was a grant to remove. */
  remove: (applicant: string, id: string) => boolean | Promise<boolean>;
  /** GRANT-6: every grant of one applicant. */
  list: (applicant: string) => StoredGrant[] | Promise<StoredGrant[]>;
};

/** What a Worker declares and hands `mount()` for `grants`. */
export type GrantFacts = {
  store: GrantStore;
  /**
   * GRANT-2. Whether this caller may apply grants here — by `call.caller`, the identity
   * `authenticate` named, and `call.principal`, whom it accepted. Required, so nobody becomes an applicant by omission; a credential
   * issued for a grant is refused before this is asked.
   */
  applicants: (call: CallContext & { caller: string }) => boolean | Promise<boolean>;
};

/** A store in memory: right in one long-lived process, on `memoryOutcomes()`'s terms. */
export const memoryGrants = (): GrantStore => {
  const held = new Map<string, StoredGrant>();
  const digests = new Map<string, string>();
  const keyOf = (applicant: string, id: string) => JSON.stringify([applicant, id]);
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

/**
 * Whether a token has the shape `mint()` gives: 43 base64url characters. Anything else — a JWT, a
 * prefixed API key, the Tower's own secret — was never issued for a grant, and `mount()` asks the
 * grant store nothing about it, so a poll does not pay a store read for a credential that cannot
 * match.
 */
export const mayBeIssued = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/**
 * The caller a grant's credential is named by (ENDP-34, SUB-8). A JSON tuple, so no applicant or id
 * can forge another's, and carrying the serial, so a rotation is a new caller.
 *
 * The string is this package's encoding, not a format: read one back with `grantOf`, its inverse,
 * rather than parsing it, so that a change to the encoding is a change to two functions here and to
 * nothing downstream.
 */
export const grantCaller = (grant: Pick<StoredGrant, "applicant" | "id" | "serial">): string =>
  JSON.stringify(["grant", grant.applicant, grant.id, grant.serial]);

/**
 * The grant a caller names, where it is a grant's credential's (SUB-8, GRANT-9): its applicant, its
 * id, and the serial of the credential, which a rotation advances. `undefined` for every other caller
 * — one `authenticate` named, and `null` where it named none — so this is how something holding a
 * stored caller, a subscription's above all, tells a grant's credential's from anybody else's.
 */
export const grantOf = (
  caller: string | null,
): { applicant: string; id: string; serial: number } | undefined => {
  if (caller === null || !caller.startsWith('["grant",')) return undefined;
  let named: unknown;
  try {
    named = JSON.parse(caller);
  } catch {
    return undefined;
  }
  // Exactly what `grantCaller` writes, or nothing: a string that merely starts like one is not a
  // grant's, and answering it with an applicant that is not a string would lie about the type.
  if (
    !Array.isArray(named) ||
    named.length !== 4 ||
    typeof named[1] !== "string" ||
    typeof named[2] !== "string" ||
    !Number.isInteger(named[3])
  ) {
    return undefined;
  }
  return { applicant: named[1], id: named[2], serial: named[3] };
};

/** Which grant a performance came under: its applicant and its id, which is all `contract` needs. */
export type GrantRef = { applicant: string; id: string };

/**
 * MET-23: the value a Worker records under a `contract` dimension for what came under a grant, and
 * the value `mount()` turns a caller's `contract=<id>` into before the Worker's `read` sees it. An id
 * means something only beside its applicant, so the value is both, as a JSON tuple nothing can forge;
 * a caller fixing an id it holds no grant under asks for a value nothing was ever recorded under.
 */
export const contractKey = (grant: GrantRef): string =>
  JSON.stringify(["contract", grant.applicant, grant.id]);

/** Whether a list covers one name. */
export const listCovers = (list: Covered, name: string): boolean =>
  list === "all" || list.includes(name);

/**
 * GRANT-8: the names a credential covers, where the grant bounds and the Worker's own hook may only
 * narrow. `undefined` is every name: no grant list and no hook, or `all` and no hook.
 */
export const within = (granted: Covered | undefined, own: string[] | undefined) => {
  if (granted === undefined || granted === "all") return own;
  return own === undefined ? granted : granted.filter((name) => own.includes(name));
};

/**
 * What one request's credential covers, worked out in one place for every surface that divides it:
 * the grant bounds (GRANT-8) and the Worker's own hooks narrow inside it (TASK-6, ACT-22). Each half
 * asks its hook at most once, and only when a surface needs it.
 */
export type Covering = {
  /** TASK-6, GRANT-8: whether this credential reads a Task. */
  tasks: () => Promise<(task: { id: string; type: string }) => boolean>;
  /** ACT-22, GRANT-8: the Actions it covers, by name, or `undefined` for all of them. */
  actions: () => Promise<string[] | undefined>;
};

type Hook = () => string[] | undefined | Promise<string[] | undefined>;

export const coveringOf = (given: {
  /** What the grant names, where a grant issued the credential. */
  grant: Coverage | undefined;
  /** The Worker's own `tasks.covers` and `actions.covers`, bound to this request. */
  own: { tasks?: Hook; actions?: Hook };
}): Covering => {
  const { grant, own } = given;
  let tasks: Promise<(task: { id: string; type: string }) => boolean> | undefined;
  let actions: Promise<string[] | undefined> | undefined;
  return {
    tasks: () => {
      tasks ??= Promise.resolve(own.tasks?.()).then(
        (ids) => (task) =>
          (grant === undefined || listCovers(grant.tasks, task.type)) &&
          (ids === undefined || ids.includes(task.id)),
      );
      return tasks;
    },
    actions: () => {
      actions ??= Promise.resolve(own.actions?.()).then((names) => within(grant?.actions, names));
      return actions;
    },
  };
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
    async list(applicant: string): Promise<Record<string, unknown>> {
      const all = await facts.store.list(applicant);
      return { items: [...all].sort((a, b) => a.id.localeCompare(b.id)).map(listed) };
    },

    /** GRANT-7: revokes one of this applicant's grants, or answers that it holds none. */
    async revoke(asked: { applicant: string; id: string }): Promise<Answer | Refusal> {
      const removed = await facts.store.remove(asked.applicant, asked.id);
      if (!removed) return refuse("not_found", "No such grant.");
      return { status: 204, body: null };
    },

    /** GRANT-3 to GRANT-5: creates, replaces, or rotates. */
    async apply(asked: { applicant: string; raw: string }): Promise<Answer | Refusal> {
      const read = readJson(asked.raw);
      if ("code" in read) return read;
      const request = grantRequest.safeParse(read.parsed);
      if (!request.success) return schemaMismatch(request.error);
      const { id, rotate, ...lists } = request.data;

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
      let credential: string | undefined;
      let stored: StoredGrant;
      if (existing !== undefined && rotate !== true) {
        stored = { ...existing, ...lists };
      } else {
        credential = mint();
        stored = {
          applicant: asked.applicant,
          id,
          ...lists,
          digest: await digestOf(credential),
          serial: (existing?.serial ?? 0) + 1,
        };
      }
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

import type { DurableObject } from "cloudflare:workers";

/**
 * Any Durable Object class, as a mixin here takes it.
 *
 * The rest parameter is `any[]` because TypeScript requires exactly that of a mixin's base
 * constructor (TS2545), and it is the one `any` in this package: the constructor is the platform's,
 * called by the platform with `(ctx, env)`, and nothing here calls it.
 */
// biome-ignore lint/suspicious/noExplicitAny: TS2545 requires a mixin base to take `...args: any[]`.
export type DurableObjectClass = abstract new (...args: any[]) => DurableObject<unknown>;

/**
 * What a mixin answers: the class it was given, with the methods it adds.
 *
 * Spelled out as the return type of every mixin, rather than inferred from the class inside it,
 * because the inferred type carries `ctx` and `env` — protected on `DurableObject` — and TypeScript
 * cannot write a protected member of an anonymous class into a declaration file (TS4094). The
 * intersection keeps both: a subclass still reaches `this.ctx`, through the class it was given.
 */
// biome-ignore lint/suspicious/noExplicitAny: TS2545 requires a mixin constructor to take `...args: any[]`.
export type Mixed<B extends DurableObjectClass, M> = B & (abstract new (...args: any[]) => M);

/** The environment a Durable Object class was declared with, read back off the class. */
export type EnvOf<B extends DurableObjectClass> =
  InstanceType<B> extends DurableObject<infer E> ? E : never;

/**
 * Runs each statement, which is how every piece creates its tables, and answers the `sql` it ran
 * them on — so a method opens with `const sql = ensure(this.ctx.storage.sql, TABLES)`.
 *
 * Called at the start of every method rather than once in a constructor, because a Durable Object
 * that empties itself with `deleteAll()` — Soriana's does, once an asset has not been listed for
 * long enough — keeps running in the same instance, and a table created only at construction would
 * be missing on the next call. `CREATE TABLE IF NOT EXISTS` against local SQLite costs nothing a
 * caller could measure.
 */
export const ensure = (sql: SqlStorage, statements: string[]): SqlStorage => {
  for (const statement of statements) sql.exec(statement);
  return sql;
};

/** The one row a query answers, or `undefined`. */
export const first = <T extends Record<string, SqlStorageValue>>(
  cursor: SqlStorageCursor<T>,
): T | undefined => cursor.toArray()[0];

/** What one `sendBatch` carries: the platform's own cap per call. */
export const BATCH = 100;

/** Bodies as Queue messages, in JSON rather than structured clone so a dead-letter queue reads. */
export const asJson = <T>(bodies: T[]) =>
  bodies.map((body) => ({ body, contentType: "json" as const }));

/**
 * A stub's view of what a mixin adds: every method, over RPC, answering a promise.
 *
 * Derived rather than written out, so that a mixin's methods and the adapter that reaches them over
 * a stub are one list and cannot drift.
 */
export type Rpc<M> = {
  [K in keyof M]: M[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

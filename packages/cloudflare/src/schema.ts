/**
 * Migrations for the tables a piece keeps in a Durable Object, applied object by object.
 *
 * **Why `CREATE TABLE IF NOT EXISTS` was not enough.** It creates a table and never changes one: a
 * column or an index added in a later release would reach the objects created after it and none of
 * the thousands created before. A Worker with an object per vehicle has every one of those to bring
 * forward, each on its own, the first time it is reached after a deploy.
 *
 * **One journal, `wp_schema`, a row per piece.** Each piece names itself and lists every step its
 * schema has ever taken, in order; the journal records how many an object has applied, and
 * `migrate` applies the rest. Pieces are independent because the mixins are: an object that carries
 * only an outbox migrates only the outbox. A domain may keep its own tables in the same journal
 * under names of its own, so one object has one record of what shape it is in.
 *
 * **A step, once published, is never edited** — an object that already applied it will not apply it
 * again — and a change is a new step at the end. The first step of each piece in this package
 * creates its tables `IF NOT EXISTS`, so that an object created before the journal existed adopts
 * the tables it already has.
 *
 * This is not an ORM and does not want to be one. The tables are a few, the queries are plain, and a
 * query builder imposed by a library would be a version every Worker that installs it has to agree
 * with — a Worker that wants Drizzle or Kysely for its own tables uses them, beside these.
 */

/** One piece's schema: its name in the journal, and every step it has taken, oldest first. */
export type Schema = {
  /** Unique within an object. This package's pieces are `worker-protocol.<piece>`. */
  piece: string;
  /** Each step is the statements that take the schema one version forward. */
  steps: string[][];
};

const JOURNAL = `CREATE TABLE IF NOT EXISTS wp_schema (
  piece TEXT PRIMARY KEY,
  version INTEGER NOT NULL
)`;

/**
 * Brings this object's tables for `schema` up to its latest step, and answers the `sql` to use.
 *
 * Called at the start of every method rather than once in a constructor, because an object that
 * empties itself with `deleteAll()` keeps running in the same instance, and a table created only at
 * construction would be missing on the next call. An object already at the latest step costs one
 * read of the journal.
 *
 * The steps still owed are applied in one transaction with the journal's new version, so a step that
 * fails leaves the object exactly where it was. An object ahead of `schema` — written by a later
 * release than the one now running — is refused rather than read: running older code over a newer
 * shape is a rollback, and a rollback is not a migration.
 */
export function migrate(storage: DurableObjectStorage, schema: Schema): SqlStorage {
  const sql = storage.sql;
  sql.exec(JOURNAL);
  const held = sql
    .exec<{ version: number }>("SELECT version FROM wp_schema WHERE piece = ?", schema.piece)
    .toArray()[0];
  const at = held?.version ?? 0;
  const latest = schema.steps.length;
  if (at === latest) return sql;
  if (at > latest) {
    throw new Error(
      `${schema.piece} is at version ${at} in this object, and this code knows ${latest}: ` +
        "the object was written by a later release.",
    );
  }
  storage.transactionSync(() => {
    for (const step of schema.steps.slice(at)) {
      for (const statement of step) sql.exec(statement);
    }
    sql.exec(
      `INSERT INTO wp_schema (piece, version) VALUES (?, ?)
         ON CONFLICT (piece) DO UPDATE SET version = excluded.version`,
      schema.piece,
      latest,
    );
  });
  return sql;
}

import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { migrate, type Schema } from "../src/index.ts";
import { shard, whole } from "./outbound.ts";

/** The runner, over a Durable Object of the test's own: a domain's piece, as a Worker would add. */
const piece = (steps: string[][]): Schema => ({ piece: "fleet.vehicles", steps });

const FIRST = ["CREATE TABLE IF NOT EXISTS vehicle (plate TEXT PRIMARY KEY)"];
const SECOND = ["ALTER TABLE vehicle ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown'"];

const columnsOf = (sql: SqlStorage, table: string) =>
  sql
    .exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
    .toArray()
    .map((one) => one.name);

const versionOf = (sql: SqlStorage, name: string) =>
  sql.exec<{ version: number }>("SELECT version FROM wp_schema WHERE piece = ?", name).toArray()[0]
    ?.version;

describe("migrate", () => {
  it("applies a step once, and brings an object at an earlier version forward by what it lacks", async () => {
    const left = await runInDurableObject(whole(), (_, state) => {
      migrate(state.storage, piece([FIRST]));
      state.storage.sql.exec("INSERT INTO vehicle (plate) VALUES ('ABC-123')");
      // The same release reaching the object again: nothing to do.
      migrate(state.storage, piece([FIRST]));
      // A later release, with one more step: only that one runs, and the row is still there.
      const sql = migrate(state.storage, piece([FIRST, SECOND]));
      return {
        columns: columnsOf(sql, "vehicle"),
        rows: sql.exec("SELECT plate, kind FROM vehicle").toArray(),
        version: versionOf(sql, "fleet.vehicles"),
      };
    });
    expect(left).toEqual({
      columns: ["plate", "kind"],
      rows: [{ plate: "ABC-123", kind: "unknown" }],
      version: 2,
    });
  });

  it("leaves the object where it was when a step fails", async () => {
    const left = await runInDurableObject(whole(), (_, state) => {
      migrate(state.storage, piece([FIRST]));
      const broken = [
        "ALTER TABLE vehicle ADD COLUMN kind TEXT",
        "ALTER TABLE no_such_table ADD COLUMN x TEXT",
      ];
      expect(() => migrate(state.storage, piece([FIRST, broken]))).toThrow();
      // The first statement of the failed step was rolled back with the rest of it.
      return {
        columns: columnsOf(state.storage.sql, "vehicle"),
        version: versionOf(state.storage.sql, "fleet.vehicles"),
      };
    });
    expect(left).toEqual({ columns: ["plate"], version: 1 });
  });

  it("refuses an object a later release already migrated", async () => {
    await runInDurableObject(whole(), (_, state) => {
      migrate(state.storage, piece([FIRST, SECOND]));
      expect(() => migrate(state.storage, piece([FIRST]))).toThrow(/later release/);
    });
  });

  it("keeps each piece apart: a shard records only the outbox it carries", async () => {
    const stub = shard();
    await stub.change("v-1", 1_000);
    const pieces = await runInDurableObject(stub, (_, state) =>
      state.storage.sql
        .exec<{ piece: string; version: number }>("SELECT piece, version FROM wp_schema")
        .toArray(),
    );
    expect(pieces).toEqual([{ piece: "worker-protocol.outbox", version: 1 }]);
  });
});

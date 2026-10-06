import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { outbound, shard, TYPE, whole } from "./outbound.ts";

/**
 * The outbox, in both shapes: every piece in one object, and an outbox alone in a shard.
 *
 * What an object flushed is read off the fake Queue it flushes to, which this suite shares with the
 * objects because the pool runs both in one isolate.
 */

const alarmOf = (stub: ReturnType<typeof whole> | ReturnType<typeof shard>) =>
  runInDurableObject(stub, (_, state) => state.storage.getAlarm());

beforeEach(() => {
  outbound.state.sent.length = 0;
  outbound.state.failing = false;
});

describe("withOutbox", () => {
  it("sends the event its change raised, with the row's id and instant", async () => {
    const stub = whole();
    expect(await stub.change("a", 1_000)).toEqual({ sent: 1, pending: 0 });
    expect(outbound.state.sent).toEqual([
      { type: TYPE, subject: "a", data: { id: "a" }, id: "changed:a", time: 1_000 },
    ]);
    expect(await stub.outbox()).toEqual({ depth: 0, oldestAt: null });
  });

  it("owes an id still waiting once, however often the change is repeated", async () => {
    const stub = whole();
    outbound.state.failing = true;
    await stub.change("a", 1_000);
    await stub.change("a", 2_000);
    expect(await stub.outbox()).toEqual({ depth: 1, oldestAt: 1_000 });
  });

  it("keeps what the Queue refused, in order, and the alarm sends it", async () => {
    const stub = whole();
    outbound.state.failing = true;
    expect(await stub.change("a", 1_000)).toEqual({ sent: 0, pending: 1 });
    expect(await stub.change("b", 2_000)).toEqual({ sent: 0, pending: 2 });
    expect(await alarmOf(stub)).not.toBeNull();

    outbound.state.failing = false;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(outbound.state.sent.map((one) => one.id)).toEqual(["changed:a", "changed:b"]);
    expect((await stub.outbox()).depth).toBe(0);
    // Nothing more is owed and the domain asked for nothing, so the alarm is cleared.
    expect(await alarmOf(stub)).toBeNull();
  });

  it("wakes the domain at its own instant, and not at the outbox's", async () => {
    const stub = whole();
    await stub.wakeAt(Date.now() - 1);
    await runDurableObjectAlarm(stub);
    expect(await stub.woken()).toBe(1);

    // An alarm that fires before the domain's instant — a retry, say — does not wake it, and
    // leaves the alarm pointed at the instant still to come.
    const future = Date.now() + 3_600_000;
    await stub.wakeAt(future);
    await runInDurableObject(stub, (_, state) => state.storage.setAlarm(Date.now()));
    await runDurableObjectAlarm(stub);
    expect(await stub.woken()).toBe(1);
    expect(await alarmOf(stub)).toBe(future);
  });

  it("lets a shard empty itself when it wakes, and writes nothing to it afterwards", async () => {
    const stub = shard();
    await stub.change("v-1", 1_000);
    await stub.wakeAt(Date.now() - 1);
    await runDurableObjectAlarm(stub);

    const left = await runInDurableObject(stub, (_, state) =>
      state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE name LIKE 'wp_%'")
        .toArray(),
    );
    expect(left).toEqual([]);
    expect(await alarmOf(stub)).toBeNull();
  });
});

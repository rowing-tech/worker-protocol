import { beforeEach, describe, expect, it } from "vitest";
import { clock, outbound } from "./outbound.ts";
import { CHECK } from "./worker.ts";

/**
 * `withLifecycle`, against an object whose Tasks are rows with an instant they begin and one they
 * end. What it owed is read off the fake Queue its outbox flushes to.
 */

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 8, 9, 0);

const sent = () => outbound.state.sent.map((one) => [one.type.split(".").at(-1), one.id, one.time]);

beforeEach(() => {
  outbound.state.sent.length = 0;
  outbound.state.failing = false;
});

describe("withLifecycle", () => {
  it("only sets the mark the first time, because nothing was seen being born", async () => {
    const stub = clock();
    await stub.hold("t-1", T0 - MINUTE);
    expect(await stub.advance(T0)).toEqual({ from: T0, to: T0, owed: 0 });
    expect(sent()).toEqual([]);
  });

  it("owes a birth and an end between two runs, each once, with derived ids", async () => {
    const stub = clock();
    await stub.start(T0);
    await stub.hold("t-1", T0 + 30_000, T0 + 90_000);
    const advanced = await stub.advance(T0 + 5 * MINUTE);
    expect(advanced.owed).toBe(2);
    expect(sent()).toEqual([
      ["task-raised", `task-raised:t-1:${T0 + 30_000}`, T0 + 30_000],
      ["task-ended", `task-ended:t-1:${T0 + 30_000}`, T0 + 90_000],
    ]);
    expect(outbound.state.sent[0]).toMatchObject({
      subject: "t-1",
      extensions: { tasktype: CHECK },
    });

    // The same instants compared again owe nothing new.
    expect((await stub.advance(T0 + 5 * MINUTE)).owed).toBe(0);
  });

  it("owes what an Action ended in its own call, with the birth nobody announced", async () => {
    const stub = clock();
    await stub.start(T0);
    await stub.hold("t-1", T0 + 10_000);
    await stub.resolve("t-1", T0 + 20_000);
    expect(sent().map(([kind]) => kind)).toEqual(["task-raised", "task-ended"]);

    // The heartbeat finds nothing more: the Task is missing from both sides of every comparison.
    expect((await stub.advance(T0 + 5 * MINUTE)).owed).toBe(0);
  });

  it("is not changed by a Worker method named like something it does internally", async () => {
    // A Worker on 0.8.0 declared its own `owe` and silently replaced the mixin's. Its internals
    // are functions of the module now, which no subclass can replace.
    const stub = clock();
    expect(await stub.owe()).toBe("the domain's own");
    await stub.start(T0);
    await stub.hold("t-1", T0 + 30_000);
    expect((await stub.advance(T0 + MINUTE)).owed).toBe(1);
  });

  it("gives up what it fell too far behind on, and says which instants", async () => {
    const stub = clock();
    await stub.start(T0);
    const advanced = await stub.advance(T0 + 3 * 60 * MINUTE);
    expect(advanced.skipped).toEqual({ from: T0, to: T0 + 2 * 60 * MINUTE });
    expect(advanced.from).toBe(T0 + 2 * 60 * MINUTE);
  });
});

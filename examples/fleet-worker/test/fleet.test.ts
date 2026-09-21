import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { cycle } from "../src/worker.ts";

/**
 * The Durable Object, on workerd, one instance per test.
 *
 * Each test names its own object so nothing it writes reaches the next one — which is the only
 * isolation a durable object offers, because its whole purpose is that its storage survives.
 */
const MINUTE = 60_000;
const QUIET_AFTER_MS = 15 * MINUTE;

let n = 0;
const fresh = () => env.FLEET.get(env.FLEET.idFromName(`test-${++n}`));

describe("the condition a Task is derived from", () => {
  it("holds for a vehicle whose last reading is older than the window", async () => {
    const fleet = fresh();
    const now = Date.now();
    await fleet.ingest(
      [
        { vehicle: "ABC-123", at: now - 20 * MINUTE },
        { vehicle: "DEF-456", at: now - MINUTE },
      ],
      now,
      QUIET_AFTER_MS,
    );

    const quiet = await fleet.quiet(now, QUIET_AFTER_MS);
    expect(quiet.map((one) => one.vehicle)).toEqual(["ABC-123"]);
    // TASK-28: when the condition began, which is when the vehicle crossed the window and not when
    // the read happened. A Worker answering `now` here tells an operator nothing about how long.
    expect(quiet[0]?.since).toBe(now - 20 * MINUTE + QUIET_AFTER_MS);
  });

  it("stops holding once a check is on record, and holds again when the vehicle stays silent", async () => {
    const fleet = fresh();
    const now = Date.now();
    await fleet.ingest([{ vehicle: "ABC-123", at: now - 20 * MINUTE }], now, QUIET_AFTER_MS);

    await fleet.check("ABC-123", now);
    expect(await fleet.quiet(now, QUIET_AFTER_MS)).toEqual([]);

    // A reading is the sign of life that ends the check, so silence after one is quiet again.
    await fleet.ingest([{ vehicle: "ABC-123", at: now - 40 * MINUTE }], now, QUIET_AFTER_MS);
    expect((await fleet.quiet(now, QUIET_AFTER_MS)).map((one) => one.vehicle)).toEqual(["ABC-123"]);
  });
});

describe("the outbox", () => {
  it("raises one event on the crossing and not on every cycle after it", async () => {
    const fleet = fresh();
    const now = Date.now();

    await fleet.ingest([{ vehicle: "ABC-123", at: now - 20 * MINUTE }], now, QUIET_AFTER_MS);
    expect(await fleet.depth()).toBe(1);

    // The same vehicle, still quiet, on the next cycle. `vehicle-went-quiet` is a Fact about a
    // moment: publishing it again would be publishing a state under a name that says CHANGED.
    await fleet.ingest([], now + MINUTE, QUIET_AFTER_MS);
    expect(await fleet.depth()).toBe(1);

    const [event] = await fleet.pending();
    expect(event?.type).toBe("tech.rowing.fleet.vehicle-went-quiet");
    expect(event?.data).toMatchObject({ vehicle: "ABC-123" });
  });

  it("keeps what the broker did not take, and stops at the refusal rather than past it", async () => {
    // `cycle` reaches the one instance the Worker is authoritative over, so this test uses it too.
    const fleet = env.FLEET.get(env.FLEET.idFromName("fleet"));
    const now = Date.now();
    await fleet.ingest(
      [
        { vehicle: "AAA", at: now - 20 * MINUTE },
        { vehicle: "BBB", at: now - 20 * MINUTE },
      ],
      now,
      QUIET_AFTER_MS,
    );
    const raised = (await fleet.pending()).map((one) => one.id);
    expect(raised).toHaveLength(2);

    // A broker that is down. A Fact that was true does not stop being true because nobody took it.
    expect((await cycle(env, async () => false)).published).toBe(0);
    expect(await fleet.depth()).toBe(2);

    // A broker that takes one and then refuses. Draining stops there rather than skipping past it:
    // a consumer reading these in order would otherwise see the second before the first arrived.
    let seen = 0;
    expect((await cycle(env, async () => ++seen <= 1)).published).toBe(1);
    expect((await fleet.pending()).map((one) => one.id)).toEqual(raised.slice(1));

    expect((await cycle(env, async () => true)).published).toBe(1);
    expect(await fleet.depth()).toBe(0);
  });
});

describe("what a metric is read from", () => {
  it("sums the hourly counters into whatever bucket was asked for", async () => {
    const fleet = fresh();
    const hour = 3_600_000;
    const base = Math.floor(Date.now() / hour) * hour;

    await fleet.ingest([{ vehicle: "ABC", at: base + 60_000 }], base + 60_000, QUIET_AFTER_MS);
    await fleet.ingest(
      [{ vehicle: "DEF", at: base + 2 * 60_000 }],
      base + 2 * 60_000,
      QUIET_AFTER_MS,
    );
    await fleet.ingest([{ vehicle: "GHI", at: base + hour }], base + hour, QUIET_AFTER_MS);

    // MET-3's `additive`: the day is the sum of its hours, which is what declaring it permits a
    // reader to do and the reason a reader never assumes it of a metric that does not.
    const [firstHour, secondHour, both] = await fleet.counters("readings-ingested", [
      { start: base, end: base + hour },
      { start: base + hour, end: base + 2 * hour },
      { start: base, end: base + 2 * hour },
    ]);
    expect(firstHour).toBe(2);
    expect(secondHour).toBe(1);
    expect(both).toBe(3);
  });
});

describe("ENDP-16's store, over the object", () => {
  it("reserves a key once, so a second caller under it does not perform", async () => {
    const fleet = fresh();
    const until = Date.now() + 3_600_000;

    expect(await fleet.beginOutcome("k", until)).toBe("reserved");
    // The reservation is what the second caller meets. It is not an answer yet, which is why
    // ENDP-32 makes this a `503` and a retry rather than a conflict nobody should retry.
    expect(await fleet.beginOutcome("k", until)).toBe("in-flight");

    await fleet.completeOutcome("k", {
      body: '{"vehicle":"ABC-123"}',
      answer: { status: 200, body: { recordedAt: "now" } },
      until,
    });
    expect(await fleet.beginOutcome("k", until)).toMatchObject({
      held: { answer: { status: 200 } },
    });
  });

  it("frees the key when the performance failed, and when the window has passed", async () => {
    const fleet = fresh();

    await fleet.beginOutcome("k", Date.now() + 3_600_000);
    await fleet.releaseOutcome("k");
    // A reservation nobody completed is not a promise to replay: the retry is the caller's to make.
    expect(await fleet.beginOutcome("k", Date.now() + 3_600_000)).toBe("reserved");

    // ENDP-18: the window ends and the key is a key again, so an expired row is not an answer.
    await fleet.completeOutcome("j", {
      body: "{}",
      answer: { status: 200, body: {} },
      until: Date.now() - 1,
    });
    expect(await fleet.beginOutcome("j", Date.now() + 3_600_000)).toBe("reserved");
  });
});

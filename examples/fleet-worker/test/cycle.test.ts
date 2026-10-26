import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/config.ts";
import { cycle } from "../src/cycle.ts";
import type { Env } from "../src/env.ts";
import { UpstreamError } from "../src/source.ts";
import { source } from "./source.ts";

/**
 * The half of this Worker that reads the world: the cycle the cron runs, outside the object.
 *
 * Each test names its own object, and hands the cycle its own environment and its own source — the
 * cycle takes both as parameters, which is what makes a misconfigured deployment and a source that
 * answers badly things a test can be.
 */

const MINUTE = 60_000;
const fresh = () => env.FLEET.get(env.FLEET.newUniqueId());
const configured: Env = {
  ...env,
  SOURCE_URL: "https://source.example.com/positions",
  SOURCE_TOKEN: "s-token",
  QUIET_AFTER_MINUTES: "15",
};
const silentFor = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

/** What the object recorded, oldest first. */
const records = async (fleet: ReturnType<typeof fresh>) =>
  (
    await fleet.logs({ minRank: 0, before: null, from: null, to: null, trace: null, limit: 50 })
  ).rows.reverse();

describe("a cycle", () => {
  it("reads the source outside the object and enters it once, with what it read", async () => {
    const fleet = fresh();
    const read = source([
      { unit: "ABC-123", lastReportAt: silentFor(20) },
      { unit: "DEF-456", lastReportAt: silentFor(1) },
    ]);
    const done = await cycle({ fleet, env: configured, fetch: read });

    expect(read.asked).toEqual([
      { url: "https://source.example.com/positions", authorization: "Bearer s-token" },
    ]);
    expect(done).toMatchObject({ dryRun: false, seen: 2, dropped: 0, readings: 2 });
    expect((await fleet.quiet(Date.now(), 15 * MINUTE)).map((one) => one.vehicle)).toEqual([
      "ABC-123",
    ]);
  });

  it("puts its own id on every record it writes, so one run reads back whole", async () => {
    const fleet = fresh();
    const done = await cycle({
      fleet,
      env: configured,
      fetch: source([{ unit: "ABC-123", lastReportAt: silentFor(1) }]),
    });
    const written = await records(fleet);
    expect(written.at(-1)).toMatchObject({
      message: "cycle complete",
      fields: { cycle: done.cycle, readings: 1 },
    });
  });

  it("drops an entry it cannot read and counts it, rather than failing the fleet", async () => {
    const done = await cycle({
      fleet: fresh(),
      env: configured,
      fetch: source([
        { unit: "ABC-123", lastReportAt: silentFor(1) },
        { unit: "", lastReportAt: silentFor(1) },
        { unit: "DEF-456", lastReportAt: "yesterday" },
      ]),
    });
    expect(done).toMatchObject({ seen: 3, dropped: 2, readings: 1 });
  });
});

describe("a dry run", () => {
  it("says what the cycle would raise and end, and writes nothing at all", async () => {
    const fleet = fresh();
    // On record: DEF-456 quiet since long ago. The source now says it reported, and ABC-123 has not.
    await fleet.ingest([{ vehicle: "DEF-456", at: Date.now() - 60 * MINUTE }], Date.now(), 0);
    const before = await records(fleet);

    const would = await cycle({
      fleet,
      env: configured,
      dryRun: true,
      fetch: source([
        { unit: "ABC-123", lastReportAt: silentFor(20) },
        { unit: "DEF-456", lastReportAt: silentFor(1) },
      ]),
    });

    expect(would).toMatchObject({
      dryRun: true,
      wouldRaise: ["quiet:ABC-123"],
      wouldEnd: ["quiet:DEF-456"],
    });
    // Nothing written: DEF-456 is still quiet on record, ABC-123 was never stored, no record.
    expect((await fleet.quiet(Date.now(), 15 * MINUTE)).map((one) => one.vehicle)).toEqual([
      "DEF-456",
    ]);
    expect(await records(fleet)).toEqual(before);
  });
});

describe("a configuration the cycle cannot use", () => {
  it("is refused before the source is asked, and the refusal is on record with its reason", async () => {
    const fleet = fresh();
    const read = source([]);
    await expect(
      cycle({
        fleet,
        env: { ...configured, SOURCE_URL: "http://source.example.com" },
        fetch: read,
      }),
    ).rejects.toThrow(ConfigError);

    expect(read.asked).toEqual([]);
    expect((await records(fleet)).at(-1)).toMatchObject({
      level: "error",
      fields: { reason: "SOURCE_URL must be https, not http:" },
    });
  });

  it("refuses a window that is not a number of minutes", async () => {
    await expect(
      cycle({
        fleet: fresh(),
        env: { ...configured, QUIET_AFTER_MINUTES: "soon" },
        fetch: source([]),
      }),
    ).rejects.toThrow(ConfigError);
  });

  it("is what `health` says, through the protocol, where a Tower looks", async () => {
    const fleet = fresh();
    // The object's own environment, set before it first answers, because it builds its Worker once.
    await runInDurableObject(fleet, (instance) => {
      Object.defineProperty(instance, "env", {
        value: { ...configured, SOURCE_URL: undefined },
        configurable: true,
      });
    });
    const response = await fleet.fetch("https://fleet.invalid/health", {
      // `vitest.config.ts` binds this one; the global `Env` that `wrangler types` writes has no secret.
      headers: { authorization: "Bearer a-token" },
    });
    expect(await response.json()).toMatchObject({
      status: "unhealthy",
      checks: { configuration: { status: "unhealthy" } },
    });
  });
});

describe("a source that answers badly", () => {
  it("fails the cycle, on record, and writes nothing else", async () => {
    const fleet = fresh();
    await expect(
      cycle({ fleet, env: configured, fetch: source([], { status: 502 }) }),
    ).rejects.toThrow(UpstreamError);
    expect((await records(fleet)).at(-1)).toMatchObject({
      level: "error",
      message: "a cycle could not read the source",
    });
  });
});

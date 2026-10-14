import { ConfigError, configFromEnv } from "./config.ts";
import type { Env } from "./env.ts";
import type { Fleet } from "./fleet.ts";
import { type Fetch, poll, UpstreamError } from "./source.ts";

/**
 * One cycle: validate, read the source, and enter the object once with what it said.
 *
 * What the cron runs every minute, and what an operator runs by hand at `POST /cycle`. It is the
 * half of this Worker that reads the world rather than answering requests, and it lives in the
 * entrypoint for the reason `source.ts` gives: the network is awaited here, before the object is
 * entered, never inside it.
 *
 * **Every record a cycle writes carries its id**, so one run can be read back out of `/logs` whole:
 * the refusal, the poll, the outcome. A dry run writes nothing at all, records included.
 */

/** What a cycle did. */
export type Cycled = {
  dryRun: false;
  cycle: string;
  seen: number;
  dropped: number;
  readings: number;
  /** How many events the readings raised and sent. */
  published: number;
};

/** What a cycle would have done, having read and mapped the source and written nothing. */
export type DryRun = {
  dryRun: true;
  cycle: string;
  seen: number;
  dropped: number;
  readings: { vehicle: string; at: string }[];
  /** The Tasks these readings would raise and end, by id, as `tasks` would list them. */
  wouldRaise: string[];
  wouldEnd: string[];
};

export async function cycle(given: {
  fleet: DurableObjectStub<Fleet>;
  env: Env;
  fetch?: Fetch;
  dryRun?: boolean;
}): Promise<Cycled | DryRun> {
  const { fleet, env } = given;
  const id = crypto.randomUUID();
  const dryRun = given.dryRun === true;
  const record = async (level: "info" | "error", message: string, fields = {}) => {
    if (!dryRun)
      await fleet.record([{ at: Date.now(), level, message, fields: { cycle: id, ...fields } }]);
  };

  let config: ReturnType<typeof configFromEnv>;
  try {
    config = configFromEnv(env);
  } catch (thrown) {
    if (thrown instanceof ConfigError) {
      await record("error", "a cycle was refused: the configuration is not usable", {
        reason: thrown.message,
      });
    }
    throw thrown;
  }

  const now = Date.now();
  let read: Awaited<ReturnType<typeof poll>>;
  try {
    read = await poll({ config, fetch: given.fetch ?? ((url, init) => fetch(url, init)) });
  } catch (thrown) {
    if (thrown instanceof UpstreamError) {
      await record("error", "a cycle could not read the source", { reason: thrown.message });
    }
    throw thrown;
  }

  if (dryRun) {
    const would = await fleet.preview(read.readings, now, config.quietAfterMs);
    return {
      dryRun: true,
      cycle: id,
      seen: read.seen,
      dropped: read.dropped,
      readings: read.readings.map((one) => ({
        vehicle: one.vehicle,
        at: new Date(one.at).toISOString(),
      })),
      wouldRaise: would.raise,
      wouldEnd: would.end,
    };
  }

  const published = await fleet.ingest(read.readings, now, config.quietAfterMs);
  // LOG-2: the record, written on purpose and in one call. This is the whole of what a Worker does
  // for this Capability — it decides what is worth a line and where that line is kept.
  await record("info", "cycle complete", {
    seen: read.seen,
    dropped: read.dropped,
    readings: read.readings.length,
    published,
  });
  return {
    dryRun: false,
    cycle: id,
    seen: read.seen,
    dropped: read.dropped,
    readings: read.readings.length,
    published,
  };
}

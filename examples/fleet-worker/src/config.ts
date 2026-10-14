import type { Env } from "./env.ts";

/**
 * What one cycle needs from the environment, checked before any work happens.
 *
 * **A cron has nobody to answer a `400` to**, so a missing or malformed binding is refused at the
 * start of the cycle, loudly, rather than surfacing as a `TypeError` three awaits deep after half
 * of the work was done. The same check feeds `health`, because the cron's failure shows in the
 * platform's dashboard and nowhere the protocol reaches, and a Tower reading this Worker should see
 * that it is configured to do nothing.
 */

/** A binding is missing or malformed. Raised before any work, so a bad deploy fails on its first tick. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

/** A cycle's configuration, once it is known to be usable. */
export type CycleConfig = {
  /** Where the positions are read from. */
  sourceUrl: URL;
  /** Presented to the source as a bearer token, where it wants one. */
  sourceToken: string | undefined;
  /** How long a vehicle may say nothing before it is quiet. */
  quietAfterMs: number;
};

const DEFAULT_QUIET_AFTER_MINUTES = 15;

/**
 * The bindings a cycle needs, or why not.
 *
 * `SOURCE_URL` must parse and be `https` — or `http` on `localhost`, for a source served beside
 * `wrangler dev`. A plaintext upstream would put the fleet's positions on the wire, and a typo that
 * turns a URL into a path is the kind of thing that otherwise surfaces as a confusing `fetch` error
 * on the first cron of the morning. `QUIET_AFTER_MINUTES` is optional, and a number where it is set.
 */
export function configFromEnv(
  env: Pick<Env, "SOURCE_URL" | "SOURCE_TOKEN" | "QUIET_AFTER_MINUTES">,
): CycleConfig {
  if (env.SOURCE_URL === undefined || env.SOURCE_URL === "") {
    throw new ConfigError("SOURCE_URL is not set: the cycle has nowhere to read positions from");
  }
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(env.SOURCE_URL);
  } catch {
    throw new ConfigError(`SOURCE_URL is not a URL: ${env.SOURCE_URL}`);
  }
  const local = sourceUrl.protocol === "http:" && sourceUrl.hostname === "localhost";
  if (sourceUrl.protocol !== "https:" && !local) {
    throw new ConfigError(`SOURCE_URL must be https, not ${sourceUrl.protocol}`);
  }
  const minutes =
    env.QUIET_AFTER_MINUTES === undefined
      ? DEFAULT_QUIET_AFTER_MINUTES
      : Number(env.QUIET_AFTER_MINUTES);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new ConfigError(
      `QUIET_AFTER_MINUTES is not a number of minutes: ${env.QUIET_AFTER_MINUTES}`,
    );
  }
  return {
    sourceUrl,
    sourceToken: env.SOURCE_TOKEN === "" ? undefined : env.SOURCE_TOKEN,
    quietAfterMs: minutes * 60_000,
  };
}

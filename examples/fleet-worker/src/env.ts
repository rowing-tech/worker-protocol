/**
 * What `wrangler.jsonc` binds, which is the one thing about this Worker the protocol never sees.
 *
 * It is its own module because both halves need it and neither owns it: the Durable Object is typed
 * by it, and so is every function that reaches the object through it. Written by hand rather than
 * taken from the global `Env` that `wrangler types` generates, because `CREDENTIAL` is a secret and
 * a secret is not in the committed config for the generator to find.
 */
export type Env = {
  /** The Durable Object every Fact below lives in. One namespace, one instance. */
  FLEET: DurableObjectNamespace<import("./fleet.ts").Fleet>;
  /** REG-3's token, as a secret. Absent in a deployment that has not set one. */
  CREDENTIAL?: string;
  /** The stub standing in for a GPS provider: the plate numbers this cycle heard from. */
  SOURCE_VEHICLES?: string;
};

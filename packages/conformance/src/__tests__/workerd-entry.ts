import { app } from "../../../../examples/minimal-worker/src/worker.ts";
import { verify } from "../index.ts";

/**
 * A Worker whose one job is to run the verifier, bundled by wrangler and booted on workerd by
 * `workerd.test.ts`.
 *
 * This is a Control Tower's position rather than an operator's: the tool runs INSIDE a Worker
 * runtime, with no filesystem and no Node built-ins, and reaches the Worker it verifies through a
 * `fetch` it was handed. Here that `fetch` is the minimal Worker's `app.fetch`, in the same isolate,
 * so nothing crosses a socket and the base URL can be `https` — which DESC-3 fixes and a loopback
 * dev server cannot give.
 */

const CREDENTIAL = "w-token";

/** The same arrangement `minimal-worker.test.ts` makes, for the same Worker. */
const ARRANGEMENT = {
  safeAction: {
    name: "answer-check",
    input: { outcome: "found", vehicle: "ABC-123", reachable: true },
  },
};

export default {
  async fetch(): Promise<Response> {
    // On a platform the environment arrives with the request; this Worker hands the one it made up
    // to the Worker it wraps, as the platform would.
    const env = { CREDENTIAL };
    const report = await verify({
      baseUrl: "https://minimal.invalid",
      credential: CREDENTIAL,
      mayPerform: true,
      arrangement: ARRANGEMENT,
      fetch: async (input, init) => app.fetch(new Request(input, init), env),
    });
    return Response.json(report);
  },
};

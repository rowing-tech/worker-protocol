import { consumeQueues, forward } from "@worker-protocol/cloudflare";
import type { Env } from "./env.ts";
import { fleetOf } from "./fleet.ts";
import { hubOver } from "./protocol.ts";

/**
 * The Worker's entrypoint, in front of the object that answers it.
 *
 * Every request goes to the object, which serves `mount()` from its own `fetch` (`fleet.ts`): one
 * round trip, after which everything a rule needs is a local call. What stays here is what the
 * platform hands an entrypoint and nothing else — the cron and the Queues.
 *
 * **Forwarding everything is a choice this Worker can make because it watches one fleet** and so
 * has one object. A read that touches no Fact — the Descriptor, `health` — now pays the round trip
 * too, and a Worker that cares can keep those here and forward only the surfaces that reach its
 * Facts. A Worker with an object per tenant forwards each request to that tenant's.
 */

/**
 * Cloudflare resolves a durable object binding against the classes its ENTRYPOINT module exports,
 * so this one has to be named here even though nothing in this file calls it. It is the platform's
 * requirement and not a convenience: `wrangler.jsonc` binds `FLEET` to the class name `Fleet`, and
 * a class the entrypoint does not export is a name the runtime cannot find.
 */
export { Fleet } from "./fleet.ts";

export default {
  // `forward` reads the body before handing it on, and answers a lost connection to the object in
  // the protocol's envelope rather than as the runtime's plain-text `500`.
  fetch: (request: Request, env: Env, _ctx: ExecutionContext) =>
    forward({ to: fleetOf(env), request }),
  /** The cron in `wrangler.jsonc`. A Worker finds work on a schedule, which is what makes it one. */
  scheduled: async (_controller: unknown, env: Env) => {
    await fleetOf(env).cycle();
  },
  /**
   * Both Queues in `wrangler.jsonc`. On `fleet-events`, each batch is published to the subscribers
   * it matches and then to the broker; on `fleet-deliveries`, each delivery is attempted and the
   * hub's decision handed back to the Queue. What is given up goes to `fleet-dead`, and a `warn`
   * record of it to `/logs`.
   */
  queue: consumeQueues<Env>({
    queues: { events: "fleet-events", deliveries: "fleet-deliveries" },
    hub: (env) => hubOver(fleetOf(env), env),
    deadLetter: (env) => env.DEAD,
    // EVT-13: a stub. The broker `events.destination` names is not reached from an example, so
    // every event is taken; a real one answers `false` when it did not take it.
    broker: async () => true,
    record: ({ rows, env }) => fleetOf(env).record(rows),
  }),
};

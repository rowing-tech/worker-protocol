import type { Env } from "./env.ts";
import { fleetOf, type LogRow } from "./fleet.ts";

/**
 * The second Worker: what `fleet-worker` cannot record about itself.
 *
 * **A Worker that died cannot write its own last line.** `cycle()` records on purpose, in one call
 * at the end, which is the shape `spec/logs.md` asks for — and it never runs if the invocation threw
 * without catching, ran out of CPU, or was cancelled. Those facts exist only outside the
 * invocation, and a Tail Worker is where Cloudflare puts them.
 *
 * `wrangler.jsonc` names this one under `tail_consumers`; `wrangler.tail.jsonc` deploys it and binds
 * `FLEET` to the producer's class with `script_name`, so both Workers write to the same Durable
 * Object and `/logs` serves one feed. A tail consumer runs after the producer has answered, so
 * nothing here is on anybody's critical path.
 *
 * **What it deliberately throws away is `event.logs`.** That array is every `console` call the
 * producer made, and forwarding it would be the capture `spec/logs.md` argues against by name: one
 * feed per process, blind to whose work produced each line. This module is not a pipe. It decides
 * that two things are worth a record — an exception nobody caught, and an invocation that ended
 * badly — and writes those, which is the same decision `cycle()` makes about its own work.
 *
 * **That filter is also what stops this feeding itself**, which is worth knowing before anybody
 * loosens it. Durable Object invocations are traced like any other: Cloudflare's trace event types
 * include `alarm` and `hibernatable_web_socket`, which exist only on a Durable Object, and an RPC
 * call to one of its methods arrives as `worker_rpc`. So the `record()` below produces a trace of
 * its own, carrying the producer's `scriptName`, which comes back here. It writes nothing, because
 * that trace is `ok` with no exceptions, and the cycle stops on the first turn. A version of this
 * that forwarded `event.logs` would not stop: every write would log, and every log would be a
 * write. A failing write does not spin either, for a blunter reason — the store that would have to
 * record the failure is the thing that is broken.
 *
 * What is NOT established, and is the first thing to check against a real deployment: whether a
 * tail invocation that throws is retried or dropped. Cloudflare does not document it.
 */

/** ENDP-19-ish prudence: a burst of failures is a burst, and the window is 500 records deep. */
const MOST_PER_BATCH = 100;

export default {
  async tail(events: TraceItem[], env: Env): Promise<void> {
    const lines: LogRow[] = [];

    for (const event of events) {
      const at = event.eventTimestamp ?? Date.now();

      // What the producer never saw, because it is what stopped it seeing anything else.
      for (const thrown of event.exceptions) {
        lines.push({
          at: thrown.timestamp ?? at,
          level: "error",
          message: `uncaught ${thrown.name}: ${String(thrown.message)}`,
          fields: { script: event.scriptName ?? "unknown", outcome: event.outcome },
        });
      }

      // `ok` is the ordinary case and says nothing an operator needs; `canceled` is a client that
      // hung up, which is not the Worker's fault and is still worth knowing when it is happening a
      // hundred times an hour. `exceededCpu` is the one nothing inside the Worker can report, ever.
      if (event.outcome !== "ok" && event.exceptions.length === 0) {
        lines.push({
          at,
          level: event.outcome === "canceled" ? "warn" : "error",
          message: `the invocation ended \`${event.outcome}\``,
          fields: { script: event.scriptName ?? "unknown", outcome: event.outcome },
        });
      }
    }

    if (lines.length === 0) return;
    // One RPC for the batch, which is what a tail event already is: Cloudflare hands over several
    // invocations at once, and a write per invocation would multiply the store's cost by the
    // producer's traffic rather than by its failures.
    await fleetOf(env).record(lines.slice(0, MOST_PER_BATCH));
  },
};

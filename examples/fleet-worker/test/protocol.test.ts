import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fleetOf, QUIET_AFTER_MS } from "../src/fleet.ts";

/**
 * The protocol's surfaces, over the deployed Worker.
 *
 * `SELF.fetch` goes through the real entrypoint in its own isolate, which is the point of this file
 * existing beside `fleet.test.ts`: the Facts these reads answer from were written by a test in a
 * DIFFERENT isolate, and they arrive anyway. That is the whole claim the durable object is here to
 * make, and no test that shares a process with its Worker can make it.
 */

const MINUTE = 60_000;
const TOKEN = "a-token";

const at = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://fleet.invalid${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...init.headers },
  });

const fleet = () => fleetOf(env);

describe("what a Tower reads first", () => {
  it("serves the Descriptor at the address DESC-3 fixes, declaring this Worker's Capabilities", async () => {
    const response = await at("/.well-known/worker-protocol");
    expect(response.status).toBe(200);
    // ENDP-5: every answer carries the edition, so a reader that got one it did not expect knows
    // to re-read rather than to guess.
    expect(response.headers.get("worker-protocol-edition")).toBeTruthy();

    const descriptor = (await response.json()) as {
      id: string;
      capabilities: Record<string, { address: string }>;
    };
    expect(descriptor.id).toBe("tech.rowing.fleet.tracker");
    expect(Object.keys(descriptor.capabilities).sort()).toEqual([
      "actions",
      "alerts",
      "events",
      "health",
      "metrics",
      "tasks",
    ]);
  });

  it("refuses a credential the Worker does not recognise, and says nothing about why", async () => {
    const response = await SELF.fetch("https://fleet.invalid/health", {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(response.status).toBe(401);
    // REG-32: the refusal distinguishes nothing. A refusal that explains itself is an oracle.
    expect(await response.text()).not.toContain("a-token");
  });
});

describe("the Facts, read across isolates", () => {
  it("answers the Task whose condition a different isolate wrote", async () => {
    // On a whole second, because TASK-28's instant is serialized to one and a Task read back is
    // being compared to what was written rather than to the clock that wrote it.
    const now = Math.floor(Date.now() / 1000) * 1000;
    await fleet().ingest([{ vehicle: "ZZZ-999", at: now - 20 * MINUTE }], now, QUIET_AFTER_MS);

    const page = (await (await at("/tasks")).json()) as {
      items: { id: string; type: string; payload: unknown; since: string }[];
    };
    const one = page.items.find((task) => task.id === "quiet:ZZZ-999");
    expect(one?.type).toBe("tech.rowing.fleet.inspect-quiet-vehicle");
    expect(one?.payload).toEqual({ vehicle: "ZZZ-999" });
    // TASK-28: an RFC 3339 instant carrying an offset, and the instant the condition BEGAN.
    expect(Date.parse(one?.since ?? "")).toBe(now - 20 * MINUTE + QUIET_AFTER_MS);
  });

  it("refuses a filter it does not define rather than ignoring it", async () => {
    // ENDP-24. A filter dropped in silence answers with MORE than the caller asked for, in a shape
    // the caller will happily parse.
    const response = await at("/tasks?assignee=me");
    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "unknown_filter" });
  });

  it("reports itself degraded while the outbox is backing up, and names the check that said so", async () => {
    const healthy = (await (await at("/health")).json()) as { status: string };
    expect(healthy.status).toBe("healthy");

    const now = Date.now();
    await fleet().ingest(
      Array.from({ length: 25 }, (_, i) => ({ vehicle: `Q-${i}`, at: now - 20 * MINUTE })),
      now,
      QUIET_AFTER_MS,
    );

    // HLTH-5: `200` whatever it reports — the status is in the body and never in the code.
    const response = await at("/health");
    expect(response.status).toBe(200);
    // HLTH-3: `healthy` is not available while a named check is not, so the whole Worker moves.
    const body = (await response.json()) as { status: string; checks: Record<string, unknown> };
    expect(body.status).toBe("degraded");
    expect(body.checks.outbox).toMatchObject({ status: "degraded" });

    // ALRT-2: the same condition an operator should see, while it holds.
    const alerts = (await (await at("/alerts")).json()) as { items: { id: string }[] };
    expect(alerts.items.map((one) => one.id)).toContain("outbox-backed-up");
  });
});

describe("ENDP-16, over a store that outlives the request", () => {
  const key = "one-key";
  const inspection = (body: unknown, headers: Record<string, string> = {}) =>
    at("/actions?action=record-inspection", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, ...headers },
      body: JSON.stringify(body),
    });

  it("replays the recorded outcome for a retry under the same key", async () => {
    const first = await inspection({ vehicle: "RRR-111", reachable: true });
    expect(first.status).toBe(200);
    const recorded = await first.text();

    // This is the case a `Map` in a process gets wrong the moment there are two isolates, and it is
    // the reason this example exists: the retry replays what the first performance recorded.
    const again = await inspection({ vehicle: "RRR-111", reachable: true });
    expect(again.status).toBe(200);
    expect(await again.text()).toBe(recorded);
  });

  it("refuses the same key over a different body", async () => {
    // ENDP-17: a key is a promise about ONE request. Answering the first request's outcome to a
    // different one would be replaying something the caller never sent.
    const response = await inspection({ vehicle: "SOMETHING-ELSE", reachable: false });
    expect(response.status).toBe(409);
  });
});

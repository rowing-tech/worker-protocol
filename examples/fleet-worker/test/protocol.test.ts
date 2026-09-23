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
      "logs",
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

/**
 * The `logs` surface, over the deployed Worker.
 *
 * This is the file that has to exist on Cloudflare rather than on Node, because the question the
 * Capability raises is a platform question: a feed kept in the isolate is one feed per isolate, so
 * the records have to live where every isolate can reach them. `SELF.fetch` runs the real
 * entrypoint, and the records it answers were written by a cycle in a different one.
 */
describe("what the Worker recorded while it was working", () => {
  const page = async (query = "") => {
    const response = await at(`/logs${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      items: { at: string; level: string; message: string; fields?: Record<string, unknown> }[];
      nextCursor?: string;
    };
  };

  it("answers what a cycle recorded, most recent first, with its structured fields", async () => {
    // A cycle records on purpose, in the Worker's own code path.
    await at("/actions?action=run-cycle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const answered = await page();
    expect(answered.items.length).toBeGreaterThan(0);
    // LOG-4: every record carries an instant, a level and a message.
    for (const record of answered.items) {
      expect(record.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(["debug", "info", "warn", "error"]).toContain(record.level);
      expect(record.message.length).toBeGreaterThan(0);
    }
    // LOG-9: a single trailing object of scalars became `fields` rather than part of the message.
    const structured = answered.items.find((record) => record.fields !== undefined);
    expect(structured?.fields).toBeTypeOf("object");
  });

  it("holds the order while the feed is being written to, which is ENDP-33", async () => {
    // Enough records to page, written the way every other record here was.
    await fleet().record(
      Array.from({ length: 60 }, (_, i) => ({
        at: Date.now() + i,
        level: "info" as const,
        message: `cycle note ${i}`,
        fields: { i },
      })),
    );

    const first = await page();
    expect(first.nextCursor).toBeTruthy();

    // More arrive between the two reads — which is the case the rule is about, and the one an
    // offset gets wrong by pushing the collection along under the caller.
    await fleet().record([{ at: Date.now(), level: "warn", message: "arrived mid-paging" }]);

    const second = await page(`?cursor=${first.nextCursor}`);
    const seen = new Set(first.items.map((item) => JSON.stringify(item)));
    expect(second.items.some((item) => seen.has(JSON.stringify(item)))).toBe(false);
    expect(second.items.some((item) => item.message === "arrived mid-paging")).toBe(false);
  });

  it("filters by a level floor and refuses a name outside the four", async () => {
    await fleet().record([
      { at: Date.now(), level: "error", message: "upload failed", fields: { attempt: 3 } },
    ]);

    // LOG-7: a floor, so `warn` answers `warn` and `error` and nothing below either.
    const filtered = await page("?level=warn");
    expect(filtered.items.every((record) => ["warn", "error"].includes(record.level))).toBe(true);
    expect(filtered.items.some((record) => record.level === "error")).toBe(true);

    // ENDP-24, LOG-7: a level outside the vocabulary is refused rather than ignored.
    const invented = await at("/logs?level=chatter");
    expect(invented.status).toBe(400);
    expect(((await invented.json()) as { code: string }).code).toBe("invalid_parameter");

    // ENDP-24: and so is a parameter this address never defined.
    const unknown = await at("/logs?vehicle=ABC-123");
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { code: string }).code).toBe("unknown_filter");
  });
});

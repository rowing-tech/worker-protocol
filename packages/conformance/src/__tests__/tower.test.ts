import type { AddressInfo } from "node:net";
import { consume, Refused } from "@worker-protocol/client";
import { createWorker } from "@worker-protocol/reference-worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A Control Tower, simulated, against Workers that actually answer.
 *
 * The Tower is a **role** and not a product — `spec/README.md` names a Control Tower product as a
 * non-goal, so nothing here is published and nothing here is a package. What it is for is the
 * claim the whole architecture rests on and that nothing in this repository had ever exercised:
 * that a registry can be derived entirely from Descriptors, that a Worker is catalogued by what it
 * declares, that a dead Worker is a fact the moment a poll fails, and that none of it requires the
 * Tower to be in anybody's execution path.
 *
 * Eight rules in `spec/` bind a Tower — DESC-19, DESC-20, REG-13, REG-14, REG-16, REG-19, REG-29,
 * REG-30 — and `conformance/verifiability.md` classes every one of them `P`, because a verifier
 * pointed at a base URL never contacted the party they oblige. This is that party, written once so
 * the rules have somewhere to be true, and it is built on `@worker-protocol/client` because a
 * Tower is a consumer that only ever reads.
 */

/** What a Tower keeps, and the whole of it: nothing here is a fact a Worker is authoritative over. */
type Enrollment = {
  /** REG-26. What a person wrote down. The moment of trust, and the only input. */
  baseUrl: string;
  credential: string;
  /** DESC-6. The id recorded the first time this enrollment answered. REG-13 never rebinds it. */
  id?: string;
  /** DESC-20. The last Descriptor this Tower saw, and when — dated, and authority over none of it. */
  descriptor?: unknown;
  seenAt?: Date;
  /** What the Tower worked out for itself. Its own facts, exactly as a Worker's are its own. */
  notes: string[];
};

/**
 * The Tower, in forty lines, because almost everything it would otherwise do is `consume()`'s.
 *
 * It holds no Worker's state: a registry, dated copies, and what it concluded. Nothing it offers
 * is in the path of a call, which is REG-24 read from the only side that can honour it.
 */
function tower() {
  const enrolled = new Map<string, Enrollment>();

  return {
    /** REG-26: enrolling is a person recording a base URL and a credential, and nothing else. */
    enroll(baseUrl: string, credential: string) {
      enrolled.set(baseUrl, { baseUrl, credential, notes: [] });
    },

    entries: () => [...enrolled.values()],
    entry: (baseUrl: string) => enrolled.get(baseUrl),

    /** DESC-19, DESC-20, REG-13, REG-14, REG-19 — one round of polling every enrollment. */
    async poll() {
      for (const enrollment of enrolled.values()) {
        try {
          const worker = await consume(enrollment.baseUrl, { credential: enrollment.credential });

          // REG-13: a Tower does not rebind an enrollment from the id it recorded to a different
          // one. REG-14: it records that the id changed, and keeps what it had.
          if (enrollment.id !== undefined && enrollment.id !== worker.descriptor.id) {
            enrollment.notes.push(`REG-14: the id at this URL changed to ${worker.descriptor.id}`);
            continue;
          }
          enrollment.id ??= worker.descriptor.id;

          // DESC-20: the copy is dated, and the Worker's own Descriptor wins wherever the two
          // differ. This is the one thing a Tower keeps that looks like a Worker's, and it is
          // kept so that a Worker that is down does not vanish from the catalog.
          enrollment.descriptor = worker.descriptor;
          enrollment.seenAt = new Date();
        } catch (thrown) {
          // REG-19: a credential that was refused is the Tower's own fact, recorded so an operator
          // can see it. Everything else is the poll failing, which is how a dead Worker is
          // detected at all — the Tower already knows who should answer.
          const why =
            thrown instanceof Refused && thrown.status === 401
              ? "REG-19: the recorded credential was refused"
              : `did not answer: ${(thrown as Error).name}`;
          enrollment.notes.push(why);
        }
      }
    },

    /**
     * TASK-3: the unit of discovery. An owner names a Task type and never an actor, and this is
     * the question it asks — *who answers this* — over what each Worker declared about itself.
     */
    bySkill(type: string): string[] {
      const answering: string[] = [];
      for (const enrollment of enrolled.values()) {
        const tasks = (enrollment.descriptor as { capabilities?: Record<string, unknown> })
          ?.capabilities?.tasks as { answers?: string[] } | undefined;
        if (tasks?.answers?.includes(type) && enrollment.id !== undefined) {
          answering.push(enrollment.id);
        }
      }
      return answering;
    },
  };
}

const start = async (options: Parameters<typeof createWorker>[0]) => {
  const listening = createWorker(options);
  await new Promise<void>((done) => listening.listen(0, "127.0.0.1", () => done()));
  const { port } = listening.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => listening.close(() => done())),
  };
};

describe("a Control Tower, over Workers that answer", () => {
  let worker: Awaited<ReturnType<typeof start>>;

  beforeAll(async () => {
    worker = await start({ credential: "a-token" });
  });

  afterAll(async () => {
    await worker.close();
  });

  it("derives its whole registry from Descriptors, with nothing but a URL and a credential", async () => {
    // The claim `docs/architecture.md` makes: enrolling a Worker is an operator pasting a URL and
    // a credential, and the rest is read. Nothing below is configured, declared or handed over.
    const registry = tower();
    registry.enroll(worker.url, "a-token");
    await registry.poll();

    const held = registry.entry(worker.url);
    expect(held?.id).toBe("tech.rowing.worker-protocol.reference");
    expect(held?.seenAt).toBeInstanceOf(Date);
    const capabilities = (held?.descriptor as { capabilities: object } | undefined)?.capabilities;
    expect(Object.keys(capabilities ?? {}).sort()).toEqual([
      "actions",
      "alerts",
      "events",
      "health",
      "metrics",
      "tasks",
    ]);
  });

  it("DESC-20: keeps the dated copy when a Worker stops answering, and does not drop the entry", async () => {
    // The consequence the architecture faces head on: if the registry were read from Descriptors
    // and nothing more, a Worker that is down would vanish from the catalog — and an empty catalog
    // is worse than an old one. An operator looking at a missing entry cannot tell a Worker that
    // was never enrolled from one that is simply unwell.
    const dying = await start({ credential: "a-token" });
    const registry = tower();
    registry.enroll(dying.url, "a-token");
    await registry.poll();
    const first = registry.entry(dying.url)?.seenAt;
    expect(first).toBeInstanceOf(Date);

    await dying.close();
    await registry.poll();

    const held = registry.entry(dying.url);
    expect(held?.descriptor).toBeDefined();
    expect(held?.seenAt).toBe(first);
    expect(held?.notes.at(-1)).toContain("did not answer");
  });

  it("detects a dead Worker because the poll failed, which is the argument for polling", async () => {
    // If Workers pushed their status, silence would be ambiguous: one that has gone down, one
    // whose credentials expired and one that was never registered correctly produce exactly the
    // same signal. Polling collapses that — the Tower already knows who should answer.
    const registry = tower();
    registry.enroll("http://127.0.0.1:1/never", "a-token");
    await registry.poll();

    expect(registry.entry("http://127.0.0.1:1/never")?.id).toBeUndefined();
    expect(registry.entry("http://127.0.0.1:1/never")?.notes).toHaveLength(1);
  });

  it("REG-19: records a credential that was refused, rather than dropping the Worker", async () => {
    // Its own fact, about a Worker that is answering correctly. The distinction matters to the
    // operator: the Worker is fine and the enrollment is not, and a Tower that reported the two
    // the same way would send somebody looking at the wrong half.
    const registry = tower();
    registry.enroll(worker.url, "the-wrong-token");
    await registry.poll();

    const held = registry.entry(worker.url);
    expect(held?.notes.at(-1)).toContain("REG-19");
    expect(held?.descriptor).toBeUndefined();
  });

  it("REG-13, REG-14: does not rebind an enrollment to a different id, and says so", async () => {
    // A Worker redeployed with a new id at an address somebody already wrote down is a different
    // Worker as far as every Contract is concerned, and rebinding would move them silently.
    const registry = tower();
    registry.enroll(worker.url, "a-token");
    await registry.poll();
    expect(registry.entry(worker.url)?.id).toBe("tech.rowing.worker-protocol.reference");

    const renamed = await start({ credential: "a-token", id: "tech.rowing.something.else" });
    try {
      const moved = tower();
      moved.enroll(renamed.url, "a-token");
      await moved.poll();
      // Recorded on the first poll, and then the SAME enrollment answers a different id.
      const entry = moved.entry(renamed.url);
      if (entry) entry.id = "tech.rowing.worker-protocol.reference";
      await moved.poll();

      expect(entry?.id).toBe("tech.rowing.worker-protocol.reference");
      expect(entry?.notes.at(-1)).toContain("REG-14");
    } finally {
      await renamed.close();
    }
  });

  it("catalogs by Skill, which is the unit of discovery and not a Task instance", async () => {
    // The owner names a Task type and never an actor, and the Tower answers who answers it. This
    // is the whole of what discovery is, and it is read off a Descriptor rather than registered.
    const registry = tower();
    registry.enroll(worker.url, "a-token");
    await registry.poll();

    expect(registry.bySkill("tech.rowing.worker-protocol.verify-vehicle")).toEqual([
      "tech.rowing.worker-protocol.reference",
    ]);
    expect(registry.bySkill("tech.rowing.nobody.answers-this")).toEqual([]);
  });

  it("polls what a console renders, without knowing anything about the domain", async () => {
    // The payoff `docs/architecture.md` claims: the console renders a form from a JSON Schema it
    // did not author and posts the result to an address it does not understand. Everything below
    // is read from one Worker by a Tower that has never heard of vehicles.
    const registry = tower();
    registry.enroll(worker.url, "a-token");
    await registry.poll();

    const seen = await consume(worker.url, { credential: "a-token" });
    expect((await seen.health?.())?.status).toBe("healthy");
    expect((await seen.alerts?.())?.length).toBeGreaterThan(0);
    expect((await seen.tasks?.list())?.length).toBeGreaterThan(0);
    expect(await seen.actions?.settings?.()).toEqual({ label: "reference", pollSeconds: 60 });

    // MET-11: the interval is half-open and both ends are RFC 3339 instants the client formats.
    // Absent, `from` is the start of the bucket in progress — which for this Worker is a day it
    // has no facts in, and answering nothing is MET-15 working rather than a gap.
    const buckets = await seen.metrics?.read("tasks-resolved", {
      granularity: "day",
      from: new Date(Date.now() - 15 * 86_400_000),
      to: new Date(),
    });
    expect(buckets?.length).toBeGreaterThan(0);
    // MET-13: the end is carried rather than derived, and the Tower never computes one.
    expect(buckets?.[0]?.end).toBeDefined();
    // MET-15: the quiet day the reference Worker seeds is ABSENT rather than zero, so a console
    // never reads `nothing happened` as `it happened and was nought`.
    expect(buckets?.length).toBeLessThan(14);
  });

  it("is in nobody's execution path: the work runs with the Tower gone", async () => {
    // REG-24 and the claim it protects. A consumer that already holds a Contract reads Tasks from
    // the owner and posts its Response to the owner, and no Tower is involved in any of it — so
    // the sequence below is the whole of a Response, performed with no registry in the process.
    const consumer = await consume(worker.url, { credential: "a-token" });
    const held = await consumer.tasks?.claimAny("tech.rowing.worker-protocol.verify-vehicle");
    expect(held?.held?.type).toBe("tech.rowing.worker-protocol.verify-vehicle");

    const vehicle = (held?.held?.payload as { vehicle: string } | undefined)?.vehicle ?? "";
    await held?.answer(
      "record-verification",
      { vehicle, verified: true },
      { idempotencyKey: `tower-test-${Date.now()}` },
    );
    await held?.close("done");

    // TASK-15: the condition stopped holding, so the Task is gone — and nobody declared it.
    const left = await consumer.tasks?.list();
    expect(left?.some((task) => (task.payload as { vehicle?: string }).vehicle === vehicle)).toBe(
      false,
    );
  });
});

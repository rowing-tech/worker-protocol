import {
  type Alert,
  alertEnded,
  alertRaised,
  lifecycleChanges,
  type OpenTask,
  taskEnded,
  taskRaised,
} from "@worker-protocol/hono";
import { type DurableObjectClass, first, type Mixed } from "./durable.ts";
import type { OutboxEvent, OutboxMethods } from "./outbox.ts";
import { migrate, type Schema } from "./schema.ts";

/**
 * When a Task or an Alert is born and when it ends (EVT-15), owed from a Durable Object that derives
 * both from its own Facts.
 *
 * **There is one way of finding out, and the Worker supplies two things to it.** `snapshot(at)` is
 * the Tasks and Alerts whose conditions hold at an instant, and `nextChange(after)` is the next
 * instant at which one can begin or end without anybody acting — a minute boundary, the end of an
 * incident, a deadline. Everything else is here, because every Worker that publishes its lifecycle
 * from snapshots wrote it again:
 *
 * - **Time, which nobody witnesses,** is compared at every instant `nextChange` names between the
 *   last one compared and now. The mark of the last instant survives the object, so a run that was
 *   missed leaves no gap; one that fell further behind than `catchUpMs` gives the rest up and says
 *   so, and one run compares at most `mostPerRunMs`, so a catch-up is spread over several.
 * - **An Action** compares the instant it acts at before its write and after it, in the same
 *   transaction (`changing`), and owes what changed in the same call — the moment only it knows.
 * - **Every id is derived, never drawn:** the transition, the resource's id and its `since`. So an
 *   instant compared twice, an Action and the heartbeat seeing the same change, or an alarm
 *   delivered again all name the same event, and the ids already owed are remembered for
 *   `keepAnnouncedMs` so that none is owed twice.
 * - **Nothing announces an end without its beginning.** A Task an Action ended before the heartbeat
 *   compared the instant it was born at was never announced, so its birth is owed with its end.
 * - **The heartbeat keeps itself going** on the one alarm `withOutbox` shares, at the next instant
 *   `nextChange` names. A cron that calls `heartbeat()` every so often is what starts the chain and
 *   restarts it if an alarm is ever lost.
 *
 * It composes over `withOutbox`, whose `enqueue` it owes into and whose alarm it shares.
 */

/** The Tasks and Alerts whose conditions hold at one instant. */
export type LifecycleSnapshot = { tasks: OpenTask[]; alerts: Alert[] };

/** What one comparison run did: the instants it covered, what it owed, and what it gave up. */
export type Advanced = {
  from: number;
  to: number;
  owed: number;
  /** The instants it did not compare because it had fallen further behind than `catchUpMs`. */
  skipped?: { from: number; to: number };
};

/** What `withLifecycle` adds to a Durable Object, and the two methods it asks of it. */
export interface LifecycleMethods {
  /** The Tasks and Alerts whose conditions hold at `at`, read synchronously from this object. */
  snapshot(at: number): LifecycleSnapshot;
  /** The first instant after `after` at which one can begin or end without anybody acting. */
  nextChange(after: number): number;
  changing<T>(now: number, write: () => T): T;
  advance(now: number): Promise<Advanced>;
  heartbeat(): Promise<Advanced & { next: number }>;
  lifecycleSkipped(range: { from: number; to: number }): void;
}

const MINUTE = 60_000;

/** `migrate` applies these; a new step goes at the end, and a published one is never edited. */
const SCHEMA: Schema = {
  piece: "worker-protocol.lifecycle",
  steps: [
    [
      // Every lifecycle event ever owed, by id, so none is owed twice.
      `CREATE TABLE IF NOT EXISTS wp_lifecycle_owed (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS wp_lifecycle_owed_at ON wp_lifecycle_owed (at)",
      // The last instant compared, one row.
      `CREATE TABLE IF NOT EXISTS wp_lifecycle_mark (
        one INTEGER PRIMARY KEY CHECK (one = 1),
        at INTEGER NOT NULL
      )`,
    ],
  ],
};

const idOf = (transition: string, resource: { id: string; since: Date }) =>
  `${transition}:${resource.id}:${resource.since.getTime()}`;

/** A birth carries the `since` the resource declares (TASK-28, ALRT-3) as its `time`. */
const bornTask = (task: OpenTask): OutboxEvent => ({
  ...taskRaised(task),
  id: idOf("task-raised", task),
  time: task.since.getTime(),
});

const bornAlert = (alert: Alert): OutboxEvent => ({
  ...alertRaised(alert),
  id: idOf("alert-raised", alert),
  time: alert.since.getTime(),
});

/** What was born and what ended between two snapshots; an ending is dated `at`, after its birth. */
export function lifecycleEventsBetween(given: {
  previous: LifecycleSnapshot;
  current: LifecycleSnapshot;
  at: number;
}): OutboxEvent[] {
  const { previous, current, at } = given;
  const tasks = lifecycleChanges({ previous: previous.tasks, current: current.tasks });
  const alerts = lifecycleChanges({ previous: previous.alerts, current: current.alerts });
  return [
    ...tasks.raised.map(bornTask),
    ...tasks.ended.flatMap((task) => [
      bornTask(task),
      { ...taskEnded(task), id: idOf("task-ended", task), time: at },
    ]),
    ...alerts.raised.map(bornAlert),
    ...alerts.ended.flatMap((alert) => [
      bornAlert(alert),
      { ...alertEnded(alert), id: idOf("alert-ended", alert), time: at },
    ]),
  ];
}

export function withLifecycle<B extends Mixed<DurableObjectClass, OutboxMethods>>(
  Base: B,
  options: {
    /** How far behind the comparison may fall before the instants in between are given up. */
    catchUpMs?: number;
    /** How much one run compares at most, so a catch-up is spread over several. */
    mostPerRunMs?: number;
    /** How long an owed id is remembered: well past any instant that could be compared again. */
    keepAnnouncedMs?: number;
  } = {},
): Mixed<B, LifecycleMethods> {
  const catchUpMs = options.catchUpMs ?? 120 * MINUTE;
  const mostPerRunMs = options.mostPerRunMs ?? 60 * MINUTE;
  const keepAnnouncedMs = options.keepAnnouncedMs ?? 2 * 24 * 60 * MINUTE;

  abstract class WithLifecycle extends Base implements LifecycleMethods {
    abstract snapshot(at: number): LifecycleSnapshot;
    abstract nextChange(after: number): number;

    /**
     * Owes each event not owed before, in the transaction the calling method is in, and answers how
     * many were new. The outbox holds an id back only while it waits; this remembers it after.
     */
    private owe(now: number, events: OutboxEvent[]): number {
      const sql = migrate(this.ctx.storage, SCHEMA);
      // `RETURNING` answers a row only for an id this inserted, and nothing for one already there.
      const fresh = events.filter(
        (event) =>
          sql
            .exec(
              "INSERT INTO wp_lifecycle_owed (id, at) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING id",
              event.id,
              now,
            )
            .toArray().length > 0,
      );
      this.enqueue(now, fresh);
      return fresh.length;
    }

    /**
     * Performs `write` and owes what it changed: the Tasks and Alerts at `now` before it and after
     * it, compared in the same transaction as the write. `write` is synchronous, because the
     * comparison is only true of the write if nothing interleaves between the three.
     */
    changing<T>(now: number, write: () => T): T {
      const before = this.snapshot(now);
      const done = write();
      this.owe(
        now,
        lifecycleEventsBetween({ previous: before, current: this.snapshot(now), at: now }),
      );
      return done;
    }

    /**
     * Compares from the last instant compared up to `now`, at every instant `nextChange` names,
     * owes what was born and what ended, and sends it. The first run only sets the mark, because
     * what was born before anybody watched was not seen being born.
     */
    async advance(now: number): Promise<Advanced> {
      const sql = migrate(this.ctx.storage, SCHEMA);
      const mark = first(
        sql.exec<{ at: number }>("SELECT at FROM wp_lifecycle_mark WHERE one = 1"),
      )?.at;
      let from = mark ?? now;
      let skipped: Advanced["skipped"];
      if (now - from > catchUpMs) {
        skipped = { from, to: now - catchUpMs };
        from = now - catchUpMs;
        this.lifecycleSkipped(skipped);
      }
      const to = Math.min(now, from + mostPerRunMs);
      const owed: OutboxEvent[] = [];
      if (to > from) {
        let previous = this.snapshot(from);
        let at = from;
        while (at < to) {
          const asked = this.nextChange(at);
          // An answer that does not move forward is read as nothing before `to`.
          const next = asked > at ? Math.min(asked, to) : to;
          const current = this.snapshot(next);
          owed.push(...lifecycleEventsBetween({ previous, current, at: next }));
          previous = current;
          at = next;
        }
      }
      const fresh = this.owe(now, owed);
      sql.exec(
        "INSERT OR REPLACE INTO wp_lifecycle_mark (one, at) VALUES (1, ?)",
        Math.max(to, from),
      );
      sql.exec("DELETE FROM wp_lifecycle_owed WHERE at < ?", now - keepAnnouncedMs);
      await this.flush();
      return { from, to, owed: fresh, ...(skipped === undefined ? {} : { skipped }) };
    }

    /**
     * Compares up to now, then asks the one alarm to come back at the next instant anything can
     * change at. A cron calls it to start the chain and to restart it if an alarm was ever lost;
     * after that the alarm keeps it going on its own (`wake`).
     */
    async heartbeat(): Promise<Advanced & { next: number }> {
      const advanced = await this.advance(Date.now());
      const next = this.nextChange(Date.now());
      await this.wakeAt(next);
      return { ...advanced, next };
    }

    /**
     * Told when a run gave instants up, for a Worker that keeps records to write one. Nothing,
     * unless overridden.
     */
    lifecycleSkipped(_range: { from: number; to: number }): void {}

    /** The alarm `heartbeat` asked for. A Worker that needs the alarm too calls `super.wake()`. */
    override async wake(): Promise<void> {
      await this.heartbeat();
    }
  }
  return WithLifecycle;
}

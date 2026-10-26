/**
 * The `tasks` surface, which is everything in `spec/tasks.md` that is not a Fact.
 *
 * A Worker declares what it raises and answers, and says which Tasks' conditions hold right now.
 * That is the whole of what it owes, because TASK-15 makes a Task a condition over the Worker's own
 * Facts and nothing else here can know one. The page envelope, the cursor, the filter that must be
 * refused rather than ignored, the ordering that makes paging terminate: those are fixed by rules,
 * and a Worker writing any of them again would be re-deriving the specification.
 *
 * **This file used to be twice as long and most of what is gone was a Claim** — a lease, an expiry,
 * a fencing token, counts of what had failed and lapsed, an identifier for whoever held one.
 * `spec/tasks.md` carries the argument for withdrawing it.
 */

import type { qualifiedName } from "@worker-protocol/schemas";
import type * as z from "zod";
import type { ActionCall, ActionDeclarations } from "./actions.ts";
import { rfc3339 } from "./buckets.ts";
import type { ErrorCode } from "./codes.ts";
import { cursorAfter, encodeCursor, onlyKnown, type Page, pageOf } from "./collection.ts";
import type { Covering } from "./grants.ts";
import type { Refusal } from "./worker.ts";

/** What a Worker says about a Task whose condition holds: the domain, and the whole of it. */
export type OpenTask = {
  /** TASK-28. The Worker's own id, opaque to everyone else. */
  id: string;
  /** TASK-4, NAME-7. One of the types the entry declares under `raises`. */
  type: z.infer<typeof qualifiedName>;
  /** TASK-28. Against the schema that type declared. The Worker's own shape. */
  payload: unknown;
  /**
   * TASK-28. When this condition began.
   *
   * It is what a stuck Task is read from, and it is the one field here a Worker has to think
   * about: a condition derived fresh on every read has no memory of when it started, so a Worker
   * that answers `new Date()` is answering *now* and telling an operator nothing.
   */
  since: Date;
  /**
   * TASK-37. What this Worker already knows for the input of the Actions that answer this Task,
   * keyed by Action name and then by member — the vehicle it is about, the source that paused. A
   * console fills its form with them and an answerer need not guess which payload member goes
   * where. They bind nothing: whatever arrives is judged as any input is.
   */
  inputs?: Record<string, Record<string, unknown>>;
  /**
   * TASK-38. Which of the type's answering Actions apply to this Task now, derived from the same
   * Facts as the Task itself. Left out, every one does; empty, none does yet. An Action the current
   * state does not allow is still refused with `409`, whatever a read said.
   */
  available?: string[];
  /**
   * TASK-47. The value this Task carries for each dimension it is about — the base a trip departs
   * from, the store a delivery waits at — under names the entry declares in `dimensions`, one
   * string each. Left out, the Task is about none of them and no read that fixes one answers it.
   */
  dimensions?: Record<string, string>;
};

/**
 * TASK-35. What a Worker declares about one Task type it raises: what it sends, and the Actions of
 * its own that answer it — none, one or several, by the names its `actions` entry holds.
 *
 * `payload` is a Zod object and not a JSON Schema written by hand, for the reason ACT-2's input is
 * one: the Descriptor carries the JSON Schema a console renders a form from, `mount()` generates it
 * from this, and there is one declaration rather than two that can drift.
 */
export type TaskTypes = Record<
  string,
  {
    payload: z.ZodType;
    answeredBy?: string[];
    /** NAME-10. The Task type that replaces this one, by the name `raises` holds it under. */
    supersededBy?: string;
  }
>;

/**
 * What a Worker is asked for when it answers a read itself: a page of its own store, over a query
 * it did not have to decode.
 *
 * Everything here is already checked. `type` is one the entry declares (TASK-8), every name under
 * `dimensions` is one it declares and was fixed once (TASK-48, TASK-50, ENDP-24), and `cursor` is
 * exactly what this Worker last answered as `nextCursor`.
 */
export type TaskQuery = {
  /** TASK-8. The one type the read fixes, where it fixed one. */
  type?: string;
  /** TASK-48. The value each fixed dimension must carry. Empty where the read fixed none. */
  dimensions: Record<string, string>;
  /** ENDP-21. The string this Worker last answered as `nextCursor`, or absent for the first page. */
  cursor?: string;
  /** ENDP-19. The most Tasks one page carries. */
  limit: number;
};

/**
 * One page, as the Worker answers it.
 *
 * The order and the cursor are the Worker's, because the position a cursor names is a position in
 * the Worker's store. What it owes in return is ENDP-23 and ENDP-33: an order it holds, and a page
 * reached through a cursor that carries nothing the page before it carried.
 */
export type TaskReadPage = {
  tasks: OpenTask[];
  /** ENDP-20. Absent at the end — absent, not null. */
  nextCursor?: string;
};

/** What a Worker author implements for `tasks`, beside the declaration itself. */
export type TaskFacts = {
  /**
   * TASK-15. The Tasks whose conditions hold, derived from this Worker's own Facts.
   *
   * It is called on every read, so it answers the present rather than a cache: a Task closes when
   * its condition stops holding, and nothing else in this protocol closes one.
   */
  current: () => OpenTask[] | Promise<OpenTask[]>;
  /**
   * TASK-5, TASK-48. One page of the Tasks whose conditions hold, answered from the Worker's own
   * store. Optional, and beside `current` rather than instead of it.
   *
   * Without it, a read calls `current()`, filters by type and dimension here and pages in memory —
   * correct, and a scan: the Worker derives every open Task to answer one base's page. With it, the
   * Worker answers the page from an index and a cursor of its own, as `logs` does, and this module
   * still refuses what the specification refuses, applies TASK-6 and TASK-44, and serializes. A
   * Task it answers that does not match the query, or that the credential does not read, is left
   * out of the page rather than sent. `current()` is still what TASK-39 looks a named Task up in.
   */
  read?: (query: TaskQuery) => TaskReadPage | Refusal | Promise<TaskReadPage | Refusal>;
  /**
   * TASK-6. Which Task ids the credential presented covers, or `undefined` for all of them.
   *
   * The owner filters rather than the consumer discarding, and the file gives two reasons: a list
   * showing every Task to every holder of any Contract is a disclosure the owner cannot take back,
   * and a consumer reading through work it may not take costs both sides.
   *
   * It may answer a promise, because what a Contract covers is a thing a Worker looks up rather
   * than a thing it holds — the Tower brokered it, the Worker stored what it was told, and reading
   * that is a query like any other.
   *
   * `principal` is whom `authenticate` accepted, where it said — absent where it answered the bare
   * `"accepted"` — so a Contract kept against a holder is found without looking the token up again.
   */
  covers?: (
    token: string | undefined,
    principal?: unknown,
  ) => string[] | undefined | Promise<string[] | undefined>;
  /** ENDP-19 (recommended). The most Tasks one page carries. */
  pageSize?: number;
};

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/** TASK-48: a Task matches when it carries every fixed value, and one it lacks matches nothing. */
const matches = (task: OpenTask, fixed: Record<string, string>): boolean =>
  Object.entries(fixed).every(([name, value]) => task.dimensions?.[name] === value);

export type TaskSurface = {
  read: (
    query: URLSearchParams,
    /** Who is reading, and what this request's credential covers (TASK-6, TASK-44, GRANT-8). */
    call: { token: string | undefined; principal: unknown; covering: Covering },
  ) => Promise<Refusal | Page>;
};

/**
 * TASK-38, from ACT-17's condition: the answers that apply to this Task now, where the Worker left
 * that to the SDK. A Task that says `available` itself keeps what it said; one whose answers
 * declare no `refuses` has nothing to narrow and carries no `available`, which means all of them.
 */
export async function availableFor(
  task: OpenTask,
  given: { names: string[]; accepts: ActionDeclarations; call: Omit<ActionCall, "name"> },
): Promise<string[] | undefined> {
  if (task.available !== undefined) return task.available;
  const { names, accepts, call } = given;
  if (!names.some((name) => accepts[name]?.refuses !== undefined)) return undefined;
  const applies = await Promise.all(
    names.map(async (name) => {
      const refuses = accepts[name]?.refuses;
      if (refuses === undefined) return true;
      return (await refuses((task.inputs?.[name] ?? {}) as never, { ...call, name })) === undefined;
    }),
  );
  return names.filter((_, at) => applies[at]);
}

/**
 * TASK-44: `available` for this caller. Where the credential covers every Action the type names,
 * what TASK-38 derived stands — absent included. Otherwise the member is there, without the
 * Actions it does not cover, and `[]` where it covers none: the Task is still listed, because
 * TASK-6 alone decides what a credential reads.
 */
const forCaller = (given: {
  available: string[] | undefined;
  names: string[];
  covered: string[] | undefined;
}): string[] | undefined => {
  const { available, names, covered } = given;
  if (covered === undefined || names.every((name) => covered.includes(name))) return available;
  return (available ?? names).filter((name) => covered.includes(name));
};

export function tasks(declared: {
  raises: TaskTypes;
  /** TASK-45. The dimensions the entry declares, by name. */
  dimensions?: string[];
  facts: TaskFacts;
  /** The `actions` entry's own map, for the `refuses` TASK-38 is derived from. */
  accepts: ActionDeclarations;
}): TaskSurface {
  const { raises, facts, accepts } = declared;
  const dimensionNames = declared.dimensions ?? [];
  const cap = facts.pageSize ?? 50;
  // ENDP-24: the cursor, TASK-8's `type` and each dimension TASK-48 lets a read fix.
  const known = new Set(["cursor", "type", ...dimensionNames]);

  /** TASK-28, TASK-37, TASK-38, TASK-47: one Task as it travels. */
  const serialize = (task: OpenTask) => ({
    id: task.id,
    type: task.type,
    payload: task.payload,
    since: rfc3339(task.since),
    ...(task.inputs === undefined ? {} : { inputs: task.inputs }),
    ...(task.available === undefined ? {} : { available: task.available }),
    ...(task.dimensions === undefined ? {} : { dimensions: task.dimensions }),
  });

  return {
    async read(query, call) {
      const { token, principal, covering } = call;
      // TASK-8: a type the entry does not declare. The surface exists and the caller asked about
      // something this Worker never raises, which is a parameter whose VALUE it will not accept.
      const type = query.get("type");
      if (type !== null && !(type in raises)) {
        return refuse("invalid_parameter", `No Task type named ${type} is declared.`);
      }

      // ENDP-24: a parameter that is neither TASK-8's, a declared dimension nor the cursor.
      const unknown = onlyKnown(query, known);
      if (unknown !== null) return unknown;

      // TASK-48, TASK-50: each declared dimension fixed at most once. Any value is accepted
      // (TASK-49): the Worker cannot tell a typo from a value about to exist.
      const fixed: Record<string, string> = {};
      for (const name of dimensionNames) {
        const values = query.getAll(name);
        if (values.length > 1) {
          return refuse("invalid_parameter", `A read fixes ${name} once.`);
        }
        const [value] = values;
        if (value !== undefined) fixed[name] = value;
      }

      // ENDP-21: the Worker's cursor travels wrapped, so one a caller made up is refused here
      // rather than handed to the Worker's store as a position.
      const resumed = cursorAfter(query);
      if ("code" in resumed) return resumed;
      const { after } = resumed;

      // TASK-6, TASK-44, GRANT-8: what this credential reads and performs is `covering`'s, asked
      // beside the Tasks themselves because neither needs the other.
      const [reads, covered, answered] = await Promise.all([
        covering.tasks(),
        covering.actions(),
        facts.read === undefined
          ? facts.current()
          : facts.read({
              ...(type === null ? {} : { type }),
              dimensions: fixed,
              ...(after === null ? {} : { cursor: after }),
              limit: cap,
            }),
      ]);
      if ("code" in answered) return answered;
      const wanted = (task: OpenTask) =>
        reads(task) && (type === null || task.type === type) && matches(task, fixed);
      const offered = (held: OpenTask[]) =>
        Promise.all(
          held.map(async (task) => {
            const names = raises[task.type]?.answeredBy ?? [];
            const available = forCaller({
              available: await availableFor(task, { names, accepts, call: { token, principal } }),
              names,
              covered,
            });
            return available === undefined ? task : { ...task, available };
          }),
        );

      if (Array.isArray(answered)) {
        // ENDP-19's cap, ENDP-20's envelope and ENDP-23's order are the same for every collection
        // in this protocol, and `collection.ts` carries them. What is left here is what only Tasks
        // know: which ones this credential covers, and what a Task looks like.
        const items = await offered(answered.filter(wanted));
        return pageOf({ items, after, serialize, pageSize: cap });
      }
      // Not truncated to the cap, for `logs`' reason: the Worker's cursor names a position past
      // everything it answered, so slicing would strand what was cut.
      const items = (await offered(answered.tasks.filter(wanted))).map(serialize);
      return answered.nextCursor === undefined
        ? { items }
        : { items, nextCursor: encodeCursor(answered.nextCursor) };
    },
  };
}

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
import { collection, type Page } from "./collection.ts";
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

/** What TASK-5 defines on this read beyond the cursor; `collection` refuses everything else. */
const READ_PARAMETERS = ["type"] as const;

export type TaskSurface = {
  read: (
    query: URLSearchParams,
    token: string | undefined,
    principal: unknown,
  ) => Promise<Refusal | Page>;
};

/**
 * TASK-38, from ACT-17's condition: the answers that apply to this Task now, where the Worker left
 * that to the SDK. A Task that says `available` itself keeps what it said; one whose answers
 * declare no `refuses` has nothing to narrow and carries no `available`, which means all of them.
 */
async function availableFor(
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

export function tasks(declared: {
  raises: TaskTypes;
  facts: TaskFacts;
  /** The `actions` entry's own map, for the `refuses` TASK-38 is derived from. */
  accepts: ActionDeclarations;
}): TaskSurface {
  const { raises, facts, accepts } = declared;
  const cap = facts.pageSize ?? 50;

  return {
    async read(query, token, principal) {
      // TASK-8: a type the entry does not declare. The surface exists and the caller asked about
      // something this Worker never raises, which is a parameter whose VALUE it will not accept.
      const type = query.get("type");
      if (type !== null && !(type in raises)) {
        return refuse("invalid_parameter", `No Task type named ${type} is declared.`);
      }

      // TASK-6: only what this credential covers. Absent, it covers everything.
      const covers = await facts.covers?.(token, principal);
      const held = (await facts.current())
        .filter((task) => covers === undefined || covers.includes(task.id))
        .filter((task) => type === null || task.type === type);
      const matching = await Promise.all(
        held.map(async (task) => {
          const available = await availableFor(task, {
            names: raises[task.type]?.answeredBy ?? [],
            accepts,
            call: { token, principal },
          });
          return available === undefined ? task : { ...task, available };
        }),
      );

      // ENDP-19's cap, ENDP-20's envelope, ENDP-21's cursor and ENDP-23's order are the same for
      // every collection in this protocol, and `collection.ts` carries them. What is left here is
      // what only Tasks know: which ones this credential covers, and what a Task looks like.
      return collection(
        matching,
        query,
        (task) => ({
          id: task.id,
          type: task.type,
          payload: task.payload,
          since: rfc3339(task.since),
          ...(task.inputs === undefined ? {} : { inputs: task.inputs }),
          ...(task.available === undefined ? {} : { available: task.available }),
        }),
        cap,
        READ_PARAMETERS,
      );
    },
  };
}

/**
 * The `actions` surface: the call, and everything the protocol fixes about one.
 *
 * A Worker knows what an Action DOES. Everything else on the way in is a rule — the name that is
 * not declared, the body that will not parse, the input that does not match the schema the Worker
 * published, the required idempotency key that is absent, the repeat under a key already recorded,
 * and the key reused with another body.
 *
 * The input is declared as a Zod object and used twice: `mount()` generates the JSON Schema the
 * Descriptor carries from it, and this validates against the same object. ACT-2 requires that a
 * console can render a form from the declaration without being told anything else, and a Worker
 * that wrote the schema by hand and the validation by hand had two places to disagree.
 *
 * **A call may say which Task it answers, and only then does this know.** `Worker-Protocol-Task`
 * names an open Task (TASK-39), whose type must list the Action (TASK-40) and whose `available`
 * must not leave it out (TASK-41). A call without the header is a performance like any other, as
 * it always was: an Action is still performed for reasons that are no Task's at all.
 */

import * as z from "zod";
import type { ErrorCode } from "./codes.ts";
import { type Coverage, covers as listCovers, within } from "./grants.ts";
import { availableFor, type OpenTask, type TaskFacts, type TaskTypes } from "./tasks.ts";
import type { Answer, Refusal } from "./worker.ts";

/**
 * What a Worker declares about one Action, and what it does.
 *
 * ACT-2's `input` and ACT-3's `result` are Zod objects here and JSON Schema in the Descriptor.
 * `mount()` converts them, so nothing is declared twice and nothing can drift.
 */
export type Action = {
  /** ACT-2. The whole of what a caller sends, and what a console renders a form from. */
  input: z.ZodType;
  /** ACT-3. What a performance answers, absent where it answers nothing (ACT-10's `204`). */
  result?: z.ZodType;
  /** ACT-4. Declared rather than discovered, because a caller decides whether it can wait. */
  completesWithinCall?: boolean;
  /** ACT-19, ENDP-38. Absent where the Action takes no key. */
  idempotency?:
    | { required: boolean; from: "header"; windowSeconds: number }
    | { required: boolean; from: "input"; members: string[]; windowSeconds: number };
  /**
   * NAME-10. The Action that replaces this one, by the name `accepts` holds it under. Nothing on a
   * call changes: this Action is still performed exactly as it is declared.
   */
  supersededBy?: string;
  /**
   * ACT-17, TASK-38. Why the Worker's current state does not allow this Action for this input, or
   * `undefined` where it does — the condition written once, for two uses.
   *
   * `mount()` asks it before `run`, after a repeat under an idempotency key has been answered from
   * the recorded outcome, and answers `409 conflict` with the reason. It also asks it of each open
   * Task this Action answers, with what the Task fills in for it (TASK-37), and leaves out of
   * `available` every answer it refuses — so a console never offers what the call would refuse.
   * The input may therefore be partial: it holds what the caller sent, or what the Task knew.
   */
  refuses?: (input: never, call: ActionCall) => string | undefined | Promise<string | undefined>;
  /**
   * What this Action does. The input has already been validated against `input` above.
   *
   * A `Refusal` of `unprocessable_content` is ACT-17: schema-valid, and refused on the Worker's own
   * rules. Anything returned that is not a refusal is the result, and `undefined` is ACT-10's
   * `204` — the status comes from what the Action declared, never from what a handler chose.
   */
  run: (input: never, call: ActionCall) => unknown | Promise<unknown>;
};

/** What a performance knows about the call it arrived on, beyond its input. */
export type ActionCall = {
  /** The Action's own name, for a handler shared between several. */
  name: string;
  /** REG-3. The credential presented, for a Worker that splits its own facts by it. */
  token: string | undefined;
  /**
   * ENDP-38. The key this call arrived under, as the caller sent it — from the header or from the
   * declared member of the input — and absent where the Action takes no key or none was sent.
   *
   * It is here for a Worker that performs by asking another: a repeat reaches `run` only after an
   * earlier performance threw or refused and gave its key back, and the one downstream may already
   * have acted on it. Sending a key made from this one lets ENDP-16 answer that repeat there too.
   *
   * **Derive the downstream key from this one and `caller` together, rather than forwarding it.**
   * ENDP-34 scopes a header key to the caller that presented it, so two callers may send the same
   * string here and mean two performances; a derivation that leaves `caller` out sends both to the
   * other Worker as one key. It has to stay the same across deployments, or a repeat after one
   * reaches the other Worker as a new key.
   *
   * It stays the key as sent, and not the scoped one `mount()` reserves, so that a Worker already
   * deriving from it did not see its downstream key move when the scope arrived.
   */
  idempotencyKey?: string;
  /** REG-3. Whom `authenticate` accepted, where it said. Absent where it answered `"accepted"`. */
  principal?: unknown;
  /**
   * ENDP-34. The caller `authenticate` named, where it named one — the scope a header key is
   * reserved under. Absent where it named none, and then every caller shares one scope.
   */
  caller?: string;
  /**
   * TASK-39. The open Task this call says it answers, as `current()` gave it, and absent where the
   * call names none. By the time `run` sees it, it was open, its type lists this Action (TASK-40)
   * and its `available` does not leave it out (TASK-41).
   *
   * **This is where `task-answered` is published from (EVT-20), and only here.** `run` is reached
   * once per performance and never for a repeat ENDP-16 answers from the record, which is exactly
   * EVT-21's count — and a Worker that writes its Facts and its outbox in one transaction writes
   * the answer in the same one. `taskAnswered()` builds the event.
   */
  task?: OpenTask;
};

export type ActionDeclarations = Record<string, Action>;

/**
 * Write an Action, and have `run` typed by the schema above it.
 *
 * `Action.input` is a Zod object and `Action.run` takes what it parses — but a record of Actions
 * cannot carry one type parameter per entry, so annotating the record makes `run`'s argument
 * `unknown` and the author writes the shape a second time, by hand, beside the schema that already
 * states it. Two declarations of one thing, and the day they disagree the compiler says nothing.
 *
 * ```ts
 * accepts: {
 *   "record-check": action({
 *     input: z.object({ vehicle: z.string(), reachable: z.boolean() }),
 *     run: ({ vehicle }) => …,   // vehicle is a string, from the line above
 *   }),
 * }
 * ```
 *
 * Like `defineWorker`, it returns its argument and no rule id can be cited for it. It is here
 * because the alternative is every Worker author writing every input type twice.
 */
export const action = <I extends z.ZodType>(
  declaration: Omit<Action, "input" | "run" | "refuses"> & {
    input: I;
    refuses?: (
      input: Partial<z.infer<I>>,
      call: ActionCall,
    ) => string | undefined | Promise<string | undefined>;
    run: (input: z.infer<I>, call: ActionCall) => unknown | Promise<unknown>;
  },
): Action => declaration as Action;

export type ActionFacts = {
  /** ACT-16. Every Action this Worker accepts, keyed by name. */
  accepts: ActionDeclarations;
  /** ACT-21. The document `configure` would accept, where the Worker accepts settings. */
  settings?: () => unknown | Promise<unknown>;
  /**
   * ACT-22. Which Actions the credential presented covers, by name, or `undefined` for all of them.
   *
   * The same shape as the `covers` of Tasks, and asked the same way: once per call, with whom
   * `authenticate` accepted. A declared Action left out is `403` before its body is read, and a
   * Task read with this credential leaves it out of `available` (TASK-44). A Worker holding one
   * static secret leaves this out and covers everything with it.
   */
  covers?: (
    token: string | undefined,
    principal?: unknown,
  ) => string[] | undefined | Promise<string[] | undefined>;
  /**
   * ENDP-16. Where the recorded outcomes live. **Required as soon as any Action declares a key.**
   *
   * There is no default, and the absence is the design. The obvious one is a Map, which is correct
   * in exactly one place — a single long-lived process — and silently wrong everywhere that scales
   * horizontally: a Worker across isolates has one Map per isolate, so a repeat under the same key
   * reaches a process that recorded nothing, the Action is performed a second time *while the
   * caller believes it is protected*, and both calls answer `200` so nobody sees two.
   *
   * A default would have made that the thing you get by not thinking about it, on the platform
   * this protocol's architecture names first. So it is written, in one line, by whoever knows where
   * their Worker runs: `memoryOutcomes()` in a process, a store over a durable object, a KV
   * namespace or a table anywhere else.
   */
  outcomes?: OutcomeStore;
};

/**
 * What `begin` answers: the outcome already recorded, somebody else performing it now, or the
 * reservation — which is the only one of the three that performs anything.
 */
export type Reservation =
  /** ENDP-16. Within the window, this key already has an outcome. It is answered, not performed. */
  | { held: Recorded }
  /** Another request holds this key and has not finished. Nothing is performed; ENDP-40's `409`. */
  | "in-flight"
  /** Nobody held it. This request performs the Action and calls `complete` or `release`. */
  | "reserved";

/**
 * Where a Worker keeps what ENDP-16 promised, when a Map will not do.
 *
 * **It reserves rather than reads, and that is the whole shape of it.** A `get` then a `put` with
 * the Action running in between is a check-then-act: two requests arriving at once under one key
 * both find nothing recorded, both perform, and both record. A durable object does not fix it,
 * because the Action runs outside the durable object — between the two calls, which is exactly
 * where the window is. So the first call *takes* the key, and only whoever took it performs.
 *
 * Every store has this in one operation already. A durable object is single-threaded, so reading
 * and writing in one method is atomic by construction. SQL is `insert … on conflict do nothing`,
 * and the rows affected say which of the three happened. A Map is `has` then `set` with nothing
 * between them, because JavaScript does not interleave.
 *
 * `until` travels on `begin` so that a store with its own time-to-live can set it when it reserves
 * — a KV namespace, a durable object alarm — and one without may ignore it: `begin` is asked to
 * treat a record whose window has passed as absent, and `mount()` never sees the difference.
 */
export type OutcomeStore = {
  /**
   * Take the key, or say what is already there. Nothing is performed unless this answers
   * `"reserved"`, and whoever gets that calls `complete` or `release`.
   *
   * **A reservation expires at `until`, and that is a requirement and not a hint.** A request that
   * dies between `begin` and `complete` — the process evicted, the isolate killed, the machine
   * gone — calls neither, so nothing gives the key back. Without an expiry every later request
   * under it would meet `in-flight` forever, and one crash would lock an Action out permanently
   * over work that never finished. With one, it costs a window. A store treats a reservation whose
   * `until` has passed exactly as it treats one that was never taken.
   */
  begin: (key: string, until: number) => Reservation | Promise<Reservation>;
  /** The Action ran and this is what it answered. The reservation becomes the record. */
  complete: (key: string, held: Recorded) => void | Promise<void>;
  /**
   * The Action did not run, or refused. The reservation is given up so the next caller may take
   * it — a refusal is not an outcome, and a key held by a request that failed would lock the
   * Action out for the whole window over something that never happened.
   */
  release: (key: string) => void | Promise<void>;
  /** Set by `memoryOutcomes` alone, so `mount()` can tell one built per request from a durable one. */
  readonly [IN_MEMORY]?: true;
};

/**
 * What marks a store as living in this process and nowhere else.
 *
 * `mount()` uses it for one check it could not otherwise make: a store built INSIDE the function
 * that answers the Worker is a fresh one on every request, which forgets everything between two
 * calls and breaks ENDP-16 exactly as having no store does. Comparing identity would catch that and
 * would also fail a perfectly correct Worker that builds a thin adapter per request over a durable
 * backend — so only a memory store is compared, where a second object is unambiguously the mistake.
 */
export const IN_MEMORY: unique symbol = Symbol.for("worker-protocol.outcomes.in-memory");

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/**
 * ENDP-16. One recorded outcome, for as long as the Action declared.
 *
 * `until` is epoch milliseconds on the Worker's own clock. Nothing compares it against a caller's:
 * ENDP-16 is a promise the Worker makes about its own memory, and the caller only ever learns
 * whether it was kept by sending the request again.
 *
 * `task` is the `Worker-Protocol-Task` the call carried, kept for a header key alone: TASK-43 makes
 * the same key naming another Task a different request, and an input key is compared on the body
 * alone. A record written before it existed has none, and reads as a call that named no Task.
 */
export type Recorded = { body: string; answer: Answer; until: number; task?: string };

/**
 * A store in memory: right in one long-lived process, and wrong everywhere else.
 *
 * It is exported rather than defaulted so that choosing it is a line somebody wrote. A Worker in a
 * single Node or Bun process is the case it is right for, and that case is common enough to
 * deserve the helper and not common enough to deserve the default.
 */
export const memoryOutcomes = (): OutcomeStore => {
  /**
   * A reservation and a record are one row, told apart by whether an answer arrived.
   *
   * Both carry `until`, and a row past it is treated as absent — which is what gives a reservation
   * its expiry. In one process a crash takes the Map with it, so the expiry earns nothing here; it
   * is written anyway because this is the shape every other store is being asked to implement, and
   * one that quietly did less would be the wrong thing to copy.
   */
  const held = new Map<string, { until: number; answer?: Recorded }>();

  return {
    [IN_MEMORY]: true,
    begin: (key, until) => {
      const row = held.get(key);
      const live = row !== undefined && row.until > Date.now();
      if (live && row.answer !== undefined) return { held: row.answer };
      if (live) return "in-flight";
      // Nothing runs between the read and the write: a store on a real backend needs one operation
      // for this — a durable object method, an `insert … on conflict do nothing` — and this one
      // needs none, because JavaScript does not interleave here.
      held.set(key, { until });
      return "reserved";
    },
    complete: (key, record) => void held.set(key, { until: record.until, answer: record }),
    release: (key) => void held.delete(key),
  };
};

/** One POST to the Actions address, as `mount()` read it off the request. */
type Performance = {
  /** ACT-5: the Action named in the query. */
  name: string;
  /** The body, unread: ENDP-17 compares it byte for byte. */
  raw: string;
  /** The `Idempotency-Key` header, where one was sent. */
  key: string | undefined;
  /** REG-3: the credential presented. */
  token: string | undefined;
  /** Whom `authenticate` accepted, where it said. */
  principal: unknown;
  /** ENDP-34: the caller `authenticate` named, where it named one. */
  caller: string | undefined;
  /** TASK-39: the `Worker-Protocol-Task` header, unread, where one was sent. */
  task: string | undefined;
  /** GRANT-8: what the grant this credential was issued for covers, where it was issued for one. */
  coverage?: Coverage;
};

/** The `tasks` entry's declaration and facts, which a call naming a Task is checked against. */
type TasksDeclared = TaskFacts & { raises: TaskTypes };

/**
 * TASK-39's header, read: the Task's id, and the instant its condition began where the caller said.
 *
 * `t-81` or `t-81; since=2026-10-13T09:00:00Z`. A value that does not read as either is a parameter
 * that is malformed, which ENDP-40 answers `400 invalid_parameter` — refused rather than taken as
 * an id with a semicolon in it, because a caller that wrote `since` meant it to be compared.
 */
const readTaskHeader = (value: string): { id: string; since?: number } | undefined => {
  const [head, ...parameters] = value.split(";");
  const id = head?.trim() ?? "";
  if (id === "" || parameters.length > 1) return undefined;
  if (parameters.length === 0) return { id };
  const match = /^\s*since=(.+?)\s*$/.exec(parameters[0] ?? "");
  const since = match?.[1] === undefined ? Number.NaN : Date.parse(match[1]);
  return Number.isNaN(since) ? undefined : { id, since };
};

/**
 * TASK-39, TASK-40, TASK-41: the open Task a call names, or why it may not answer it.
 *
 * Asked only after the key has been taken (TASK-42), so a repeat is answered from the record
 * whatever became of its Task since — the consumer whose own answer closed it learns that it took
 * effect rather than being told `404`.
 */
async function answering(
  header: string,
  given: {
    name: string;
    tasks: TasksDeclared | undefined;
    accepts: ActionDeclarations;
    call: Omit<ActionCall, "name" | "task">;
    coverage: Coverage | undefined;
  },
): Promise<OpenTask | Refusal> {
  const named = readTaskHeader(header);
  if (named === undefined) {
    return refuse("invalid_parameter", "Worker-Protocol-Task is not a Task id, with `since`.");
  }
  const { name, tasks, accepts, call, coverage } = given;

  // TASK-39: not open is one answer, whatever the reason — no Task under that id, one this
  // credential does not cover (TASK-6), or not the occurrence `since` named. A Task has no state
  // once its condition stops holding, so there is no telling *ended* from *never was*, and a
  // refusal that told *not yours* from *not there* would say which ids are real (REG-32).
  // GRANT-8: a grant's credential covers Tasks by type, and `covers` may only narrow that.
  const covers = await tasks?.covers?.(call.token, call.principal);
  const task = (await tasks?.current())?.find((one) => one.id === named.id);
  const gone =
    task === undefined ||
    (coverage !== undefined && !listCovers(coverage.tasks, task.type)) ||
    (covers !== undefined && !covers.includes(task.id)) ||
    (named.since !== undefined && task.since.getTime() !== named.since);
  if (gone || tasks === undefined) {
    return refuse("not_found", `No open Task ${named.id} is answered here.`);
  }

  // TASK-40: an Action the type does not list. The caller re-reads the Descriptor and finds it,
  // which is TASK-8's case one surface over, and answered with TASK-8's code.
  const names = tasks.raises[task.type]?.answeredBy ?? [];
  if (!names.includes(name)) {
    return refuse("invalid_parameter", `${name} does not answer a Task of type ${task.type}.`);
  }

  // TASK-41: one the type lists and the Task does not offer now — derived exactly as a read
  // derives it, so a console never offered what this refuses.
  const available = await availableFor(task, { names, accepts, call });
  if (available !== undefined && !available.includes(name)) {
    return refuse("conflict", `${name} does not apply to Task ${task.id} now.`);
  }
  return task;
}

export function actions(facts: ActionFacts, tasks?: TasksDeclared) {
  // ENDP-16 needs somewhere to record, and `mount()` has refused to build a Worker that declares a
  // key without naming one — so by here it is either given or never asked for.
  const recorded = facts.outcomes;

  return async function perform({
    name,
    raw,
    key,
    token,
    principal,
    caller,
    task: header,
    coverage,
  }: Performance): Promise<Answer | Refusal> {
    // ACT-6: an Action the entry does not declare is a resource that does not exist.
    const declaration = facts.accepts[name];
    if (declaration === undefined) {
      return refuse("not_found", `No Action named ${name} is declared.`);
    }

    // ACT-22: an Action this credential does not cover. After ACT-6, because the Descriptor lists
    // every Action to everyone (REG-8); before the body, the key and the record, so a refused call
    // records nothing and is answered no outcome — not even one of its own.
    // GRANT-8: the grant bounds, and the Worker's own `covers` may only narrow inside it.
    const covered = within(coverage?.actions, await facts.covers?.(token, principal));
    if (covered !== undefined && !covered.includes(name)) {
      // REG-32 (recommended): nothing the status at this address did not already say — the caller
      // named the Action — and enough for an operator reading the refusal to know what is missing.
      return refuse("forbidden", "Not covered by this credential.");
    }

    // ENDP-4: the body is JSON. ENDP-18: a required key absent is `400`, and it is asked before
    // the body, because an Action that needs protecting must not be performed by the request that
    // forgot to ask for the protection.
    const idempotency = declaration.idempotency;
    if (idempotency?.required === true && idempotency.from === "header" && key === undefined) {
      return refuse("idempotency_key_required", "This Action requires an Idempotency-Key.");
    }

    const read = readJson(raw);
    if ("code" in read) return read;
    const { parsed } = read;

    // ACT-20: a `writeOnly` member the settings document omits keeps its current value. The form
    // a console renders from the reading address has none to post back (ACT-21), and replacing
    // would otherwise erase what nobody is allowed to read.
    if (name === "configure" && facts.settings !== undefined && isRecord(parsed)) {
      const hidden = writeOnlyMembers(declaration.input);
      const omitted = [...hidden].filter((member) => !(member in parsed));
      if (omitted.length > 0) {
        const current = await facts.settings();
        if (isRecord(current)) {
          for (const member of omitted) if (member in current) parsed[member] = current[member];
        }
      }
    }

    // ACT-8: an input that does not match the schema this Worker published. `400` and not `422`,
    // because ENDP-12 divides them at whether the Worker could READ it — and a caller fixes this
    // one by re-reading the Descriptor, which ENDP-37's headers already told it had moved.
    const input = declaration.input.safeParse(parsed);
    if (!input.success) return schemaMismatch(input.error);

    // ACT-19: a key read from a named member of the input, where the Action declares one. A
    // payload that already carries its own identity needs no second key beside it.
    const recordedKey =
      idempotency === undefined
        ? undefined
        : idempotency.from === "header"
          ? key
          : readMembers(input.data, idempotency.members);
    if (idempotency?.required === true && recordedKey === undefined) {
      return refuse("idempotency_key_required", "This Action requires an idempotency key.");
    }

    // ENDP-34, ENDP-35: a header key is the caller's and an input key is the Action's, so the
    // caller enters the reserved key for the first and never for the second. Without a named caller
    // every caller shares one scope, which is what a Worker that cannot tell them apart has.
    //
    // **A tuple, and not a separator.** An Action name is any non-empty string and an input key is
    // whatever the input carries, so any separator can be forged by one of the parts: `a:b` with
    // `c` meets `a` with `b:c`, and a raw key from a credential naming no caller would meet a scoped
    // one. JSON quotes each part, so nothing any of them contains can reach across into another.
    const scope = idempotency?.from === "header" ? (caller ?? null) : null;
    const now = Date.now();
    const keyed =
      recordedKey === undefined || recorded === undefined || idempotency === undefined
        ? undefined
        : { store: recorded, key: JSON.stringify([name, scope, recordedKey]), idempotency };

    // ENDP-16: the key is TAKEN before the Action runs, not read. Reading and then writing with
    // the Action in between is a check-then-act, and two callers under one key would both perform.
    if (keyed !== undefined) {
      const reservation = await keyed.store.begin(
        keyed.key,
        now + keyed.idempotency.windowSeconds * 1000,
      );
      if (reservation === "in-flight") {
        // ENDP-32: `retry` and not `reject`, which is the whole point. The caller backs off and
        // repeats under ENDP-30, and by then the first performance has recorded an outcome, so
        // ENDP-16 answers it. A `reject` would have told the caller to stop — and ENDP-28 would
        // have been right to make it, over a condition that resolves itself in a second.
        return refuse("unavailable", "This idempotency key is being performed right now.");
      }
      if (reservation !== "reserved") {
        // ENDP-17: a key reused with a different body is `409`, within the scope ENDP-34 and
        // ENDP-35 give it. Only the caller can tell a retry from a genuine repeat, and this is the
        // Worker declining to guess. TASK-43: a header key is the caller's statement about its own
        // attempts, so the same key naming another Task — or one where it named none — is another
        // request too; an input key is the fact itself, and a second Task it answers is no reason
        // to refuse it.
        const otherTask =
          keyed.idempotency.from === "header" &&
          (reservation.held.task ?? null) !== (header ?? null);
        if (reservation.held.body !== raw || otherTask) {
          return refuse(
            "idempotency_key_reused",
            otherTask
              ? "That key was used naming another Task."
              : "That key was used with another body.",
          );
        }
        // ENDP-16: within the window, a repeat is not a second performance. TASK-42: it is answered
        // before its Task is asked about, so a repeat whose Task has since closed still learns
        // what happened to it.
        return reservation.held.answer;
      }
    }

    const call: ActionCall = { name, token, idempotencyKey: recordedKey, principal, caller };
    let produced: unknown;
    try {
      // TASK-39, TASK-40, TASK-41: the Task the call names, asked after the key was taken (TASK-42)
      // and before anything is performed.
      if (header !== undefined) {
        const task = await answering(header, {
          name,
          tasks,
          accepts: facts.accepts,
          call,
          coverage,
        });
        if (isRefusal(task)) {
          if (keyed !== undefined) await keyed.store.release(keyed.key);
          return task;
        }
        call.task = task;
      }
      // ACT-17: the current state does not allow it. Asked here, after a repeat was answered from
      // its recorded outcome, so a performance that already happened is replayed and not refused.
      const refused = await declaration.refuses?.(input.data as never, call);
      produced =
        refused === undefined
          ? await declaration.run(input.data as never, call)
          : refuse("conflict", refused);
    } catch (thrown) {
      // The key is given back before the failure travels: a reservation held by a request that
      // threw would lock the Action out for the whole window over something that never happened.
      if (keyed !== undefined) await keyed.store.release(keyed.key);
      throw thrown;
    }
    if (isRefusal(produced)) {
      if (keyed !== undefined) await keyed.store.release(keyed.key);
      return produced;
    }

    // ACT-10, ACT-18: the status comes from what the Action DECLARED, so a caller knows which to
    // expect before it sends and a handler never picks one.
    // ACT-18: a `202` carries the result the Action declares, where it declares one — a job id,
    // say — and nothing where it declares none. The protocol invents no mechanism for following
    // the work; a body the Worker declared itself is not one.
    const answer: Answer =
      declaration.completesWithinCall === false
        ? { status: 202, body: declaration.result === undefined ? null : produced }
        : declaration.result === undefined
          ? { status: 204, body: null }
          : { status: 200, body: produced };

    if (keyed !== undefined) {
      await keyed.store.complete(keyed.key, {
        body: raw,
        answer,
        until: now + keyed.idempotency.windowSeconds * 1000,
        ...(keyed.idempotency.from === "header" && header !== undefined ? { task: header } : {}),
      });
    }
    return answer;
  };
}

const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && "code" in value && "message" in value;

/** ENDP-4: a body that does not parse is `malformed_request`, and nothing was read from it. */
export const readJson = (raw: string): { parsed: unknown } | Refusal => {
  try {
    return { parsed: JSON.parse(raw) };
  } catch {
    return refuse("malformed_request", "The body did not parse.");
  }
};

/** ACT-8, SUB-2: a body that parses and does not match its schema, naming where it first did not. */
export const schemaMismatch = (error: z.ZodError): Refusal => {
  const issue = error.issues[0];
  const where = issue?.path.join(".");
  return refuse(
    "schema_mismatch",
    `${where ? `\`${where}\`: ` : ""}${issue?.message ?? "The body does not match the schema."}`,
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * ENDP-38, ACT-19: the key the declared members make, in order, or `undefined` if one is absent.
 * One member is its value as a string, as before; several are their values as a JSON array, so no
 * value can run into the next.
 */
const readMembers = (input: unknown, members: string[]): string | undefined => {
  if (!isRecord(input)) return undefined;
  const values = members.map((member) => input[member]);
  if (values.some((value) => value === undefined)) return undefined;
  return values.length === 1 ? String(values[0]) : JSON.stringify(values);
};

/**
 * ACT-20, ACT-21: the members a schema marks `writeOnly`, read off its JSON Schema — once per schema
 * object, because a Worker answered per request hands over the same declaration every time, and
 * converting it on every read and every `configure` would be work done for nothing.
 */
const writeOnlyBySchema = new WeakMap<z.ZodType, Set<string>>();
export const writeOnlyMembers = (schema: z.ZodType): Set<string> => {
  const known = writeOnlyBySchema.get(schema);
  if (known !== undefined) return known;
  const properties = (jsonSchema(schema).properties ?? {}) as Record<
    string,
    { writeOnly?: boolean }
  >;
  const found = new Set(
    Object.entries(properties)
      .filter(([, property]) => property.writeOnly === true)
      .map(([name]) => name),
  );
  writeOnlyBySchema.set(schema, found);
  return found;
};

/**
 * ACT-2, ACT-3 — the JSON Schema the Descriptor carries, generated from the Zod object beside it.
 *
 * `io: "input"` is what makes a declaration with a default describe what a CALLER sends rather
 * than what the Worker ends up holding, which is the document ACT-2 says a console renders a form
 * from. The two differ exactly where a schema is most likely to have one.
 */
export const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;

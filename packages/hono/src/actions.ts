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
 * **Nothing here knows whether an Action is answering a Task.** It used to: a holder named its
 * Claim in a header and this refused a stale one before performing anything. The lease is
 * withdrawn, so a Response and any other performance are the same request, which `spec/tasks.md`
 * states rather than hides.
 */

import * as z from "zod";
import type { ErrorCode } from "./codes.ts";
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
  /** ACT-12, ENDP-15. Absent where the Action takes no key. */
  idempotency?:
    | { required: boolean; from: "header"; windowSeconds: number }
    | { required: boolean; from: "input"; member: string; windowSeconds: number };
  /**
   * What this Action does. The input has already been validated against `input` above.
   *
   * A `Refusal` of `unprocessable_content` is ACT-9: schema-valid, and refused on the Worker's own
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
};

export type ActionDeclarations = Record<string, Action>;

export type ActionFacts = {
  actions: ActionDeclarations;
  /** ACT-15. The document `configure` would accept, where the Worker accepts settings. */
  settings?: () => unknown | Promise<unknown>;
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
 * Where a Worker keeps what ENDP-16 promised, when a Map will not do.
 *
 * `put` carries the instant the record expires so that a store with its own time-to-live can use
 * it — a KV namespace, a durable object alarm — and one without may ignore it, because `get` is
 * asked to answer nothing for a record whose window has passed and `mount()` checks that anyway.
 */
export type OutcomeStore = {
  get: (key: string) => Recorded | undefined | Promise<Recorded | undefined>;
  put: (key: string, held: Recorded) => void | Promise<void>;
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
 */
export type Recorded = { body: string; answer: Answer; until: number };

/**
 * A store in memory: right in one long-lived process, and wrong everywhere else.
 *
 * It is exported rather than defaulted so that choosing it is a line somebody wrote. A Worker in a
 * single Node or Bun process is the case it is right for, and that case is common enough to
 * deserve the helper and not common enough to deserve the default.
 */
export const memoryOutcomes = (): OutcomeStore => {
  const held = new Map<string, Recorded>();
  return {
    [IN_MEMORY]: true,
    get: (key) => held.get(key),
    put: (key, record) => void held.set(key, record),
  };
};

export function actions(facts: ActionFacts) {
  // ENDP-16 needs somewhere to record, and `mount()` has refused to build a Worker that declares a
  // key without naming one — so by here it is either given or never asked for.
  const recorded = facts.outcomes;

  return async function perform(
    name: string,
    raw: string,
    key: string | undefined,
    token: string | undefined,
  ): Promise<Answer | Refusal> {
    // ACT-6: an Action the entry does not declare is a resource that does not exist.
    const declaration = facts.actions[name];
    if (declaration === undefined) {
      return refuse("not_found", `No Action named ${name} is declared.`);
    }

    // ENDP-4: the body is JSON. ENDP-18: a required key absent is `400`, and it is asked before
    // the body, because an Action that needs protecting must not be performed by the request that
    // forgot to ask for the protection.
    const idempotency = declaration.idempotency;
    if (idempotency?.required === true && idempotency.from === "header" && key === undefined) {
      return refuse("idempotency_key_required", "This Action requires an Idempotency-Key.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return refuse("malformed_request", "The body did not parse.");
    }

    // ACT-8: an input that does not match the schema this Worker published. `400` and not `422`,
    // because ENDP-12 divides them at whether the Worker could READ it — and a caller fixes this
    // one by re-reading the Descriptor, which ENDP-5's headers already told it had moved.
    const input = declaration.input.safeParse(parsed);
    if (!input.success) {
      const issue = input.error.issues[0];
      const where = issue?.path.join(".");
      return refuse(
        "schema_mismatch",
        `${where ? `\`${where}\`: ` : ""}${issue?.message ?? "The input does not match the schema."}`,
      );
    }

    // ACT-12: a key read from a named member of the input, where the Action declares one. A
    // payload that already carries its own identity needs no second key beside it.
    const recordedKey =
      idempotency === undefined
        ? undefined
        : idempotency.from === "header"
          ? key
          : readMember(input.data, idempotency.member);
    if (idempotency?.required === true && recordedKey === undefined) {
      return refuse("idempotency_key_required", "This Action requires an idempotency key.");
    }

    const now = Date.now();
    const held =
      recordedKey === undefined || recorded === undefined
        ? undefined
        : await recorded.get(`${name}:${recordedKey}`);
    if (held !== undefined && held.until > now) {
      // ENDP-17: a key reused with a different body is `409`. Only the caller can tell a retry
      // from a genuine repeat, and this is the Worker declining to guess.
      if (held.body !== raw) {
        return refuse("idempotency_key_reused", "That key was used with another body.");
      }
      // ENDP-16: within the window, a repeat is not a second performance.
      return held.answer;
    }

    const produced = await declaration.run(input.data as never, { name, token });
    if (isRefusal(produced)) return produced;

    // ACT-10, ACT-11: the status comes from what the Action DECLARED, so a caller knows which to
    // expect before it sends and a handler never picks one.
    const answer: Answer =
      declaration.completesWithinCall === false
        ? { status: 202, body: null }
        : declaration.result === undefined
          ? { status: 204, body: null }
          : { status: 200, body: produced };

    if (recordedKey !== undefined && idempotency !== undefined && recorded !== undefined) {
      await recorded.put(`${name}:${recordedKey}`, {
        body: raw,
        answer,
        until: now + idempotency.windowSeconds * 1000,
      });
    }
    return answer;
  };
}

const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && "code" in value && "message" in value;

const readMember = (input: unknown, member: string): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[member];
  return value === undefined ? undefined : String(value);
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

/**
 * The `actions` surface: the call, and everything the protocol fixes about one.
 *
 * A Worker knows what an Action DOES. Everything else on the way in is a rule — the name that is
 * not declared, the body that will not parse, the input that does not match the schema the Worker
 * published, the required idempotency key that is absent, the repeat under a key already recorded,
 * the key reused with another body, the Claim an answering Action must name (TASK-20, TASK-21).
 *
 * The input is declared as a Zod object and used twice: `mount()` generates the JSON Schema the
 * Descriptor carries from it, and this validates against the same object. ACT-2 requires that a
 * console can render a form from the declaration without being told anything else, and a Worker
 * that wrote the schema by hand and the validation by hand had two places to disagree.
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
  /** TASK-20. The Claim this Action answers a Task under, where one was named. */
  claim: string | undefined;
};

export type ActionDeclarations = Record<string, Action>;

export type ActionFacts = {
  actions: ActionDeclarations;
  /** ACT-15. The document `configure` would accept, where the Worker accepts settings. */
  settings?: () => unknown | Promise<unknown>;
};

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });

/**
 * ENDP-16. One recorded outcome, for as long as the Action declared.
 *
 * It is handed in rather than held here, because `mount()` may answer a different `Worker` object
 * on every request — which is what a Cloudflare, Vercel or Deno runtime forces — and a window that
 * started again with each one would forget before it said it would.
 */
export type Recorded = { body: string; answer: Answer; until: number };

export function actions(
  facts: ActionFacts,
  allows: (claim: string, action: string) => Promise<boolean>,
  recorded: Map<string, Recorded>,
) {
  return async function perform(
    name: string,
    raw: string,
    key: string | undefined,
    claim: string | undefined,
    token: string | undefined,
  ): Promise<Answer | Refusal> {
    // ACT-6: an Action the entry does not declare is a resource that does not exist.
    const declaration = facts.actions[name];
    if (declaration === undefined) {
      return refuse("not_found", `No Action named ${name} is declared.`);
    }

    // TASK-21: refused BEFORE anything is performed where the Claim is not its Task's current one
    // or where its Task's type never listed this Action. Ahead of the idempotency lookup on
    // purpose: a stale Claim is a fact about THIS call, and a recorded outcome is not an answer.
    if (claim !== undefined && !(await allows(claim, name))) {
      return refuse("conflict", "That Claim is not current for this Action.");
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
    const held = recordedKey === undefined ? undefined : recorded.get(`${name}:${recordedKey}`);
    if (held !== undefined && held.until > now) {
      // ENDP-17: a key reused with a different body is `409`. Only the caller can tell a retry
      // from a genuine repeat, and this is the Worker declining to guess.
      if (held.body !== raw) {
        return refuse("idempotency_key_reused", "That key was used with another body.");
      }
      // ENDP-16: within the window, a repeat is not a second performance.
      return held.answer;
    }

    const produced = await declaration.run(input.data as never, { name, token, claim });
    if (isRefusal(produced)) return produced;

    // ACT-10, ACT-11: the status comes from what the Action DECLARED, so a caller knows which to
    // expect before it sends and a handler never picks one.
    const answer: Answer =
      declaration.completesWithinCall === false
        ? { status: 202, body: null }
        : declaration.result === undefined
          ? { status: 204, body: null }
          : { status: 200, body: produced };

    if (recordedKey !== undefined && idempotency !== undefined) {
      recorded.set(`${name}:${recordedKey}`, {
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

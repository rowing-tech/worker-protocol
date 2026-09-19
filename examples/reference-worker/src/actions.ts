/**
 * The `actions` Capability, arranged to be checked.
 *
 * Four Actions, and each is here because a rule needs one of its shape: one that is safe to
 * perform, one that refuses a schema-valid input on its own rules, one that does not complete
 * within the call, and `configure`. A Worker built for use would declare what its operators need;
 * this one declares what `conformance/verifiability.md` says nothing can otherwise observe.
 */

import type { Answer, Refusal } from "@worker-protocol/hono";
import type { actionDeclaration } from "@worker-protocol/schemas";
import type * as z from "zod";

/** ACT-14: the Worker's complete settings document. A performance replaces what it holds. */
export type Settings = { label: string; pollSeconds: number };

const INITIAL: Settings = { label: "reference", pollSeconds: 60 };

const settingsSchema = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1 },
    pollSeconds: { type: "integer", minimum: 1 },
  },
  required: ["label", "pollSeconds"],
  additionalProperties: false,
} as const;

/** ACT-1 through ACT-4, ACT-12 and ACT-15 — what the Descriptor declares about each Action. */
export const DECLARATIONS: Record<string, z.infer<typeof actionDeclaration>> = {
  // ACT-13: the one Action name this edition reserves, and ACT-15 the reading address without
  // which a console renders an empty form and an operator replaces what they did not remember.
  configure: {
    input: settingsSchema,
    completesWithinCall: true,
    readAddress: "../settings",
  },
  "record-verification": {
    input: {
      type: "object",
      properties: { vehicle: { type: "string", minLength: 1 }, verified: { type: "boolean" } },
      required: ["vehicle", "verified"],
      additionalProperties: false,
    },
    result: {
      type: "object",
      properties: { recordedAt: { type: "string" } },
      required: ["recordedAt"],
      additionalProperties: false,
    },
    completesWithinCall: true,
    // ENDP-15, ACT-12. A key in the header is opaque and the Worker records it without parsing it,
    // which is the case a caller reaches for when its payload carries no identity of its own.
    idempotency: { required: true, from: "header", windowSeconds: 3600 },
  },
  "price-quote": {
    input: {
      type: "object",
      properties: { amount: { type: "number" } },
      required: ["amount"],
      additionalProperties: false,
    },
    result: {
      type: "object",
      properties: { quote: { type: "number" } },
      required: ["quote"],
      additionalProperties: false,
    },
    completesWithinCall: true,
  },
  "rebuild-index": {
    input: { type: "object", properties: {}, additionalProperties: false },
    // ACT-11: it declares that it does not finish here, so a caller knows before it sends that it
    // will not learn the outcome from the answer.
    completesWithinCall: false,
  },
};

/**
 * What the Actions reach into: the Tasks, because an Action is how a Response lands (TASK-16) and
 * the one Facts this Worker derives a Task from. `verify` changes those Facts; `allows` is
 * TASK-21's precondition, answered by whoever holds the Claims.
 */
export type Facts = {
  verify: (vehicle: string) => void;
  allows: (claim: string, action: string) => boolean;
};

/**
 * The state this Worker holds, so that `configure` has something to replace and a reading address
 * has something to answer. It is per-instance, which is what lets a test start a fresh one.
 */
export function createActions(facts: Facts) {
  let settings: Settings = { ...INITIAL };
  /** ENDP-16: the outcome recorded against a key, for as long as the declared window. */
  const recorded = new Map<string, { body: string; answer: Answer }>();

  const reject = (code: Refusal["code"], message: string): Refusal => ({ code, message });

  return {
    settings: () => settings,

    /** ACT-5 through ACT-11, TASK-21 — one performance. */
    perform(
      name: string,
      raw: string,
      key: string | undefined,
      claim: string | undefined,
    ): Refusal | Answer {
      // ACT-7, a request naming no Action, never reaches here: `mount()` refuses it on the route's
      // own declaration, which is what declaring the surface as routes buys.

      // ACT-6: an Action the entry does not declare is a resource that does not exist.
      const declaration = DECLARATIONS[name];
      if (declaration === undefined) {
        return reject("not_found", `No Action named ${name} is declared.`);
      }

      // TASK-21: an Action performed under a Claim is refused before anything else happens where
      // that Claim is not its Task's current one, or where its Task's type never listed this
      // Action. It sits ahead of the idempotency lookup on purpose: a stale Claim is a fact about
      // THIS call, and a recorded outcome is not an answer to it.
      if (claim !== undefined && !facts.allows(claim, name)) {
        return reject("conflict", "That Claim is not current for this Action.");
      }

      // ENDP-18: a required key that is absent is `400`. Checked before the body, because an
      // Action that needs protecting must not be performed by the request that forgot to ask for
      // it — which is the whole of what the guarantee is worth.
      const wantsKey = declaration.idempotency !== undefined;
      if (wantsKey && key === undefined) {
        return reject("idempotency_key_required", "This Action requires an Idempotency-Key.");
      }

      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        return reject("malformed_request", "The body did not parse.");
      }

      // ACT-8: an input that does not match the Action's declared schema. This Worker validates
      // only as far as the shapes it declared need, which is enough to be checked and is not a
      // JSON Schema implementation — nothing in this protocol asks a Worker to be one.
      const fault = mismatch(name, input);
      if (fault !== null) return reject("schema_mismatch", fault);

      if (wantsKey && key !== undefined) {
        const held = recorded.get(key);
        // ENDP-17: a key reused with a different body is `409`. ENDP-16: within the window, a
        // repeat under the same key is not a second performance — the recorded outcome comes back.
        if (held !== undefined) {
          if (held.body !== raw) {
            return reject("idempotency_key_reused", "That key was used with another body.");
          }
          return held.answer;
        }
      }

      const answer = run(name, input, {
        read: () => settings,
        write: (next) => {
          settings = next;
        },
        verify: facts.verify,
      });

      if (wantsKey && key !== undefined && !("code" in answer)) {
        recorded.set(key, { body: raw, answer: answer as Answer });
      }
      return answer;
    },
  };
}

/** Only as much validation as the declared shapes need. Returns why, or null. */
function mismatch(name: string, input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return "The input is not an object.";
  }
  const body = input as Record<string, unknown>;

  if (name === "configure") {
    if (typeof body.label !== "string" || body.label.length === 0) return "`label` is missing.";
    if (!Number.isInteger(body.pollSeconds)) return "`pollSeconds` is missing.";
    return null;
  }
  if (name === "record-verification") {
    if (typeof body.vehicle !== "string" || body.vehicle.length === 0) {
      return "`vehicle` is missing.";
    }
    if (typeof body.verified !== "boolean") return "`verified` is missing.";
    return null;
  }
  if (name === "price-quote") {
    if (typeof body.amount !== "number") return "`amount` is missing.";
    return null;
  }
  return null;
}

function run(
  name: string,
  input: unknown,
  state: {
    read: () => Settings;
    write: (next: Settings) => void;
    verify: (vehicle: string) => void;
  },
): Refusal | Answer {
  const body = input as Record<string, unknown>;

  if (name === "configure") {
    // ACT-14: the input is the complete settings document and this replaces what is held.
    state.write({ label: body.label as string, pollSeconds: body.pollSeconds as number });
    // ACT-10: `204` where the Action declares no result.
    return { status: 204, body: null };
  }

  if (name === "record-verification") {
    // A verification is now on record for this vehicle, whatever it found. The Task that asked
    // for one closes by condition (TASK-15) — the Action changed a Fact, and the Task followed.
    state.verify(body.vehicle as string);
    return { status: 200, body: { recordedAt: new Date().toISOString() } };
  }

  if (name === "price-quote") {
    // ACT-9: schema-valid, and refused on this Worker's own rules. ENDP-12's second half, and the
    // one case a verifier cannot provoke without a Worker built to offer it.
    if ((body.amount as number) <= 0) {
      return { code: "unprocessable_content", message: "An amount is positive." };
    }
    return { status: 200, body: { quote: (body.amount as number) * 1.21 } };
  }

  // ACT-11: it declared that it does not complete within the call, so `202` and no body.
  void state.read;
  return { status: 202, body: null };
}

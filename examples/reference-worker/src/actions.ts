/**
 * The `actions` Capability, arranged to be checked.
 *
 * Four Actions, and each is here because a rule needs one of its shape: one that is safe to
 * perform, one that refuses a schema-valid input on its own rules (ACT-9), one that does not
 * complete within the call (ACT-11), and `configure`. A Worker built for use would declare what
 * its operators need; this one declares what `conformance/verifiability.md` says nothing can
 * otherwise observe.
 *
 * The inputs are Zod objects and are used twice: `mount()` generates the JSON Schema the Descriptor
 * carries from them, and validates each request against the same object. The hand-written
 * validator this file used to hold is gone with it, and with it the second place to disagree.
 */

import { type ActionDeclarations, memoryOutcomes, type Refusal } from "@worker-protocol/hono";
import * as z from "zod";

/** ACT-14: the Worker's complete settings document. A performance replaces what it holds. */
const settingsSchema = z.object({
  label: z.string().min(1),
  pollSeconds: z.number().int().min(1),
});

export type Settings = z.infer<typeof settingsSchema>;

export function createActions(verify: (vehicle: string) => void) {
  let settings: Settings = { label: "reference", pollSeconds: 60 };

  const actions: ActionDeclarations = {
    // ACT-13: the one Action name this edition reserves, and ACT-15 the reading address without
    // which a console renders an empty form and an operator replaces what they did not remember.
    configure: {
      input: settingsSchema,
      run: (next: Settings) => {
        // ACT-14: the input is the complete settings document and this replaces what is held.
        settings = next;
      },
    },
    "record-verification": {
      input: z.object({ vehicle: z.string().min(1), verified: z.boolean() }),
      result: z.object({ recordedAt: z.string() }),
      // ENDP-15, ACT-12: a key in the header is opaque and the Worker records it without parsing
      // it, which is what a caller reaches for when its payload carries no identity of its own.
      idempotency: { required: true, from: "header", windowSeconds: 3600 },
      run: ({ vehicle }: { vehicle: string }) => {
        // A verification is now on record for this vehicle, whatever it found. The Task that asked
        // for one closes by condition (TASK-15): the Action changed a Fact, and the Task followed.
        verify(vehicle);
        return { recordedAt: new Date().toISOString() };
      },
    },
    "price-quote": {
      input: z.object({ amount: z.number() }),
      result: z.object({ quote: z.number() }),
      run: ({ amount }: { amount: number }): { quote: number } | Refusal =>
        // ACT-9: schema-valid, and refused on this Worker's own rules. ENDP-12's second half, and
        // the one case a verifier cannot provoke without a Worker built to offer it.
        amount <= 0
          ? { code: "unprocessable_content", message: "An amount is positive." }
          : { quote: amount * 1.21 },
    },
    "rebuild-index": {
      input: z.object({}),
      // ACT-11: it declares that it does not finish here, so a caller knows before it sends that
      // it will not learn the outcome from the answer, and `mount()` answers `202`.
      completesWithinCall: false,
      run: () => undefined,
    },
  };

  // ENDP-16: one process here, so a Map is the right store and saying so is one line.
  return { actions, settings: () => settings, outcomes: memoryOutcomes() };
}

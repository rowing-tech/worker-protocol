import * as z from "zod";

/**
 * The Zod objects that generate `schemas/`.
 *
 * Nothing here carries behaviour of its own. Every constraint below encodes a rule that
 * `spec/` already states, and each one cites the rule id it encodes so that a conformance
 * report can name the rule rather than the file. Where `spec/` has not decided something, the
 * object here is deliberately permissive and says so — a schema that overstates is worse than
 * one that admits a hole, because the schema is the normative artifact and prose defers to it.
 */

/**
 * The base every schema's `$id` is built on — and NO HOME HAS BEEN CHOSEN.
 *
 * `null` means each `$id` is the bare file name, which identifies a schema within this set and
 * commits the project to no domain. That is the honest state today: nothing is published, no
 * version is tagged, and there are no external consumers.
 *
 * A `$id` identifies; it does not have to resolve. Validation works whether or not anything is
 * ever served at it, and relative `$ref`s between these schemas resolve against the document's
 * own location exactly as they would against an absolute base.
 *
 * When a home is chosen, set this to something of the shape
 * `https://<host>/worker-protocol/schemas` — namespaced under a path rather than hung off a
 * domain root, so that a later move changes one segment and not the shape of every identifier.
 * That is the only edit required: the host would then appear in each generated file on its own
 * `$id` line and nowhere else, because every cross-schema `$ref` stays relative.
 */
export const SCHEMA_ID_BASE: string | null = null;

/** The `$id` of one generated schema. A registry id is also its file name, plus `.json`. */
export const schemaId = (name: string): string =>
  SCHEMA_ID_BASE === null ? `${name}.json` : `${SCHEMA_ID_BASE}/${name}.json`;

/**
 * The registry the generator walks. A registry id becomes three things: the generated file name,
 * the `$ref` other schemas point at — relative, so `capability-entry.json` and not a URL — and,
 * once rewritten through `schemaId`, that file's own absolute `$id`.
 */
export const registry = z.registry<{ id: string }>();

/**
 * DESC-8 — the closed enumeration of Capability names this edition defines. Normative, and the
 * list a verifier checks an undotted name against. `spec/README.md`'s table is a reading aid.
 */
export const capabilityName = z
  .enum(["health", "indicators", "actions", "alerts", "tasks", "events"])
  .meta({
    title: "Capability name",
    description:
      "DESC-8. The Capability names the current edition of worker-protocol defines.",
  });

/**
 * DESC-14 — a name containing a `.` is the Worker's own and is never defined by this
 * specification. The pattern asserts only what DESC-14 asserts: at least one dot, and no dot at
 * either end. naming.md answers the rest of the syntax by adding nothing to it: nobody compares one
 * Worker's vendor Capability against another's, so there is no collision for a longer name to
 * prevent.
 */
export const vendorCapabilityName = z
  .string()
  .regex(/^[^.\s]+(?:\.[^.\s]+)+$/)
  .meta({
    title: "Vendor Capability name",
    description:
      "DESC-14. A Capability a Worker defines itself. Contains a dot, which is what makes it " +
      "disjoint from the reserved names of DESC-8. The dot is the whole of the syntax: naming.md " +
      "requires nothing further, because no reader ever compares one Worker's vendor Capability " +
      "against another's. NAME-1 fixes how any two names are compared.",
  });

/**
 * NAME-7 — a name this protocol expects one party to match against a name that came from somewhere
 * else: a Task type, a Skill, an event type.
 *
 * The pattern is at least three dot-separated labels — two or more for the DNS name in reverse
 * label order, one or more for the local part — each a DNS label of lowercase letters, digits and
 * hyphens, never starting or ending with a hyphen.
 *
 * Lowercase is asserted rather than left to taste, and it is the one part of this that is load-
 * bearing rather than conventional. DNS is case-insensitive, so `Example.com` and `example.com`
 * are one domain; NAME-1 compares names byte for byte, so `com.Example.x` and `com.example.x`
 * would be two names for one thing. One spelling closes a trap the two rules open between them.
 *
 * NAME-8 — that the domain is one the minting team controls — has no schema witness and cannot
 * have one. Nothing verifies domain ownership, which is why it recommends rather than binds.
 */
export const qualifiedName = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/)
  .meta({
    title: "Qualified name",
    description:
      "NAME-7. A name matched across Workers: a DNS name the minting team controls, in reverse " +
      "label order, followed by a local part — `tech.rowing.fleet.verify-vehicle`. At least three " +
      "labels, lowercase. NAME-8 asks that the domain be one you control and no schema can check " +
      "it. This does NOT apply to a name read only inside the Descriptor that declared it: a " +
      "vendor Capability (DESC-14), an Action, an indicator.",
  });

/**
 * DESC-12 — an address is an absolute `https` URL, or a relative reference resolved against the
 * URL the Descriptor was read from.
 *
 * The pattern is the load-bearing part: `format` is an annotation in Draft 2020-12 unless a
 * validator opts into format-assertion, so a schema that relied on `format: "uri-reference"`
 * alone would assert nothing. This admits a string that either begins `https://` or carries no
 * scheme at all, which is exactly the two cases DESC-12 names.
 */
export const address = z
  .string()
  .regex(/^(?:https:\/\/|(?![A-Za-z][A-Za-z0-9+.-]*:))\S*$/)
  .meta({
    title: "Address",
    format: "uri-reference",
    description:
      "DESC-12. An absolute https URL, or a relative reference resolved against the Descriptor's " +
      "own URL. DESC-13 governs whether a credential may be sent to one that is off-origin.",
  });

/**
 * DESC-22 — what a Worker declares about one Capability it implements.
 *
 * Loose on purpose. descriptor.md commits each Capability's own file to extending this entry
 * with what its surface needs — the Actions a Worker accepts, the broker it publishes to — and
 * none of those files is written. Closing this object would forbid the extension the
 * specification promises. The cost is real and is reported: until each Capability file defines
 * its extension, a typo in an entry validates.
 */
export const capabilityEntry = z
  .looseObject({
    version: z
      .number()
      .int()
      .min(1)
      .meta({
        description:
          "DESC-9. A single integer counting breaking changes to this Capability alone. " +
          "There is no minor version.",
      }),
    address: address.optional(),
  })
  .meta({
    title: "Capability entry",
    description:
      "DESC-22. What a Worker declares about one Capability: its version, and the address it " +
      "answers at where it answers over HTTP. The Capability's name is the key this entry is held " +
      "under, which is what makes it declarable at most once. The address is optional HERE ONLY: " +
      "each Capability's own file requires one, and every Capability answered over HTTP does — " +
      "`events`, answered over a broker, is why the shared entry cannot require it. Open to the " +
      "extensions each Capability's own file defines, including the conditional declarations of " +
      "DESC-11.",
  });

/**
 * DESC-1, DESC-2, DESC-6, DESC-23, DESC-22 — the document every Worker serves.
 *
 * Closed on purpose: the rules above enumerate what a Descriptor carries, and a new top-level
 * member is what an edition is for (DESC-23). A Worker extends its entries, not its Descriptor.
 *
 * `strictObject`, not `object`, so that the Zod objects other packages consume and the JSON
 * Schema generated from them agree about the same document. Zod's default object STRIPS an
 * unknown key while the generated `additionalProperties: false` REJECTS it — a TypeScript
 * consumer and a Python one would otherwise reach opposite verdicts on one Descriptor.
 */
export const descriptor = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .meta({
        description:
          "DESC-6. The Worker's own id: opaque, stable, not the URL and not derived from it, " +
          "and unambiguous without ambient context. NAME-9 requires only that no two Workers " +
          "share one, which a namespaced name and a random identifier satisfy equally — so no " +
          "pattern is asserted here on purpose. A schema can assert that it is a non-empty " +
          "string and no more; the rest of DESC-6 and NAME-9 have no schema witness.",
      }),
    edition: z
      .string()
      .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/)
      .meta({
        description:
          "DESC-23. The edition of worker-protocol this Worker speaks, written MAJOR.MINOR. " +
          "Editions are ordered by comparing MAJOR and then MINOR as numbers, which is the " +
          "ordering DESC-25 spends when a verifier reports itself older than a Worker. DESC-24 " +
          "gives the two components their meaning: MAJOR is what a reader cannot survive not " +
          "knowing, MINOR is what an older reader may ignore and still be correct. Leading " +
          "zeros are refused so that one edition has one spelling and string equality agrees " +
          "with numeric comparison.",
      }),
    capabilities: z
      .record(z.union([capabilityName, vendorCapabilityName]), capabilityEntry)
      .meta({
        description:
          "DESC-2. Any combination, including none. Keyed by Capability name, which is what " +
          "makes a Capability declared at most once — the question descriptor.md leaves open.",
      }),
  })
  .meta({
    title: "Descriptor",
    description:
      "DESC-1. The document a Worker serves at the route DESC-3 fixes, and the whole of what " +
      "every Worker owes.",
  });

/**
 * ENDP-25, ENDP-26 — the envelope every response that is not a success carries.
 *
 * Loose on purpose, and for a stated reason: endpoints.md records as open whether the envelope
 * carries structured detail beyond these three. Closing it would answer that question by
 * accident, in the artifact prose defers to.
 */
/**
 * ENDP-25 — the closed code enumeration, split by the class each code carries.
 *
 * Every code names a condition some rule in `spec/` already states; none was invented to fill a
 * gap. endpoints.md holds the other half of ENDP-26 — which status each code is answered with —
 * because a status code is not in the body and no schema can assert it.
 */
export const rejectCodes = [
  "malformed_request",
  "invalid_parameter",
  "unknown_filter",
  "unsupported_version",
  "idempotency_key_required",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "idempotency_key_reused",
  "unprocessable_content",
] as const;

export const retryCodes = [
  "request_timeout",
  "rate_limited",
  "internal_error",
  "unavailable",
  "upstream_error",
  "upstream_timeout",
] as const;

const message = z.string().meta({
  description: "ENDP-25. A human-readable message. Not addressed to a program.",
});

/**
 * ENDP-25, ENDP-26 — the envelope every response that is not a success carries.
 *
 * A union of two branches rather than one object with two independent fields, because ENDP-26
 * says a code carries its class. Written as one object, `not_found` with a class of `retry` would
 * validate cleanly and defeat the thing the class exists for. Written this way, the constraint
 * holds in the Zod object and in the generated JSON alike, with no rule stated in only one of
 * them.
 *
 * Each branch is loose: endpoints.md records as open whether the envelope carries structured
 * detail beyond these three, and closing it here would answer that question by accident, in the
 * artifact prose defers to.
 */
export const error = z
  .union([
    z.looseObject({
      code: z.enum(rejectCodes).meta({
        description:
          "ENDP-25. A code naming a condition this request will meet again (ENDP-28). " +
          "endpoints.md gives the status each is answered with.",
      }),
      message,
      class: z.literal("reject").meta({
        description: "ENDP-26. Carried by the code, not chosen beside it.",
      }),
    }),
    z.looseObject({
      code: z.enum(retryCodes).meta({
        description:
          "ENDP-25. A code naming a condition that may have passed by the time the request is " +
          "sent again (ENDP-30). endpoints.md gives the status each is answered with.",
      }),
      message,
      class: z.literal("retry").meta({
        description: "ENDP-26. Carried by the code, not chosen beside it.",
      }),
    }),
  ])
  .meta({
    title: "Error",
    description:
      "ENDP-25. The error envelope shared by every surface. The code is drawn from a closed " +
      "enumeration, so a new code requires a new edition — the price of a vocabulary a " +
      "conformance check can actually verify. ENDP-27 decides whether the code or the status " +
      "wins when they disagree.",
  });

/**
 * ENDP-20, ENDP-21 — the envelope every surface that answers a list answers it in.
 *
 * Closed, unlike the error envelope, because ENDP-20 enumerates the envelope exhaustively and
 * no open question asks for more. A surface that needs a third member is asking for a change to
 * ENDP-20, which is a thing the register can see.
 */
export const page = z
  .strictObject({
    items: z.array(z.unknown()).meta({
      description:
        "ENDP-20. The page. The shared envelope cannot type its items — each surface's own " +
        "schema narrows them.",
    }),
    nextCursor: z
      .string()
      .min(1)
      .optional()
      .meta({
        description:
          "ENDP-21. Opaque to the caller, produced only by the Worker, never constructed. A " +
          "string because a caller sends it back as a request parameter. ENDP-20: absent at the " +
          "end of the collection — absent, not null.",
      }),
  })
  .meta({
    title: "Page",
    description: "ENDP-20. The page envelope shared by every collection surface.",
  });

registry.add(capabilityName, { id: "capability-name" });
registry.add(qualifiedName, { id: "qualified-name" });
registry.add(capabilityEntry, { id: "capability-entry" });
registry.add(descriptor, { id: "descriptor" });
registry.add(error, { id: "error" });
registry.add(page, { id: "page" });

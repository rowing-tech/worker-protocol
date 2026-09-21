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
 * commits the project to no domain. Edition 0.1 is published and these packages are at 0.1.0, so
 * the old justification — that nothing was published — has expired; the choice stands on what is
 * left of it, which is that no home has been chosen and nothing consumes these by URL.
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

/**
 * DESC-23 — the edition of worker-protocol these schemas encode.
 *
 * It is not this package's version and cannot be read off it. A package version is SemVer and
 * describes the package; an edition is `MAJOR.MINOR` and describes the protocol, and the two move
 * for different reasons — a Zod major, a type made more precise, a build fixed, none of which is a
 * change to anything a Worker sends. `packages/README.md` carries that argument, including why the
 * two numbers agreeing today is a coincidence rather than a rule.
 */
export const EDITION = "0.1";

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
  .enum(["health", "metrics", "actions", "alerts", "activity", "tasks", "events"])
  .meta({
    title: "Capability name",
    description: "DESC-8. The Capability names the current edition of worker-protocol defines.",
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
      "vendor Capability (DESC-14), an Action, a metric.",
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
 * Loose on purpose, and the reason has changed since it was written. All six Capability files now
 * define their extension — `healthEntry`, `metricsEntry`, `actionsEntry`, `alertsEntry`,
 * `tasksEntry`, `eventsEntry` — so this is no longer holding a door open for something unwritten.
 * What keeps it loose is that `descriptor.json` still holds its entries as a record of THIS shape
 * rather than binding each reserved name to its own, so closing it here would refuse every
 * conformant Descriptor. Tightening that is a breaking change to the normative artifact and is
 * listed in descriptor.md as the next edition's.
 */
export const capabilityEntry = z
  .looseObject({
    version: z
      .number()
      .int()
      .min(1)
      .meta({
        description:
          "DESC-9. A single integer; there is no minor version. DESC-29 makes it count breaking " +
          "changes to this Capability's own surface alone.",
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
 * HLTH-2 — the three values a health status takes, and the only three.
 *
 * `degraded` is the one that earns its place: `healthy` and `unhealthy` alone would force a Worker
 * that works with one dependency down to lie in one direction or the other.
 */
export const healthStatus = z.enum(["healthy", "degraded", "unhealthy"]).meta({
  title: "Health status",
  description: "HLTH-2. The three values, for the whole Worker and for one named check alike.",
});

/**
 * HLTH-2 — one named check.
 *
 * Loose on purpose: health.md records as open what a check carries beyond its status and detail —
 * an observed value, a unit, a threshold — and closing this would answer that by accident.
 */
export const healthCheck = z
  .looseObject({
    status: healthStatus,
    detail: z
      .string()
      .optional()
      .meta({
        description:
          "HLTH-2. Short, human-readable, addressed to whoever is looking. Not addressed to a " +
          "program: nothing in this protocol parses it.",
      }),
  })
  .meta({
    title: "Health check",
    description: "HLTH-2. One dependency or invariant a Worker reports on, under its own name.",
  });

/**
 * HLTH-2 — the whole answer.
 *
 * Closed, unlike a check: HLTH-2 enumerates the envelope exhaustively and no open question asks
 * for a third member. The check object inside is where the open question lives.
 *
 * `checks` is required and may be empty. A Worker with no dependency worth reporting answers `{}`
 * rather than omitting the member, so that every reader parses one shape.
 */
export const health = z
  .strictObject({
    status: healthStatus.meta({
      description:
        "HLTH-2. The Worker's own summary. HLTH-3 forbids `healthy` while any check it reports " +
        "is not passing.",
    }),
    checks: z.record(z.string(), healthCheck).meta({
      description:
        "HLTH-2. Keyed by check name. Whether check names are shared across Workers is open, " +
        "which is why the key carries no pattern; if they come to be shared they become a name " +
        "that crosses between Workers and NAME-7 reaches them.",
    }),
  })
  .meta({
    title: "Health",
    description: "HLTH-2. What a Worker answers at the address its `health` entry declares.",
  });

/**
 * HLTH-1 — the `health` Capability entry, which requires the address the shared entry leaves
 * optional. This is the extension DESC-22 promises each Capability's own file will define, and it
 * is the first one.
 */
export const healthEntry = capabilityEntry.extend({ address }).meta({
  title: "Health capability entry",
  description:
    "HLTH-1. The shared Capability entry with the address required, because `health` is " +
    "answered over HTTP. DESC-22 makes the address optional in the shared entry only so that " +
    "`events`, answered over a broker, can be declared at all.",
});

/**
 * DESC-1, DESC-2, DESC-6, DESC-22, DESC-23 — the document every Worker serves.
 *
 * Closed on purpose: the rules above enumerate what a Descriptor carries, and a new top-level
 * member is what an edition is for (DESC-23). A Worker extends its entries, not its Descriptor.
 *
 * `strictObject`, not `object`, so that the Zod objects other packages consume and the JSON
 * Schema generated from them agree about the same document. Zod's default object STRIPS an
 * unknown key while the generated `additionalProperties: false` REJECTS it — a TypeScript
 * consumer and a Python one would otherwise reach opposite verdicts on one Descriptor.
 */
/**
 * TASK-31 — what a Worker declares about one Skill, which today is nothing.
 *
 * Empty and strict on purpose. A Skill carries no declaration yet, and the shape for *nothing yet*
 * is the one an optional member can join without invalidating a document already written — which
 * NAME-5 calls compatible. A list of names could only have grown by becoming this, and becoming
 * this later would have cost every Worker that declared a Skill a rewrite.
 */
export const skillDeclaration = z
  .strictObject({
    payload: z
      .looseObject({})
      .optional()
      .meta({
        description:
          "TASK-31. The JSON Schema of the payload this Worker REQUIRES in order to answer a Task " +
          "of this type — its own requirement, and not a copy of what any owner sends. NAME-6 " +
          "judges the two in the direction the document travels: a Tower validates the Tasks an " +
          "owner actually raises against this, and knows before any work is handed over whether " +
          "this Worker can read it. May ask for less than an owner sends; a Tower that finds it " +
          "asking for more has its answer. OPTIONAL: a Skill that states no requirement claims " +
          "the capability and nothing about what it needs, which is conformant and is where this " +
          "protocol stood before the field existed. What it costs is the check.",
      }),
    produces: z
      .looseObject({})
      .optional()
      .meta({
        description:
          "TASK-31. The JSON Schema of what this Worker PRODUCES in answer to a Task of this type " +
          "— its own capability, and not a copy of any owner's Action. NAME-6 judges it against " +
          "the input of the Action that answers the type at each owner: a Tower knows before any " +
          "work is handed over whether this Worker can produce what that owner takes, and two " +
          "owners asking for the same fact under different names are, correctly, two different " +
          "answers. OPTIONAL, on the same terms as `payload`.",
      }),
  })
  .meta({
    title: "Skill declaration",
    description:
      "TASK-31. What this Worker declares about one Task type it answers. The owner's `raises` " +
      "says what is sent and its `actions` what is taken back; this says what the answerer " +
      "requires and what it produces, where it says anything at all, and each pair is what a " +
      "Tower compares.",
  });

export const descriptor = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .meta({
        description:
          "DESC-6. The Worker's own id, which is not the URL it is served from. DESC-27 adds " +
          "that it is not derived from that URL and survives a move, and DESC-28 that it is " +
          "opaque, stable and unambiguous without ambient context. NAME-9 requires only that no " +
          "two Workers share one, which a namespaced name and a random identifier satisfy " +
          "equally — so no pattern is asserted here on purpose. A schema can assert that it is a " +
          "non-empty string and no more; DESC-27, DESC-28 and NAME-9 have no schema witness.",
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
    skills: z
      .record(qualifiedName, skillDeclaration)
      .optional()
      .meta({
        description:
          "TASK-31. The Task types this Worker answers, which IS its Skill — the unit of " +
          "discovery the Tower catalogs by. It is at the root rather than in the `tasks` entry " +
          "because a Skill is served at no address and answered by no surface: it is what a " +
          "Worker IS, like its id, and a Capability is what a Worker SERVES. Omitted by a Worker " +
          "with no Skill, which is the ordinary case for one that only raises Tasks of its own.",
      }),
    capabilities: z.record(z.union([capabilityName, vendorCapabilityName]), capabilityEntry).meta({
      description:
        "DESC-22. Keyed by Capability name, which is what makes a Capability declared at most " +
        "once: a list could not express that, because JSON Schema compares whole items for " +
        "uniqueness and two entries named `health` validate cleanly as distinct items. DESC-2 " +
        "admits any combination, including none. A key is a reserved name (DESC-8) or a vendor " +
        "one (DESC-14), and the dot is what tells the two apart.",
    }),
  })
  .meta({
    title: "Descriptor",
    description:
      "DESC-1. The document a Worker serves at the route DESC-3 fixes, and the whole of what " +
      "every Worker owes.",
  });

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
  "schema_mismatch",
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

/**
 * MET-3 — the five periods a metric may accumulate over, and the only five.
 *
 * Closed because a console renders a period selector from what a metric declares, and an arbitrary
 * duration would make that a free-text box. It is also where accumulation stops being a time
 * series, which is the distinction this Capability rests on.
 */
export const metricGranularity = z.enum(["hour", "day", "week", "month", "year"]).meta({
  title: "Metric granularity",
  description:
    "MET-3. The period one bucket covers. MET-20 cuts every boundary in the time zone the entry " +
    "declares, and MET-7 makes a week the ISO 8601 one, beginning Monday.",
});

/**
 * MET-4 — one dimension a metric is broken down by, held under its name.
 *
 * `values` absent is the free case and is not the same as an empty list, which is why the minimum
 * is 1: a dimension that declared no possible value could never be filtered to anything, and
 * MET-17 would answer `400` for every value a caller sent.
 *
 * Declaring the set buys two different things, which is why metrics.md spends two rules on it:
 * MET-17 refuses a value outside it, and MET-19 grants the dimension the right to be broken down
 * by — a free dimension is filtered and never grouped, because nothing would bound the answer.
 */
/**
 * MET-5, MET-16 — the characters a dimension name may use: what a query parameter needs, and no
 * more. Shared between the declaration, the bucket and the `by` parameter so the three agree.
 */
export const DIMENSION_NAME = /^[A-Za-z0-9_-]+$/;

export const metricDimension = z
  .strictObject({
    values: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .meta({
        description:
          "MET-4. The closed set of values this dimension takes. Absent means any string, and " +
          "MET-17 then accepts one that matches nothing rather than refusing it. Only a " +
          "dimension that declares its set may be broken down by, under MET-19.",
      }),
  })
  .meta({
    title: "Metric dimension",
    description:
      "MET-4. One dimension of a metric, declared under its name so that a reader knows every " +
      "dimension before it calls. MET-16 fixes it with a query parameter of that same name.",
  });

/**
 * MET-21, MET-3, MET-4 — what a Worker declares about one metric.
 *
 * Closed: MET-3 and MET-4 enumerate the declaration, and no open question in metrics.md asks for
 * another member of it. A member added later is what an edition is for, which is DESC-23.
 *
 * `dimensions` is required and may be empty, for the reason `checks` is in `health`: one shape for
 * every reader, rather than a member whose absence and whose emptiness say the same thing.
 */
export const metricDeclaration = z
  .strictObject({
    unit: z
      .string()
      .min(1)
      .meta({
        description:
          "MET-3. Declared by the Worker and parsed by nothing here. This protocol has no " +
          "dimensional analysis: the unit exists so a console can put something beside a number.",
      }),
    additive: z.boolean().meta({
      description:
        "MET-3. Whether buckets of this metric may be summed. Declared because a reader will " +
        "otherwise assume it and produce a number that is wrong and plausible: tokens over two " +
        "days is the sum of the two, vehicles that reported over two days is not.",
    }),
    granularities: z
      .array(metricGranularity)
      .min(1)
      .meta({
        description:
          "MET-3. At least one, and only what the Worker actually keeps. MET-10 answers `400` " +
          "for anything not listed here, and MET-8 lets a read omit the granularity where this " +
          "carries exactly one.",
      }),
    dimensions: z.record(z.string().regex(DIMENSION_NAME), metricDimension).meta({
      description:
        "MET-4. Keyed by dimension name. The pattern asserts only what the transport needs, " +
        "because MET-16 spells the name into a query parameter; NAME-3 imposes no convention on " +
        "a name a Worker mints. MET-5 also forbids the names this protocol defines on a read, " +
        "which no pattern here asserts: excluding a word list needs a negative lookahead, and " +
        "RE2-backed validators refuse one. May be empty.",
    }),
  })
  .meta({
    title: "Metric declaration",
    description:
      "MET-21. One metric, held under its name in the `metrics` entry. The Descriptor is the " +
      "catalog: the surface itself never lists what exists.",
  });

/**
 * MET-6 — an IANA Time Zone Database name.
 *
 * The separator is written `[/]` rather than `\/` so the generated pattern carries no JavaScript
 * escape. A regular expression literal cannot hold a bare `/` outside a character class, and `\/`
 * is an escape ECMA-262 accepts and Java refuses outright — a runtime's fingerprint smuggled into
 * the normative artifact, which is the same thing the generator strips a safe-integer bound for.
 *
 * The pattern refuses the common wrong answers — an offset like `-03:00`, an abbreviation like
 * `ART` — and asserts nothing about whether the zone exists. No schema can check a name against
 * a database that ships with the reader.
 */
export const timeZone = z
  .string()
  .regex(/^(?:UTC|[A-Za-z_]+[/][A-Za-z0-9_+/-]+)$/)
  .meta({
    title: "Time zone",
    description:
      "MET-6. An IANA Time Zone Database name — `America/Argentina/Buenos_Aires`, `UTC`. A fixed " +
      "offset is not one: an offset cannot say when a day begins across a daylight-saving " +
      "transition, which is the whole reason the zone is declared. This is the calendar a caller " +
      "gets when the Worker has agreed no other with it.",
  });

/**
 * MET-1, MET-21, MET-6 — the `metrics` Capability entry.
 *
 * The address is required, as HLTH-1 requires it, because this Capability is answered over HTTP.
 */
export const metricsEntry = capabilityEntry
  .extend({
    address,
    timeZone,
    publishes: z.record(z.string().min(1), metricDeclaration).meta({
      description:
        "MET-21. Every metric the Worker publishes, keyed by name. A name not here is `404` " +
        "under MET-9. The key carries no pattern: it is spelled into the VALUE of a query " +
        "parameter, which is percent-encoded, and naming.md leaves a Worker's own names alone.",
    }),
  })
  .meta({
    title: "Metrics capability entry",
    description:
      "MET-1. The shared Capability entry with the address required, the time zone every bucket " +
      "boundary is cut in, and the metrics this Worker publishes.",
  });

/**
 * An RFC 3339 instant carrying an offset — MET-13, TASK-28 and ALRT-3 all take one.
 *
 * `format` is an annotation in Draft 2020-12 unless a validator opts into format-assertion, so the
 * pattern is what binds. It admits a wrong date — the 31st of February — because a regular
 * expression that ruled those out would be unreadable, and a Worker that emits one has a bug no
 * schema was going to find.
 */
export const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const instant = (description: string) =>
  z.string().regex(INSTANT).meta({ format: "date-time", description });

/**
 * MET-12, MET-13, MET-15, MET-19 — one bucket.
 *
 * Closed, and it carries no name, unit or granularity: MET-8 has the caller name the metric and,
 * where there is a choice, the granularity, and MET-21 has it read the unit from the Descriptor
 * before it calls. Repeating any of them here would be a second place for them to disagree.
 *
 * It carries no status and no judgment of any kind. metrics.md answers `how much` and stops: a
 * Worker that decides one of its own numbers is wrong raises an Alert, and what is inside a
 * Worker's settings is not a thing this surface has a view of.
 */
export const metricBucket = z
  .strictObject({
    start: instant("MET-13. Inclusive. MET-20 cuts it in the zone the entry declares."),
    end: instant(
      "MET-13. Exclusive, and carried rather than derived: a day across a daylight-saving " +
        "transition is 23 or 25 hours, and a reader comparing this against its own clock knows " +
        "whether the bucket is still accumulating without holding a calendar.",
    ),
    value: z
      .number()
      .nullable()
      .meta({
        description:
          "MET-13, MET-15. What the Worker accumulated over the period. Null means the Worker no " +
          "longer holds this bucket and never means zero; a bucket it accumulated nothing in is " +
          "absent from the answer instead.",
      }),
    dimensions: z
      .record(z.string().regex(DIMENSION_NAME), z.string())
      .optional()
      .meta({
        description:
          "MET-19. The values this bucket is broken down by, present only on a read that asked " +
          "for a breakdown with `by`. One entry per dimension named there, each a value from " +
          "that dimension's declared set — MET-19 admits no other kind.",
      }),
  })
  .meta({
    title: "Metric bucket",
    description: "MET-13. One period of one metric, whole under MET-12.",
  });

/**
 * MET-14 — what a read answers: the shared page envelope with its items narrowed, which is the
 * narrowing ENDP-20 says each surface's own schema performs.
 */
export const metricPage = page
  .extend({
    items: z.array(metricBucket).meta({
      description: "MET-14. Ascending by start. MET-12: whole buckets only.",
    }),
  })
  .meta({
    title: "Metric page",
    description:
      "MET-14. One page of buckets, in the envelope ENDP-20 fixes for every collection in this " +
      "protocol.",
  });

/**
 * ACT-12 — the declaration ENDP-15 requires of an Action that takes an idempotency key.
 *
 * A union rather than one object with an optional member, on the same reasoning that makes `error`
 * a union: written flat, `from: "input"` with no member named would validate cleanly and leave the
 * Worker with nowhere to read the key from. The two branches make the half-set state unspellable.
 */
export const idempotencyDeclaration = z
  .union([
    z.strictObject({
      required: z.boolean().meta({
        description:
          "ENDP-18. Whether a key is required. A required key that is absent is `400`; an Action " +
          "that declares none is at-least-once under retry.",
      }),
      from: z.literal("header").meta({
        description:
          "ENDP-15. The key arrives in `Idempotency-Key`. It is opaque, and the Worker records " +
          "it without parsing it.",
      }),
      windowSeconds: z
        .number()
        .int()
        .min(1)
        .meta({
          description:
            "ENDP-15, ENDP-16. How long the Worker answers the recorded outcome for a repeat. " +
            "Declared because the guarantee is worthless without it: no Worker remembers forever, " +
            "and one that has forgotten performs the Action again while the caller still believes " +
            "it is protected.",
        }),
    }),
    z.strictObject({
      required: z.boolean(),
      from: z.literal("input").meta({
        description:
          "ACT-12. The key is a named member of the input. A payload that already carries its " +
          "own identity needs no second key beside it, and the member is the Worker's own data.",
      }),
      member: z.string().min(1).meta({
        description: "ACT-12. Which member of the input the Worker reads the key from.",
      }),
      windowSeconds: z.number().int().min(1),
    }),
  ])
  .meta({
    title: "Idempotency declaration",
    description:
      "ACT-12. Carried in an Action's entry, because a caller decides whether it can retry " +
      "safely BEFORE it sends anything. This is DESC-11's first case.",
  });

/**
 * ACT-2, ACT-3, ACT-4 — what a Worker declares about one Action.
 *
 * Closed: these rules enumerate the declaration, and a member added later is what an edition is
 * for. The schemas INSIDE it are the Worker's own and are not constrained here — this protocol has
 * no data model, and an Action's input is exactly where that matters most.
 */
export const actionDeclaration = z
  .strictObject({
    input: z.looseObject({}).meta({
      description:
        "ACT-2. The JSON Schema of this Action's input, and the whole of what a caller sends. A " +
        "console renders a form from it without having been told anything else about the Worker.",
    }),
    result: z
      .looseObject({})
      .optional()
      .meta({
        description:
          "ACT-3. The JSON Schema of what a performance answers, absent where it answers nothing. " +
          "ACT-10 draws `200` and `204` at exactly this.",
      }),
    completesWithinCall: z.boolean().meta({
      description:
        "ACT-4. Declared rather than discovered, because a caller decides whether it can wait " +
        "before it sends. ACT-11: one that does not answers `202` with no body.",
    }),
    idempotency: idempotencyDeclaration.optional().meta({
      description: "ACT-12, ENDP-15. Absent where the Action takes no key.",
    }),
    readAddress: address.optional().meta({
      description:
        "ACT-15. Where a GET answers a document this Action would accept. Required of " +
        "`configure` and optional for every other Action — which is a condition on the KEY an " +
        "entry is held under, and so a rule rather than a shape.",
    }),
  })
  .meta({
    title: "Action declaration",
    description:
      "ACT-2. One Action, held under its name in the `actions` entry. The name is the Worker's " +
      "own: NAME-7 does not reach it, because it is resolved inside the Descriptor that " +
      "declared it. `configure` is the one name ACT-13 reserves.",
  });

/**
 * ACT-16 — the `actions` Capability entry.
 *
 * The address is required, as HLTH-1 and MET-1 require it, because this Capability is answered
 * over HTTP. One address for the Capability and a parameter naming the Action, which is the shape
 * `metrics` already uses — actions.md argues the two alternatives down at length.
 */
export const actionsEntry = capabilityEntry
  .extend({
    address,
    accepts: z.record(z.string().min(1), actionDeclaration).meta({
      description:
        "ACT-16. Every Action the Worker accepts, keyed by name. An Action not here is `404` " +
        "under ACT-6. The key carries no pattern: it travels as the VALUE of the `action` " +
        "parameter and is percent-encoded like any other.",
    }),
  })
  .meta({
    title: "Actions capability entry",
    description:
      "ACT-16. The shared Capability entry with the address required, and the Actions this Worker " +
      "accepts. The Descriptor is the catalog: the surface performs and never lists what exists.",
  });

/**
 * TASK-32 — one Task type a Worker raises.
 *
 * The Actions named here are the OWNER's own, declared in its `actions` entry: a Response is an
 * Action posted into the owner, so the closed list is a list of names that entry holds.
 */
export const taskTypeDeclaration = z
  .strictObject({
    payload: z.looseObject({}).meta({
      description:
        "TASK-32. The JSON Schema of this Task type's payload. The Worker's own — this protocol " +
        "has no data model — and what a consumer renders or validates against.",
    }),
    answeredBy: z
      .string()
      .min(1)
      .meta({
        description:
          "TASK-32. The one Action of this Worker's own that answers a Task of this type, by the " +
          "name its `actions` entry holds it under. One and not a list: where a Task can end " +
          "several ways, the endings are variants of that Action's input, told apart by a " +
          "discriminator. A name and not an instruction: the owner says what would answer, never " +
          "who.",
      }),
  })
  .meta({
    title: "Task type declaration",
    description:
      "TASK-32. One Task type, held under a qualified name (TASK-4, NAME-7) because it is matched " +
      "by a party that did not mint it.",
  });

/**
 * TASK-27, TASK-32 — the `tasks` Capability entry.
 *
 * One address, and a read. The entry carried a second one a claim was posted to until the Claim
 * lifecycle was withdrawn; `spec/tasks.md` holds the argument, and the short of it is that a lease
 * over a unit of work is orchestration, which this specification names a non-goal.
 *
 * It carried a third thing until TASK-31 moved it: what the Worker ANSWERS, which is served at no
 * address and is now `skills` on the Descriptor's root. What is left here is what the declared
 * address actually answers instances of.
 */
export const tasksEntry = capabilityEntry
  .extend({
    address,
    raises: z.record(qualifiedName, taskTypeDeclaration).meta({
      description:
        "TASK-32. Every Task type this Worker raises. A Worker that raises none declares an empty " +
        "map rather than omitting it, so that every reader parses one shape.",
    }),
  })
  .meta({
    title: "Tasks capability entry",
    description:
      "TASK-27. The shared Capability entry with the reading address required, and the Task " +
      "types this Worker raises. What it ANSWERS is TASK-31's `skills`, on the Descriptor root.",
  });

/**
 * TASK-28 — one Task on the wire.
 *
 * It carries no status and nothing anybody declared about it. A Task exists while its condition
 * holds (TASK-15) and disappears when it stops, so there is no state for a reader to interpret;
 * what a reader needs is what it is, what would answer it, and how long it has been true.
 */
export const task = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .meta({ description: "TASK-28. The owner's own id for this Task. Opaque to everyone else." }),
    type: qualifiedName.meta({
      description: "TASK-28, TASK-4. One of the types the entry declares under `raises`.",
    }),
    payload: z.unknown().meta({
      description: "TASK-28. Against the schema that type declared. The Worker's own shape.",
    }),
    since: instant(
      "TASK-28. When this Task's condition began. It is what a stuck Task is read from: one open " +
        "since Tuesday is one nobody has answered, and it is the field ALRT-3 puts on an Alert, " +
        "read the same way. It replaced counts of Claims that had failed and lapsed, and says " +
        "less: how long a condition has held, and nothing about what anybody did about it.",
    ),
  })
  .meta({
    title: "Task",
    description:
      "TASK-28. One Task whose condition holds. TASK-5 answers these in the page envelope of " +
      "ENDP-20.",
  });

/** TASK-5 — what a read answers: the shared page envelope with its items narrowed to Tasks. */
export const taskPage = page
  .extend({
    items: z.array(task).meta({ description: "TASK-5. The Tasks whose conditions hold." }),
  })
  .meta({
    title: "Task page",
    description: "TASK-5. One page of Tasks, in the envelope ENDP-20 fixes for every collection.",
  });

/**
 * ALRT-4 — the two severities, and the only two.
 *
 * The contrast with `healthStatus` is the argument rather than an inconsistency. `degraded` earns
 * a third value there because a Worker working with one dependency down has a real state with no
 * honest spelling in two. Here the only decision an operator takes is whether to look now, and a
 * third value would be a place to hedge rather than a state anybody needed to express.
 */
export const alertSeverity = z.enum(["warning", "critical"]).meta({
  title: "Alert severity",
  description: "ALRT-4. Whether an operator should look now or look later.",
});

/**
 * ALRT-3 — one Alert.
 *
 * It carries no status and nothing anybody declared about it, for the reason a Task does not: an
 * Alert exists while its condition holds and ends when it stops (ALRT-5), so there is no state for
 * a reader to interpret and no dismissal for anyone to record.
 */
export const alert = z
  .strictObject({
    id: z.string().min(1).meta({
      description: "ALRT-3. The Worker's own id for this Alert. Opaque to everyone else.",
    }),
    severity: alertSeverity,
    since: instant(
      "ALRT-3. When the condition began, as an RFC 3339 instant carrying an offset. It is " +
        "what lets a console tell `this is new` from `this is the same thing as yesterday`, " +
        "which is most of what dismissal was being asked to do.",
    ),
    summary: z
      .string()
      .min(1)
      .meta({
        description:
          "ALRT-3. Human-readable, and parsed by nothing. The reader this surface exists for is a " +
          "person looking at a console; what a program acts on is the severity and the Actions.",
      }),
    actions: z.array(z.string().min(1)).meta({
      description:
        "ALRT-3, ALRT-7. The Actions this Alert offers, by the names the Worker's own `actions` " +
        "entry holds them under. May be empty. Names and not schemas, because the schema is " +
        "already in that entry and a second copy is a second thing to keep in step.",
    }),
  })
  .meta({
    title: "Alert",
    description: "ALRT-3. One condition an operator should see, while it holds.",
  });

/** ALRT-2 — what a read answers: the page envelope with its items narrowed to Alerts. */
export const alertPage = page
  .extend({
    items: z.array(alert).meta({ description: "ALRT-2. The Alerts whose conditions hold." }),
  })
  .meta({
    title: "Alert page",
    description: "ALRT-2. One page of Alerts, in the envelope ENDP-20 fixes for every collection.",
  });

/** ALRT-1 — the `alerts` Capability entry. The address is required: this is answered over HTTP. */
export const alertsEntry = capabilityEntry.extend({ address }).meta({
  title: "Alerts capability entry",
  description:
    "ALRT-1. The shared Capability entry with the address required. Nothing else: what a Worker " +
    "raises an Alert about is its own business, so there is no catalog to declare.",
});

/**
 * ACTV-4 — the three states an activity may be in, and the only three.
 *
 * Three rather than Alerts' two, on health's argument rather than alerts': a Worker that will run
 * something at midnight and a Worker with four hundred items queued are both `not running`, and one
 * word for both would make an operator unable to tell `backing up` from `waiting for its time`.
 */
export const activityState = z.enum(["scheduled", "pending", "running"]).meta({
  title: "Activity state",
  description:
    "ACTV-4. `scheduled` is undertaken for a later moment the Worker knows, and nothing is wrong. " +
    "`pending` is undertaken and waiting to start, and the length of that list is what an " +
    "operator watches. `running` is under way. No fourth value.",
});

/**
 * ACTV-3 — one activity.
 *
 * No type and no payload, deliberately: a payload with no declared schema is JSON nobody outside
 * the Worker can validate or render, which is the blob alerts.md argues a protocol must not offer.
 * The summary is for a person; the state is what a program acts on.
 */
export const activity = z
  .strictObject({
    id: z.string().min(1).meta({
      description: "ACTV-3. The Worker's own id for this activity. Opaque to everyone else.",
    }),
    state: activityState,
    since: instant(
      "ACTV-3. When the activity entered its current state, as an RFC 3339 instant carrying an " +
        "offset. For `running`, when work began; for `pending`, when it joined the queue, which " +
        "is what makes a stuck one visible; for `scheduled`, when the Worker undertook it — and " +
        "never when it will next run, which is scheduling and a non-goal.",
    ),
    summary: z
      .string()
      .min(1)
      .meta({
        description:
          "ACTV-3. Human-readable, and parsed by nothing. The reader this surface exists for is a " +
          "person asking what a Worker is doing; what a program acts on is the state.",
      }),
  })
  .meta({
    title: "Activity",
    description: "ACTV-3. One thing a Worker is doing or has undertaken to do, while it holds it.",
  });

/** ACTV-2 — what a read answers: the page envelope with its items narrowed to activities. */
export const activityPage = page
  .extend({
    items: z.array(activity).meta({ description: "ACTV-2. The activities the Worker holds." }),
  })
  .meta({
    title: "Activity page",
    description:
      "ACTV-2. One page of activities, in the envelope ENDP-20 fixes for every collection.",
  });

/** ACTV-1 — the `activity` Capability entry. The address is required: this is answered over HTTP. */
export const activityEntry = capabilityEntry.extend({ address }).meta({
  title: "Activity capability entry",
  description:
    "ACTV-1. The shared Capability entry with the address required. Nothing else: what a Worker " +
    "counts as an activity is its own business, so there is no catalog to declare.",
});

/**
 * EVT-11 — where an event lands on the broker its entry declares.
 *
 * An object and not a string, because what a consumer needs in order to attach is not alike across
 * brokers: a Kafka topic beside its bootstrap servers, an Event Hub inside a namespace, an SNS ARN
 * with a region in it. One string would have made every consumer parse this Worker's own way of
 * packing several facts into one, which is the work a catalog exists to remove.
 *
 * Open, and nothing here reads a key of it — the same move an Action's input already makes. What
 * that costs is that two Workers on one broker may spell it differently; `spec/events.md` argues
 * why a namespaced name would not have fixed it and convention is what does.
 */
export const eventDestination = z.looseObject({}).meta({
  title: "Event destination",
  description:
    "EVT-11. Where on the declared broker these events land, in whatever shape that broker needs " +
    "— a topic beside its servers, an Event Hub in a namespace, an ARN. The keys are the " +
    "Worker's own and nothing here parses them. A Worker that publishes and does not say where " +
    "leaves a consumer holding a cluster, an envelope layout and a list of names it cannot attach " +
    "to anything.",
});

/** EVT-12, EVT-11 — one event type a Worker publishes. */
export const eventTypeDeclaration = z
  .strictObject({
    data: z.looseObject({}).meta({
      description:
        "EVT-12. The JSON Schema of this event type's data — the `data` of the CloudEvents " +
        "envelope EVT-1 fixes. The Worker's own shape: this protocol has no data model.",
    }),
    destination: eventDestination.optional().meta({
      description:
        "EVT-11. Where THIS type lands, for a Worker that divides its events by subject. Absent, " +
        "it lands at the entry's destination, which is the ordinary case.",
    }),
  })
  .meta({
    title: "Event type declaration",
    description:
      "EVT-12. One event type, held under a qualified name (EVT-4, NAME-7) because a subscriber " +
      "matches it against what it decided to consume, having never met the team that minted it.",
  });

/**
 * EVT-11, EVT-12, EVT-8 — the `events` Capability entry.
 *
 * The one entry with NO address, which is the single reason DESC-22 leaves the address optional in
 * the shared entry at all. An event travels over a broker this protocol declines to name, and a
 * Worker with no HTTP surface for it would otherwise have had to invent a URL that does not exist.
 */
export const eventsEntry = capabilityEntry
  .extend({
    broker: z
      .string()
      .min(1)
      .meta({
        description:
          "EVT-11. WHICH broker this Worker publishes to, named however its operators name it — " +
          "the cluster or the service, not the place on it, which is `destination`. Nothing here " +
          "parses it, exactly as nothing parses a metric unit.",
      }),
    protocolBinding: z
      .string()
      .min(1)
      .meta({
        description:
          "EVT-11. Which CloudEvents protocol binding the attributes are laid out under. Not fixed " +
          "and not parsed: a protocol binding is a property of a transport, and fixing one would " +
          "mean naming a broker or publishing a list of the ones somebody had thought of. It is " +
          "spelled in full because `binding` alone is what a deployment calls a resource it was " +
          "handed, which is a different thing that sits a few lines away in the same config.",
      }),
    destination: eventDestination,
    publishes: z.record(qualifiedName, eventTypeDeclaration).meta({
      description: "EVT-12. Every event type this Worker publishes, keyed by name.",
    }),
    republishWindowSeconds: z
      .number()
      .int()
      .min(1)
      .meta({
        description:
          "EVT-8. How long this Worker may publish the same `source` and `id` again. A consumer " +
          "that remembers them for at least this long sees each event once. Declared because " +
          "`remember forever` is not implementable, and a consumer that forgot too early would " +
          "process an event twice while believing it was protected — the same reasoning that has " +
          "ENDP-15 declare an idempotency window.",
      }),
  })
  .meta({
    title: "Events capability entry",
    description:
      "EVT-11. The shared Capability entry with NO address: the broker, the protocol binding and " +
      "the destination this Worker publishes to, what it publishes, and how long it may " +
      "republish one.",
  });

registry.add(capabilityName, { id: "capability-name" });
registry.add(qualifiedName, { id: "qualified-name" });
registry.add(healthStatus, { id: "health-status" });
registry.add(health, { id: "health" });
registry.add(healthEntry, { id: "health-entry" });
registry.add(capabilityEntry, { id: "capability-entry" });
registry.add(metricGranularity, { id: "metric-granularity" });
registry.add(metricDimension, { id: "metric-dimension" });
registry.add(metricDeclaration, { id: "metric-declaration" });
registry.add(metricsEntry, { id: "metrics-entry" });
registry.add(metricBucket, { id: "metric-bucket" });
registry.add(metricPage, { id: "metric-page" });
registry.add(skillDeclaration, { id: "skill-declaration" });
registry.add(descriptor, { id: "descriptor" });
registry.add(error, { id: "error" });
registry.add(page, { id: "page" });
registry.add(idempotencyDeclaration, { id: "idempotency-declaration" });
registry.add(actionDeclaration, { id: "action-declaration" });
registry.add(actionsEntry, { id: "actions-entry" });
registry.add(taskTypeDeclaration, { id: "task-type-declaration" });
registry.add(tasksEntry, { id: "tasks-entry" });
registry.add(task, { id: "task" });
registry.add(taskPage, { id: "task-page" });
registry.add(alertSeverity, { id: "alert-severity" });
registry.add(alert, { id: "alert" });
registry.add(alertPage, { id: "alert-page" });
registry.add(alertsEntry, { id: "alerts-entry" });
registry.add(activityState, { id: "activity-state" });
registry.add(activity, { id: "activity" });
registry.add(activityPage, { id: "activity-page" });
registry.add(activityEntry, { id: "activity-entry" });
registry.add(eventDestination, { id: "event-destination" });
registry.add(eventTypeDeclaration, { id: "event-type-declaration" });
registry.add(eventsEntry, { id: "events-entry" });

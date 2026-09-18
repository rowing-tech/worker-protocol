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
  .enum(["health", "metrics", "actions", "alerts", "tasks", "events"])
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
    detail: z.string().optional().meta({
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
export const healthEntry = capabilityEntry
  .extend({ address })
  .meta({
    title: "Health capability entry",
    description:
      "HLTH-1. The shared Capability entry with the address required, because `health` is " +
      "answered over HTTP. DESC-22 makes the address optional in the shared entry only so that " +
      "`events`, answered over a broker, can be declared at all.",
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

/**
 * MET-3 — the five periods a metric may accumulate over, and the only five.
 *
 * Closed because a console renders a period selector from what a metric declares, and an arbitrary
 * duration would make that a free-text box. It is also where accumulation stops being a time
 * series, which is the distinction this Capability rests on.
 */
export const metricGranularity = z
  .enum(["hour", "day", "week", "month", "year"])
  .meta({
    title: "Metric granularity",
    description:
      "MET-3. The period one bucket covers. MET-6 cuts every boundary in the time zone the entry " +
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
 * MET-2, MET-3, MET-4 — what a Worker declares about one metric.
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
    dimensions: z.record(z.string().regex(/^[A-Za-z0-9_-]+$/), metricDimension).meta({
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
      "MET-2. One metric, held under its name in the `metrics` entry. The Descriptor is the " +
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
 * MET-1, MET-2, MET-6 — the `metrics` Capability entry.
 *
 * The address is required, as HLTH-1 requires it, because this Capability is answered over HTTP.
 */
export const metricsEntry = capabilityEntry
  .extend({
    address,
    timeZone,
    metrics: z.record(z.string().min(1), metricDeclaration).meta({
      description:
        "MET-2. Every metric the Worker publishes, keyed by name. A name not here is `404` " +
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
 * MET-13 — an RFC 3339 instant carrying an offset.
 *
 * `format` is an annotation in Draft 2020-12 unless a validator opts into format-assertion, so the
 * pattern is what binds. It admits a wrong date — the 31st of February — because a regular
 * expression that ruled those out would be unreadable, and a Worker that emits one has a bug no
 * schema was going to find.
 */
const instant = (description: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)
    .meta({ format: "date-time", description });

/**
 * MET-12, MET-13, MET-15, MET-19 — one bucket.
 *
 * Closed, and it carries no name, unit or granularity: MET-8 has the caller name the metric and,
 * where there is a choice, the granularity, and MET-2 has it read the unit from the Descriptor
 * before it calls. Repeating any of them here would be a second place for them to disagree.
 *
 * It carries no status and no judgment of any kind. metrics.md answers `how much` and stops: a
 * Worker that decides one of its own numbers is wrong raises an Alert, and what is inside a
 * Worker's settings is not a thing this surface has a view of.
 */
export const metricBucket = z
  .strictObject({
    start: instant("MET-13. Inclusive. MET-6 cuts it in the zone the entry declares."),
    end: instant(
      "MET-13. Exclusive, and carried rather than derived: a day across a daylight-saving " +
        "transition is 23 or 25 hours, and a reader comparing this against its own clock knows " +
        "whether the bucket is still accumulating without holding a calendar.",
    ),
    value: z.number().nullable().meta({
      description:
        "MET-13, MET-15. What the Worker accumulated over the period. Null means the Worker no " +
        "longer holds this bucket and never means zero; a bucket it accumulated nothing in is " +
        "absent from the answer instead.",
    }),
    dimensions: z
      .record(z.string().regex(/^[A-Za-z0-9_-]+$/), z.string())
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
registry.add(descriptor, { id: "descriptor" });
registry.add(error, { id: "error" });
registry.add(page, { id: "page" });

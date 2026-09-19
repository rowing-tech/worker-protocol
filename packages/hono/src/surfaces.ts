import { createRoute, type RouteConfig, z } from "@hono/zod-openapi";
import {
  alertPage,
  claim,
  claimOutcome,
  DIMENSION_NAME,
  descriptor,
  error,
  health,
  INSTANT,
  metricGranularity,
  metricPage,
  registry,
  taskPage,
} from "@worker-protocol/schemas";
import { byCode, type ErrorCode } from "./codes.ts";

/**
 * The surface: which verb answers where, which parameters and headers travel, and which refusals
 * each operation gives — declared as Hono routes, because the routes are what runs.
 *
 * `schemas/` fixes what a document carries and `spec/` fixes behaviour that no schema can state.
 * Between them sat a third thing that was written down in neither: the *call*. Which verb a
 * Capability answers, which query parameters a read takes, which code answers which refusal — all
 * of it lived in tables in `spec/`, which is to say in English. An SDK generated from what existed
 * before this file got the shapes and had to read prose for everything else, and two SDKs that each
 * read it correctly could still expose two different APIs for one call.
 *
 * So the surface is declared here and `openapi/` is generated from it, committed, and compared in
 * CI — the reason and the mechanism `schemas/` and `rules.json` already have.
 *
 * **It is declared as `createRoute` objects and not as data of this repository's own, because most
 * Workers built on this protocol run on Hono and `mount()` in this package is what they mount.**
 * Declaring the surface once as data for the generator and once more as routes for what runs would
 * be the duplication this repository refuses everywhere else, so the declaration that runs is the
 * one that generates. What that costs is stated rather than hidden: the routes are written in a
 * library's vocabulary, `generate-openapi.ts` has to normalise what that library emits back into
 * the shape `openapi/` had before, and one parameter below carries a `preprocess` that is runtime
 * glue and not declaration. What it buys is that a Worker author who mounts these routes can ask
 * their own app for its OpenAPI document and get one that describes *their* Worker — their Actions,
 * their Task payloads — with no second generator.
 *
 * **Every item cites the rule it encodes**, exactly as each Zod node's `description` does, so that
 * the attribution `packages/conformance` reads off `schemas/` reaches the surface too. Nothing here
 * decides anything: a line without a rule id behind it is this file inventing an obligation, which
 * is the thing `conformance/README.md` forbids a verifier and forbids this for the same reason.
 *
 * Nothing here handles a request. A route is a declaration; `mount.ts` is where handlers live.
 */

/**
 * A response schema, named after its file in `schemas/`.
 *
 * The name is the registry id, carried as the Zod `id` meta that `@hono/zod-openapi` turns into a
 * named component — so the generator can turn `#/components/schemas/health` into
 * `../schemas/health.json` by string replacement and nothing in `openapi/` retypes a schema. It is
 * the meta and not `.openapi()` because the schema is another package's instance, and a method
 * patched onto one copy of `zod` does not reach an object built by another. Memoised, because Zod
 * refuses to register one id twice.
 */
const refs = new Map<z.ZodType, z.ZodType>();
const ref = <T extends z.ZodType>(schema: T): T => {
  const id = registry.get(schema)?.id;
  if (id === undefined) throw new Error("a response schema must be registered in schemas/");
  let named = refs.get(schema);
  if (named === undefined) {
    named = schema.meta({ ...schema.meta(), id });
    refs.set(schema, named);
  }
  return named as T;
};

/** `RULE. text`, the citation convention every description here and in `schemas/` holds. */
const cite = (rule: string, text: string) => `${rule}. ${text}`;

/** ENDP-5 — on every protocol response, whatever it says. */
export const RESPONSE_HEADERS = {
  "Worker-Protocol-Edition": {
    description: cite(
      "ENDP-5",
      "The edition that produced this answer. A caller that sees one it did not expect re-reads the Descriptor rather than parsing the body.",
    ),
    required: true,
    schema: { type: "string", pattern: "^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)$" },
  },
  "Worker-Protocol-Capability-Version": {
    description: cite("ENDP-5", "The Capability version that produced this answer."),
    required: true,
    schema: { type: "integer", minimum: 1 },
  },
} as const;

/** ENDP-6 — a caller may state the version it expects, on any request. */
const expectedVersion = z.coerce
  .number()
  .int()
  .min(1)
  .optional()
  .openapi({
    description: cite(
      "ENDP-6",
      "The Capability version the caller expects. A Worker that cannot answer it refuses the request whole with `400` and `unsupported_version`, and never substitutes its own.",
    ),
    type: "integer",
    minimum: 1,
  });

/** The one header every operation takes. */
const versionHeader = z.object({ "Worker-Protocol-Capability-Version": expectedVersion });

/** ENDP-20 — every collection pages the same way. */
const cursor = z
  .string()
  .min(1)
  .optional()
  .openapi({
    description: cite(
      "ENDP-21",
      "Opaque, produced only by the Worker, never constructed by a caller. Absent from an answer at the end of the collection.",
    ),
  });

const instant = (description: string) =>
  z.string().regex(INSTANT).optional().openapi({ description, format: "date-time" });

/** One answer that is not a refusal: `schema` is a registered Zod object, or null for no body. */
const answer = (rule: string, description: string, schema: z.ZodType | null) => ({
  description: cite(rule, description),
  headers: RESPONSE_HEADERS,
  ...(schema === null ? {} : { content: { "application/json": { schema: ref(schema) } } }),
});

/**
 * The refusals an operation gives, one response per distinct status.
 *
 * Several codes share a status — ENDP-26 forbids one code under two statuses, not two codes under
 * one — so the description names which may arrive. The status comes from `CODES` and nowhere else,
 * which is what makes a refusal here agree with ENDP-26 by construction.
 */
const refusals = (codes: [code: ErrorCode, rule: string][]) => {
  const byStatus = new Map<number, string[]>();
  for (const [code, rule] of codes) {
    const status = byCode.get(code)?.status;
    if (status === undefined) throw new Error(`${code} is not in CODES`);
    byStatus.set(status, [...(byStatus.get(status) ?? []), `\`${code}\` (${rule})`]);
  }
  return Object.fromEntries(
    [...byStatus].map(([status, names]) => [
      status,
      {
        description: `ENDP-25. The shared error envelope, carrying one of: ${names.join(", ")}.`,
        headers: RESPONSE_HEADERS,
        content: { "application/json": { schema: ref(error) } },
      },
    ]),
  );
};

/** Every refusal any surface may give for a reason that is not its own (REG-3, ENDP-6, ENDP-24). */
const SHARED: [ErrorCode, string][] = [
  ["unsupported_version", "ENDP-6"],
  ["unauthenticated", "REG-3"],
  ["forbidden", "ENDP-29"],
  ["internal_error", "ENDP-29"],
  ["unavailable", "ENDP-29"],
];

// ---- the routes ---------------------------------------------------------------------------------

export const readDescriptor = createRoute({
  method: "get",
  path: "/.well-known/worker-protocol",
  summary: "Read the Descriptor",
  description: cite(
    "DESC-5",
    "Reading a Descriptor is a GET and changes nothing. REG-21 has the Worker accept the credential recorded for it here as on every other address.",
  ),
  request: { headers: versionHeader },
  responses: {
    200: answer("DESC-1", "The Descriptor.", descriptor),
    ...refusals(SHARED),
  },
});

export const pollHealth = createRoute({
  method: "get",
  path: "/",
  summary: "Poll health",
  description: cite(
    "HLTH-5",
    "Answers `200` whatever it reports. The status is read from the body, and a response that is not `200` means the Worker did not answer rather than that it is unwell — which is the one distinction a health surface exists to draw.",
  ),
  request: { headers: versionHeader },
  responses: {
    200: answer("HLTH-2", "One status and a map of named checks.", health),
    ...refusals(SHARED),
  },
});

export const readMetric = createRoute({
  method: "get",
  path: "/",
  summary: "Read one metric",
  description: cite(
    "MET-8",
    "A read names one metric and answers one series. MET-18: a dimension a read neither fixes nor breaks down by is accumulated over, so an unfiltered answer is the total and never a slice the Worker chose.",
  ),
  request: {
    query: z.object({
      metric: z
        .string()
        .min(1)
        .openapi({
          description: cite(
            "MET-8",
            "One of the metrics the entry declares. One not declared is `404`.",
          ),
        }),
      granularity: z.optional(metricGranularity).openapi({
        description: cite(
          "MET-8",
          "Required where the metric declares more than one, and omittable where it declares exactly one.",
        ),
      }),
      from: instant(cite("MET-11", "Inclusive. Absent, the start of the current bucket.")),
      to: instant(
        cite(
          "MET-11",
          "Exclusive — the interval is half-open, so two adjacent reads add up. Absent, the instant the Worker answers.",
        ),
      ),
      // The one place runtime glue sits inside a declaration. Hono's validator hands a query
      // parameter that appears once over as a string, so a plain array refuses `?by=taskType`.
      // The preprocess wraps a lone value; the generator sees the inner array and nothing else.
      by: z
        .preprocess(
          (value) => (value === undefined || Array.isArray(value) ? value : [value]),
          z.array(z.string().regex(DIMENSION_NAME)).optional(),
        )
        .openapi({
          description: cite(
            "MET-19",
            "Break down by a dimension, and only by one that declared its set of values: over a free dimension nothing would bound the number of series.",
          ),
          // `form` with `explode` is what turns a list into `?by=a&by=b` — not a formatting
          // preference but the shape MET-19 already fixed, said in the vocabulary a generator reads.
          param: { style: "form", explode: true },
        }),
      // MET-16 spells a dimension into a parameter of its own NAME, and those names are the
      // Worker's — read from its Descriptor and never fixed here. An exploded object is the one
      // shape OpenAPI has for that: `dimensions` is the parameter's name and never travels, and
      // what reaches the wire is `?taskType=verify-vehicle&tenant=acme`. At runtime nothing
      // arrives under this name; `mount()` hands the raw query to the Worker, which knows them.
      dimensions: z
        .record(z.string(), z.string())
        .optional()
        .openapi({
          description: cite(
            "MET-16",
            "Each dimension the metric declares, fixed by a parameter named exactly as the dimension. The names are the Worker's own and are read from its Descriptor, so they are not enumerated here. A value outside a declared set is `400`; where a dimension declares no set, any string is accepted and may match nothing.",
          ),
          param: { style: "form", explode: true },
        }),
      cursor,
    }),
    headers: versionHeader,
  },
  responses: {
    200: answer("MET-14", "Buckets ascending by start, in the shared page envelope.", metricPage),
    ...refusals([
      ["not_found", "MET-9"],
      ["invalid_parameter", "MET-10"],
      ["unknown_filter", "ENDP-24"],
      ...SHARED,
    ]),
  },
});

export const performAction = createRoute({
  method: "post",
  path: "/",
  summary: "Perform an Action",
  description: cite(
    "ACT-5",
    "The body is the input and carries nothing else, so a console posts its form result verbatim and a Worker validates it against the schema it published with no envelope to unwrap.",
  ),
  request: {
    query: z.object({
      action: z
        .string()
        .min(1)
        .openapi({
          description: cite(
            "ACT-5",
            "One of the Actions the entry declares. Naming none is `400`; naming one it does not declare is `404`.",
          ),
        }),
    }),
    headers: z.object({
      "Idempotency-Key": z
        .string()
        .min(1)
        .optional()
        .openapi({
          description: cite(
            "ENDP-15",
            "Where the Action declares it reads a key from the header. Within the declared window a repeat under the same key is not a second performance; the same key with a different body is `409`.",
          ),
        }),
      "Worker-Protocol-Claim": z
        .string()
        .min(1)
        .optional()
        .openapi({
          description: cite(
            "TASK-20",
            "The Claim this Action is performed under, where it answers a Task. TASK-21: one that is not its Task's current one, or whose Task's type does not list this Action, is `409` and nothing is performed. Absent, the call is a performance and answers no Claim.",
          ),
        }),
      "Worker-Protocol-Capability-Version": expectedVersion,
    }),
    // No schema, deliberately, and so no validation here: the body is the Action's own input,
    // against the JSON Schema its entry declares, and this protocol has no data model. The Worker
    // reads the raw body and answers `malformed_request` or `schema_mismatch` itself (ACT-8).
    body: {
      required: true,
      description: cite(
        "ACT-2",
        "The Action's own input, against the JSON Schema its entry declares. This protocol has no data model, so no shape is fixed here.",
      ),
      content: { "application/json": { schema: {} as never } },
    },
  },
  responses: {
    200: answer(
      "ACT-10",
      "The Action completed and declares a result, against its own declared schema.",
      null,
    ),
    204: answer("ACT-10", "The Action completed and declares no result.", null),
    202: answer(
      "ACT-11",
      "The Action declares that it does not complete within the call. No body.",
      null,
    ),
    ...refusals([
      ["invalid_parameter", "ACT-7"],
      ["schema_mismatch", "ACT-8"],
      ["idempotency_key_required", "ENDP-18"],
      ["not_found", "ACT-6"],
      ["conflict", "TASK-21"],
      ["idempotency_key_reused", "ENDP-17"],
      ["unprocessable_content", "ACT-9"],
      ...SHARED,
    ]),
  },
});

export const readTasks = createRoute({
  method: "get",
  path: "/",
  summary: "Read the open Tasks",
  description: cite(
    "TASK-5",
    "Listing a Worker's open Tasks does not consume them, which is why this is a GET and why the claim is not (ENDP-2, ENDP-3).",
  ),
  request: {
    query: z.object({
      type: z
        .string()
        .optional()
        .openapi({
          description: cite(
            "TASK-8",
            "One of the Task types the entry declares. A type it does not declare is `400`.",
          ),
        }),
      cursor,
    }),
    headers: versionHeader,
  },
  responses: {
    200: answer("TASK-5", "Tasks whose conditions hold, in the shared page envelope.", taskPage),
    ...refusals([["invalid_parameter", "TASK-8"], ["unknown_filter", "ENDP-24"], ...SHARED]),
  },
});

export const writeClaim = createRoute({
  method: "post",
  path: "/",
  summary: "Claim, renew, or close a Claim",
  description: cite(
    "TASK-9",
    "`task` claims one Task and `type` claims any claimable Task of a type, where the entry declares `claimByType`; `claim` alone renews; `claim` with `outcome` closes. `lease` proposes a duration on a claim or a renewal. Closing a Claim never closes the Task, which closes when its condition stops holding and which nobody declares (TASK-15) — and a Task closing never closes the Claim (TASK-22).",
  ),
  request: {
    query: z.object({
      task: z
        .string()
        .min(1)
        .optional()
        .openapi({
          description: cite(
            "TASK-9",
            "The Task to claim, by the id TASK-7 carries. One already claimed, or one the Worker is not granting leases on, is `409`.",
          ),
        }),
      type: z
        .string()
        .min(1)
        .optional()
        .openapi({
          description: cite(
            "TASK-24",
            "A Task type to claim one claimable Task of, where the entry declares `claimByType`. The Claim answered carries that Task in `held`. A type the entry does not raise, or one named where `claimByType` is not declared, is `400` (TASK-23); nothing claimable of it is `404`.",
          ),
        }),
      lease: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .openapi({
          description: cite(
            "TASK-25",
            "A lease duration the holder proposes, in seconds, on a claim or a renewal. The owner grants what it decides and publishes the expiry; a proposal binds it to nothing.",
          ),
          type: "integer",
          minimum: 1,
        }),
      claim: z
        .string()
        .min(1)
        .optional()
        .openapi({
          description: cite(
            "TASK-13",
            "The Claim to renew or close. One that is no longer the Task's current one is `409` — the Claim id is the fencing token, checked at write time rather than against a clock.",
          ),
        }),
      outcome: z.optional(claimOutcome).openapi({
        description: cite(
          "TASK-14",
          "Closes the Claim. Absent with `claim`, the call renews instead.",
        ),
      }),
    }),
    headers: versionHeader,
  },
  responses: {
    200: answer(
      "TASK-9",
      "The Claim granted — with the Task it holds in `held` on a claim by type (TASK-24) — or the new expiry after a renewal.",
      claim,
    ),
    204: answer("TASK-14", "The Claim is closed.", null),
    ...refusals([
      ["invalid_parameter", "TASK-14"],
      ["invalid_parameter", "TASK-23"],
      ["not_found", "ENDP-29"],
      ["not_found", "TASK-24"],
      ["conflict", "TASK-10"],
      ...SHARED,
    ]),
  },
});

export const readAlerts = createRoute({
  method: "get",
  path: "/",
  summary: "Read the Alerts whose conditions hold",
  description: cite(
    "ALRT-2",
    "ALRT-6 answers the same Alerts to every caller the Worker authenticates: the party an Alert is for is whoever operates the Worker, and that is enrollment rather than a Contract.",
  ),
  request: { query: z.object({ cursor }), headers: versionHeader },
  responses: {
    200: answer("ALRT-2", "Alerts whose conditions hold, in the shared page envelope.", alertPage),
    ...refusals([["unknown_filter", "ENDP-24"], ...SHARED]),
  },
});

// ---- the documents ------------------------------------------------------------------------------

export type Surface = {
  /** The generated file, without `.json`. */
  document: string;
  /** The Capability, or `descriptor` for the one route this protocol fixes. */
  capability: string;
  /**
   * The server variable this document is served under — which is a *declared address* and never a
   * path. ENDP-1 says no reader assembles an address, so a generated client is constructed with
   * one read from the Descriptor and resolved per DESC-12, and concatenates nothing.
   */
  server: { variable: string; rule: string; description: string };
  title: string;
  description: string;
  /** The route this document describes: one declared address, one operation. */
  route: RouteConfig;
};

const address = (capability: string, rule: string, extra = "") => ({
  variable: "address",
  rule,
  description: `The address the \`${capability}\` entry declares, resolved per DESC-12${extra}.`,
});

export const SURFACES: Surface[] = [
  {
    document: "descriptor",
    capability: "descriptor",
    server: {
      variable: "baseUrl",
      rule: "DESC-3",
      description:
        "The Worker's enrolled base URL: one absolute `https` URL, with or without a path.",
    },
    title: "worker-protocol — the Descriptor",
    description:
      "The one route this protocol fixes, and the whole of what every Worker owes. Every other address is declared in the document this answers (ENDP-1).",
    route: readDescriptor,
  },
  {
    document: "health",
    capability: "health",
    server: address("health", "HLTH-1", " against the URL the Descriptor was read from"),
    title: "worker-protocol — health",
    description: "The answer to a poll: one status for the Worker and a map of named checks.",
    route: pollHealth,
  },
  {
    document: "metrics",
    capability: "metrics",
    server: address("metrics", "MET-1"),
    title: "worker-protocol — metrics",
    description:
      "Named quantities accumulated over declared periods. The Descriptor is the catalog: this surface answers values and never lists what exists (MET-2).",
    route: readMetric,
  },
  {
    document: "actions",
    capability: "actions",
    server: address("actions", "ACT-1"),
    title: "worker-protocol — actions",
    description:
      "Performing an operation a Worker accepts. The `configure` reading address of ACT-15 is not described here: its address is declared inside an Action rather than beside the Capability, and the document it answers is shaped by that Action's own input schema, which is the Worker's.",
    route: performAction,
  },
  {
    document: "tasks",
    capability: "tasks",
    server: {
      variable: "address",
      rule: "TASK-1",
      description:
        "The reading address the `tasks` entry declares, resolved per DESC-12. The address a claim is posted to is a different declared address and has its own document.",
    },
    title: "worker-protocol — tasks, the reading address",
    description:
      "The Tasks whose conditions hold. TASK-6 answers only those the credential presented covers.",
    route: readTasks,
  },
  {
    document: "tasks-claims",
    capability: "tasks",
    server: {
      variable: "claimAddress",
      rule: "TASK-1",
      description:
        "The address the `tasks` entry declares a claim is posted to, resolved per DESC-12. It is a second document and not a second path, because a declared address is a server and a path appended to one is an address nobody declared.",
    },
    title: "worker-protocol — tasks, the claim address",
    description:
      "Claiming a Task, renewing a lease, and declaring an outcome. Everything here changes state, which is why it is a POST (ENDP-3).",
    route: writeClaim,
  },
  {
    document: "alerts",
    capability: "alerts",
    server: address("alerts", "ALRT-1"),
    title: "worker-protocol — alerts",
    description:
      "Conditions an operator should see. An Alert ends when its condition stops holding and nobody dismisses one (ALRT-5), so there is no write here.",
    route: readAlerts,
  },
];

/**
 * What this file deliberately does not describe.
 *
 * - **`events`.** It has no address: it travels over a broker this protocol declines to name, which
 *   is the one case DESC-22 leaves the shared entry's address optional for. There is no call to
 *   describe, and inventing a document for it would be the artifact claiming a surface the
 *   specification refuses to fix.
 * - **Anything whose shape is the Worker's own.** An Action's input and result, a Task's payload, an
 *   event's data. Each is a JSON Schema a Worker declares in its Descriptor. A Worker that mounts
 *   these routes and asks its own app for a document gets them in it, because that document is
 *   generated from that Worker's routes and not from this file.
 * - **A dimension named as a query parameter.** MET-16 spells a dimension into a parameter of its
 *   own name, and those names are the Worker's. `dimensions` above is the OpenAPI shape for that
 *   and never travels under its own name.
 */

/**
 * The surface: which verb answers where, which parameters and headers travel, and which refusals
 * each operation gives.
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
 * **Every item cites the rule it encodes**, exactly as each Zod node's `description` does, so that
 * the attribution `packages/conformance` reads off `schemas/` reaches the surface too. Nothing here
 * decides anything: a line without a rule id behind it is this file inventing an obligation, which
 * is the thing `conformance/README.md` forbids a verifier and forbids this for the same reason.
 */

/** A query parameter or a header one operation takes. */
export type Parameter = {
  name: string;
  in: "query" | "header";
  required: boolean;
  /** The rule that puts it there. */
  rule: string;
  description: string;
  /** A JSON Schema fragment, inline because these are this protocol's own and are tiny. */
  schema: Record<string, unknown>;
  /**
   * How a non-scalar value is spelled onto the query string.
   *
   * Two parameters here need it and both need the same answer. `form` with `explode` is what turns
   * a list into `?by=a&by=b` and an object into `?taskType=x&tenant=y` — which is not a formatting
   * preference but the shape MET-16 and MET-19 already fixed, said in the vocabulary a generator
   * reads instead of in prose it cannot.
   */
  style?: "form";
  explode?: boolean;
};

/** One answer that is not a refusal. `schema` is a file name in `schemas/`, or null for no body. */
export type Answer = {
  status: number;
  schema: string | null;
  rule: string;
  description: string;
};

/** One refusal, by the code that fixes its status and its class (ENDP-26). */
export type Refusal = { status: number; code: string; rule: string };

export type Operation = {
  method: "get" | "post";
  summary: string;
  /** The rule that fixes this verb at this address. */
  rule: string;
  description: string;
  parameters: Parameter[];
  /** Present on a write. `schema` is null where the body is the Worker's own and not ours. */
  requestBody?: { schema: string | null; rule: string; description: string };
  answers: Answer[];
  refusals: Refusal[];
};

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
  /** `/` for a declared address, and the one fixed route for the Descriptor. */
  path: string;
  title: string;
  description: string;
  operations: Operation[];
};

/** ENDP-5 — on every protocol response, whatever it says. */
export const RESPONSE_HEADERS: Parameter[] = [
  {
    name: "Worker-Protocol-Edition",
    in: "header",
    required: true,
    rule: "ENDP-5",
    description:
      "The edition that produced this answer. A caller that sees one it did not expect re-reads the Descriptor rather than parsing the body.",
    schema: { type: "string", pattern: "^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)$" },
  },
  {
    name: "Worker-Protocol-Capability-Version",
    in: "header",
    required: true,
    rule: "ENDP-5",
    description: "The Capability version that produced this answer.",
    schema: { type: "integer", minimum: 1 },
  },
];

/** ENDP-6 — a caller may state the version it expects, on any request. */
const EXPECTED_VERSION: Parameter = {
  name: "Worker-Protocol-Capability-Version",
  in: "header",
  required: false,
  rule: "ENDP-6",
  description:
    "The Capability version the caller expects. A Worker that cannot answer it refuses the request whole with `400` and `unsupported_version`, and never substitutes its own.",
  schema: { type: "integer", minimum: 1 },
};

/** ENDP-20 — every collection pages the same way. */
const CURSOR: Parameter = {
  name: "cursor",
  in: "query",
  required: false,
  rule: "ENDP-21",
  description:
    "Opaque, produced only by the Worker, never constructed by a caller. Absent from an answer at the end of the collection.",
  schema: { type: "string", minLength: 1 },
};

/** Every refusal any surface may give for a reason that is not its own (REG-3, ENDP-6, ENDP-24). */
const SHARED_REFUSALS: Refusal[] = [
  { status: 400, code: "unsupported_version", rule: "ENDP-6" },
  { status: 401, code: "unauthenticated", rule: "REG-3" },
  { status: 403, code: "forbidden", rule: "ENDP-29" },
  { status: 500, code: "internal_error", rule: "ENDP-29" },
  { status: 503, code: "unavailable", rule: "ENDP-29" },
];

const instant = {
  type: "string",
  format: "date-time",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
};

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
    path: "/.well-known/worker-protocol",
    title: "worker-protocol — the Descriptor",
    description:
      "The one route this protocol fixes, and the whole of what every Worker owes. Every other address is declared in the document this answers (ENDP-1).",
    operations: [
      {
        method: "get",
        summary: "Read the Descriptor",
        rule: "DESC-5",
        description:
          "Reading a Descriptor is a GET and changes nothing. REG-21 has the Worker accept the credential recorded for it here as on every other address.",
        parameters: [EXPECTED_VERSION],
        answers: [
          { status: 200, schema: "descriptor", rule: "DESC-1", description: "The Descriptor." },
        ],
        refusals: SHARED_REFUSALS,
      },
    ],
  },
  {
    document: "health",
    capability: "health",
    server: {
      variable: "address",
      rule: "HLTH-1",
      description:
        "The address the `health` entry declares, resolved per DESC-12 against the URL the Descriptor was read from.",
    },
    path: "/",
    title: "worker-protocol — health",
    description: "The answer to a poll: one status for the Worker and a map of named checks.",
    operations: [
      {
        method: "get",
        summary: "Poll health",
        rule: "HLTH-5",
        description:
          "Answers `200` whatever it reports. The status is read from the body, and a response that is not `200` means the Worker did not answer rather than that it is unwell — which is the one distinction a health surface exists to draw.",
        parameters: [EXPECTED_VERSION],
        answers: [
          {
            status: 200,
            schema: "health",
            rule: "HLTH-2",
            description: "One status and a map of named checks.",
          },
        ],
        refusals: SHARED_REFUSALS,
      },
    ],
  },
  {
    document: "metrics",
    capability: "metrics",
    server: {
      variable: "address",
      rule: "MET-1",
      description: "The address the `metrics` entry declares, resolved per DESC-12.",
    },
    path: "/",
    title: "worker-protocol — metrics",
    description:
      "Named quantities accumulated over declared periods. The Descriptor is the catalog: this surface answers values and never lists what exists (MET-2).",
    operations: [
      {
        method: "get",
        summary: "Read one metric",
        rule: "MET-8",
        description:
          "A read names one metric and answers one series. MET-18: a dimension a read neither fixes nor breaks down by is accumulated over, so an unfiltered answer is the total and never a slice the Worker chose.",
        parameters: [
          {
            name: "metric",
            in: "query",
            required: true,
            rule: "MET-8",
            description: "One of the metrics the entry declares. One not declared is `404`.",
            schema: { type: "string", minLength: 1 },
          },
          {
            name: "granularity",
            in: "query",
            required: false,
            rule: "MET-8",
            description:
              "Required where the metric declares more than one, and omittable where it declares exactly one.",
            schema: { type: "string", enum: ["hour", "day", "week", "month", "year"] },
          },
          {
            name: "from",
            in: "query",
            required: false,
            rule: "MET-11",
            description: "Inclusive. Absent, the start of the current bucket.",
            schema: instant,
          },
          {
            name: "to",
            in: "query",
            required: false,
            rule: "MET-11",
            description:
              "Exclusive — the interval is half-open, so two adjacent reads add up. Absent, the instant the Worker answers.",
            schema: instant,
          },
          {
            name: "by",
            in: "query",
            required: false,
            rule: "MET-19",
            description:
              "Break down by a dimension, and only by one that declared its set of values: over a free dimension nothing would bound the number of series.",
            schema: { type: "array", items: { type: "string", pattern: "^[A-Za-z0-9_-]+$" } },
            style: "form",
            explode: true,
          },
          {
            // MET-16 spells a dimension into a parameter of its own NAME, and those names are the
            // Worker's — read from its Descriptor and never fixed here. An exploded object is the
            // one shape OpenAPI has for that: `dimensions` is the parameter's name and never
            // travels, and what reaches the wire is `?taskType=verify-vehicle&tenant=acme`.
            //
            // Without it the most parameterised operation in this protocol would be the one an SDK
            // could not cover, and every language would invent its own escape hatch — which is
            // what `openapi/` exists to stop.
            name: "dimensions",
            in: "query",
            required: false,
            rule: "MET-16",
            description:
              "Each dimension the metric declares, fixed by a parameter named exactly as the dimension. The names are the Worker's own and are read from its Descriptor, so they are not enumerated here. A value outside a declared set is `400`; where a dimension declares no set, any string is accepted and may match nothing.",
            schema: { type: "object", additionalProperties: { type: "string" } },
            style: "form",
            explode: true,
          },
          CURSOR,
          EXPECTED_VERSION,
        ],
        answers: [
          {
            status: 200,
            schema: "metric-page",
            rule: "MET-14",
            description: "Buckets ascending by start, in the shared page envelope.",
          },
        ],
        refusals: [
          { status: 404, code: "not_found", rule: "MET-9" },
          { status: 400, code: "invalid_parameter", rule: "MET-10" },
          { status: 400, code: "unknown_filter", rule: "ENDP-24" },
          ...SHARED_REFUSALS,
        ],
      },
    ],
  },
  {
    document: "actions",
    capability: "actions",
    server: {
      variable: "address",
      rule: "ACT-1",
      description: "The address the `actions` entry declares, resolved per DESC-12.",
    },
    path: "/",
    title: "worker-protocol — actions",
    description:
      "Performing an operation a Worker accepts. The `configure` reading address of ACT-15 is not described here: its address is declared inside an Action rather than beside the Capability, and the document it answers is shaped by that Action's own input schema, which is the Worker's.",
    operations: [
      {
        method: "post",
        summary: "Perform an Action",
        rule: "ACT-5",
        description:
          "The body is the input and carries nothing else, so a console posts its form result verbatim and a Worker validates it against the schema it published with no envelope to unwrap.",
        parameters: [
          {
            name: "action",
            in: "query",
            required: true,
            rule: "ACT-5",
            description:
              "One of the Actions the entry declares. Naming none is `400`; naming one it does not declare is `404`.",
            schema: { type: "string", minLength: 1 },
          },
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            rule: "ENDP-15",
            description:
              "Where the Action declares it reads a key from the header. Within the declared window a repeat under the same key is not a second performance; the same key with a different body is `409`.",
            schema: { type: "string", minLength: 1 },
          },
          EXPECTED_VERSION,
        ],
        requestBody: {
          schema: null,
          rule: "ACT-2",
          description:
            "The Action's own input, against the JSON Schema its entry declares. This protocol has no data model, so no shape is fixed here.",
        },
        answers: [
          {
            status: 200,
            schema: null,
            rule: "ACT-10",
            description:
              "The Action completed and declares a result, against its own declared schema.",
          },
          {
            status: 204,
            schema: null,
            rule: "ACT-10",
            description: "The Action completed and declares no result.",
          },
          {
            status: 202,
            schema: null,
            rule: "ACT-11",
            description: "The Action declares that it does not complete within the call. No body.",
          },
        ],
        refusals: [
          { status: 400, code: "invalid_parameter", rule: "ACT-7" },
          { status: 400, code: "schema_mismatch", rule: "ACT-8" },
          { status: 400, code: "idempotency_key_required", rule: "ENDP-18" },
          { status: 404, code: "not_found", rule: "ACT-6" },
          { status: 409, code: "idempotency_key_reused", rule: "ENDP-17" },
          { status: 422, code: "unprocessable_content", rule: "ACT-9" },
          ...SHARED_REFUSALS,
        ],
      },
    ],
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
    path: "/",
    title: "worker-protocol — tasks, the reading address",
    description:
      "The Tasks whose conditions hold. TASK-6 answers only those the credential presented covers.",
    operations: [
      {
        method: "get",
        summary: "Read the open Tasks",
        rule: "TASK-5",
        description:
          "Listing a Worker's open Tasks does not consume them, which is why this is a GET and why the claim is not (ENDP-2, ENDP-3).",
        parameters: [
          {
            name: "type",
            in: "query",
            required: false,
            rule: "TASK-8",
            description:
              "One of the Task types the entry declares. A type it does not declare is `400`.",
            schema: { type: "string" },
          },
          CURSOR,
          EXPECTED_VERSION,
        ],
        answers: [
          {
            status: 200,
            schema: "task-page",
            rule: "TASK-5",
            description: "Tasks whose conditions hold, in the shared page envelope.",
          },
        ],
        refusals: [
          { status: 400, code: "invalid_parameter", rule: "TASK-8" },
          { status: 400, code: "unknown_filter", rule: "ENDP-24" },
          ...SHARED_REFUSALS,
        ],
      },
    ],
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
    path: "/",
    title: "worker-protocol — tasks, the claim address",
    description:
      "Claiming a Task, renewing a lease, and declaring an outcome. Everything here changes state, which is why it is a POST (ENDP-3).",
    operations: [
      {
        method: "post",
        summary: "Claim, renew, or close a Claim",
        rule: "TASK-9",
        description:
          "`task` claims; `claim` alone renews; `claim` with `outcome` closes. Closing a Claim never closes the Task, which closes when its condition stops holding and which nobody declares (TASK-15).",
        parameters: [
          {
            name: "task",
            in: "query",
            required: false,
            rule: "TASK-9",
            description:
              "The Task to claim, by the id TASK-7 carries. One already claimed, or one the Worker is not granting leases on, is `409`.",
            schema: { type: "string", minLength: 1 },
          },
          {
            name: "claim",
            in: "query",
            required: false,
            rule: "TASK-13",
            description:
              "The Claim to renew or close. One that is no longer the Task's current one is `409` — the Claim id is the fencing token, checked at write time rather than against a clock.",
            schema: { type: "string", minLength: 1 },
          },
          {
            name: "outcome",
            in: "query",
            required: false,
            rule: "TASK-14",
            description: "Closes the Claim. Absent with `claim`, the call renews instead.",
            schema: { type: "string", enum: ["done", "failed", "released"] },
          },
          EXPECTED_VERSION,
        ],
        answers: [
          {
            status: 200,
            schema: "claim",
            rule: "TASK-9",
            description: "The Claim granted, or the new expiry after a renewal.",
          },
          { status: 204, schema: null, rule: "TASK-14", description: "The Claim is closed." },
        ],
        refusals: [
          { status: 400, code: "invalid_parameter", rule: "TASK-14" },
          { status: 404, code: "not_found", rule: "ENDP-29" },
          { status: 409, code: "conflict", rule: "TASK-10" },
          ...SHARED_REFUSALS,
        ],
      },
    ],
  },
  {
    document: "alerts",
    capability: "alerts",
    server: {
      variable: "address",
      rule: "ALRT-1",
      description: "The address the `alerts` entry declares, resolved per DESC-12.",
    },
    path: "/",
    title: "worker-protocol — alerts",
    description:
      "Conditions an operator should see. An Alert ends when its condition stops holding and nobody dismisses one (ALRT-5), so there is no write here.",
    operations: [
      {
        method: "get",
        summary: "Read the Alerts whose conditions hold",
        rule: "ALRT-2",
        description:
          "ALRT-6 answers the same Alerts to every caller the Worker authenticates: the party an Alert is for is whoever operates the Worker, and that is enrollment rather than a Contract.",
        parameters: [CURSOR, EXPECTED_VERSION],
        answers: [
          {
            status: 200,
            schema: "alert-page",
            rule: "ALRT-2",
            description: "Alerts whose conditions hold, in the shared page envelope.",
          },
        ],
        refusals: [{ status: 400, code: "unknown_filter", rule: "ENDP-24" }, ...SHARED_REFUSALS],
      },
    ],
  },
];

/**
 * ENDP-25, ENDP-26 — the closed code vocabulary, with the status each code is answered with.
 *
 * `schemas/error.json` carries the code with its class, which is the half a schema can assert. The
 * status is not in the body, so it lived in a table in `spec/endpoints.md` that
 * `packages/conformance` parsed with a regular expression. It lives here now, and that table is a
 * reading aid — which is what makes this file normative for the surface rather than a convenience.
 */
export const CODES: {
  code: string;
  status: number;
  class: "reject" | "retry";
  condition: string;
}[] = [
  {
    code: "malformed_request",
    status: 400,
    class: "reject",
    condition: "A body that will not parse, or a content type that is not `application/json`.",
  },
  {
    code: "schema_mismatch",
    status: 400,
    class: "reject",
    condition: "A body that parses and does not match the schema the surface declared.",
  },
  {
    code: "invalid_parameter",
    status: 400,
    class: "reject",
    condition: "A parameter missing or malformed.",
  },
  {
    code: "unknown_filter",
    status: 400,
    class: "reject",
    condition: "A filter parameter the Worker does not recognize.",
  },
  {
    code: "unsupported_version",
    status: 400,
    class: "reject",
    condition: "A requested Capability version the Worker cannot answer.",
  },
  {
    code: "idempotency_key_required",
    status: 400,
    class: "reject",
    condition: "An Action requires a key and none was sent.",
  },
  {
    code: "unauthenticated",
    status: 401,
    class: "reject",
    condition: "No credential, or one the Worker cannot read.",
  },
  {
    code: "forbidden",
    status: 403,
    class: "reject",
    condition: "The credential is understood and does not carry the right.",
  },
  {
    code: "not_found",
    status: 404,
    class: "reject",
    condition: "No such address, or no such resource.",
  },
  {
    code: "request_timeout",
    status: 408,
    class: "retry",
    condition: "The request did not arrive in time to be answered.",
  },
  {
    code: "conflict",
    status: 409,
    class: "reject",
    condition: "The request conflicts with the current state.",
  },
  {
    code: "idempotency_key_reused",
    status: 409,
    class: "reject",
    condition: "A key reused with a different body.",
  },
  {
    code: "unprocessable_content",
    status: 422,
    class: "reject",
    condition: "Well-formed, schema-valid, and refused on the Worker's own rules.",
  },
  {
    code: "rate_limited",
    status: 429,
    class: "retry",
    condition: "Too many requests. Carries `Retry-After`.",
  },
  {
    code: "internal_error",
    status: 500,
    class: "retry",
    condition: "The Worker failed for its own reasons.",
  },
  {
    code: "upstream_error",
    status: 502,
    class: "retry",
    condition: "Something the Worker depends on answered badly.",
  },
  {
    code: "unavailable",
    status: 503,
    class: "retry",
    condition: "Starting, `unhealthy`, or a dependency down.",
  },
  {
    code: "upstream_timeout",
    status: 504,
    class: "retry",
    condition: "Something the Worker depends on did not answer in time.",
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
 *   event's data. Each is a JSON Schema a Worker declares in its Descriptor, and a generated client
 *   reads it from there — a second generator turning a LIVE Descriptor into a per-Worker document
 *   is listed in `docs/roadmap.md` and is not this.
 * - **A dimension named as a query parameter.** MET-16 spells a dimension into a parameter of its
 *   own name, and those names are the Worker's. A client sends what the Descriptor declared.
 */

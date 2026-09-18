/**
 * ENDP-25, ENDP-26 — the closed code vocabulary, with the status each code is answered with.
 *
 * `schemas/error.json` carries the code with its class, which is the half a schema can assert. The
 * status is not in the body, so it lived in a table in `spec/endpoints.md` that
 * `packages/conformance` parsed with a regular expression. It lives here now, and that table is a
 * reading aid — which is what makes the surface declaration normative rather than a convenience.
 *
 * This file carries data and imports nothing, deliberately: `generate-rules.ts` reads it from
 * source, and CI runs `rules:check` before any package is built, so an import of
 * `@worker-protocol/schemas` here would fail on a clean checkout. The class column therefore
 * restates what `rejectCodes` and `retryCodes` in that package already partition; `error.json`
 * and the verifier are what keep the two in step.
 *
 * `as const` is what makes `ErrorCode` a real union rather than `string`: a typo in a code is then
 * a compile error, which is the whole return on a closed vocabulary.
 */
export const CODES = [
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
] as const satisfies readonly {
  code: string;
  status: number;
  class: "reject" | "retry";
  condition: string;
}[];

export type ErrorCode = (typeof CODES)[number]["code"];

/** One row by its code: the status it fixes and the class it carries (ENDP-26). */
export const byCode = new Map<ErrorCode, (typeof CODES)[number]>(CODES.map((c) => [c.code, c]));

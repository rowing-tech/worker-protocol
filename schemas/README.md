# schemas

The JSON Schemas, and the normative artifact of this repository. Plain JSON with no dependency, so
that a worker in any language can read them.

They are **generated** from `packages/schemas` and versioned here on purpose: CI must regenerate
them and fail when what is committed differs. A generated artifact nobody compares is a claim
nobody verifies.

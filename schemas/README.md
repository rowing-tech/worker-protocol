# schemas

The JSON Schemas, and the normative artifact of this repository. Plain JSON with no dependency, so
that a worker in any language can read them.

They are **generated** from `packages/schemas` and versioned here on purpose: CI must regenerate
them and fail when what is committed differs. A generated artifact nobody compares is a claim
nobody verifies.

```
pnpm schemas:generate    write them from the Zod source
pnpm schemas:check       compare, and fail on any difference
```

The dialect is **JSON Schema 2020-12**, declared by the `$schema` of every file — a generated
artifact whose dialect is unstated is a claim nobody can check.

These files carry no version of their own. What versions them is the **edition** of the
specification, which [spec/descriptor.md](../spec/descriptor.md) defines and every Descriptor
declares. The version of `@worker-protocol/schemas` is a different number that moves for different
reasons and cannot be read off this one — see [packages](../packages/README.md).

## Identifiers, and what they do not promise

**No home has been chosen for these schemas, so each `$id` is a bare file name and every `$ref`
between them is relative.** Nothing is served at any URL, and no file here names a host.

A `$id` identifies; it does not have to resolve. Validation works whether or not anything is ever
published at one, and relative references resolve against a document's own location exactly as
they would against an absolute base. Reading a schema from this directory, or from a checkout, or
from a copy vendored into another project, all behave the same today.

If these are later published under a URL, one constant in `packages/schemas` becomes that base and
the host appears on each file's `$id` line and nowhere else. The cost of choosing is near zero
while nothing is published, no version is tagged and no consumer exists outside this repository,
and it rises at the first tag — so it is a decision that wants making before that tag, not after.

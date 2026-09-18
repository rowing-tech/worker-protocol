# fixtures

Documents this protocol either accepts or refuses, each one evidence for a named rule.

A fixture is one JSON file and carries everything needed to act on it, so that a verifier in any
language reads a directory and needs no manifest to keep in step with it:

```json
{
  "schema": "descriptor",
  "valid": false,
  "rule": "DESC-23",
  "why": "An edition written `0.01`. Leading zeros are refused so that one edition has one spelling.",
  "document": { "id": "worker-7f3a", "edition": "0.01", "capabilities": {} }
}
```

| Member | What it is |
|---|---|
| `schema` | The schema in [schemas/](../../schemas/) the document is judged against, named as its file is without `.json` |
| `valid` | Whether that schema accepts the document |
| `rule` | The rule in [spec/](../../spec/) this case is evidence for |
| `why` | What the case shows, in prose, for a reader deciding whether the fixture still earns its place |
| `document` | The document itself, exactly as it would travel |

**Every fixture names a rule, and that is the constraint that keeps this directory from growing into
a test suite.** A case that shows nothing a rule states is a case somebody will one day have to
decide about with no way to decide: it passes, it has always passed, and nobody knows what it would
mean if it stopped. Where a fixture is evidence for more than one rule it names the one it was
written for — the specification already cross-references, and duplicating that here would be a
second copy to keep in step.

The document is nested rather than being the whole file because the alternative is a second file
beside each one, or a manifest, and either is a pair that can disagree. What that costs is that a
fixture is not a document you can pipe straight into a validator; a reader takes one member first.

`valid: false` cases are the ones worth writing. A schema that accepts what it should accept is
usually true by construction — the document was written by somebody reading the schema — and the
question that matters is whether it refuses what it must refuse.
[error-class-contradicts-code.json](error-class-contradicts-code.json) is the clearest case: written
as one object with two independent members instead of the union the schema actually uses, that
document would validate cleanly, and a caller would back off and repeat a request that can never
succeed.

## What is not here yet

These cases judge a **document** against a **schema**, which is the half of conformance that needs
no Worker. The other half — a request, a status code, a header, an ordering — needs one answering
over HTTP, and [verifiability.md](../verifiability.md) records which rules that reaches and which it
does not.

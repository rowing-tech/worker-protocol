# packages

To be published under the npm scope `@worker-protocol`. They exist to make two things cheap:
complying, and proving that you comply.

| Package | What it is |
|---|---|
| `schemas` | `@worker-protocol/schemas` — the Zod objects that generate `schemas/`, so an implementer never retypes the specification |
| `conformance` | `@worker-protocol/conformance` — point it at a worker's base URL, get a report of what it complies with |

Both are derivable from the specification and verifiable against the fixtures. Convenience for an
implementer belongs here; behavior belongs in `spec/`.

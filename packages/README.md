# packages

To be published under the npm scope `@worker-protocol`. They exist to make two things cheap:
complying, and proving that you comply.

| Package | What it is |
|---|---|
| `schemas` | `@worker-protocol/schemas` — the Zod objects that generate `schemas/`, so an implementer never retypes the specification |
| `conformance` | `@worker-protocol/conformance` — point it at a worker's base URL, get a report of what it complies with |

Both are derivable from the specification and verifiable against the fixtures. Convenience for an
implementer belongs here; behavior belongs in `spec/`.

## A package version is not an edition

**These packages are versioned independently of the protocol, and neither number can be read off
the other.** A package version is SemVer and describes the package. An **edition** is DESC-23,
written `MAJOR.MINOR`, and describes the protocol. `@worker-protocol/schemas@2.4.1` says nothing
about which edition it encodes, and edition 1.3 says nothing about which package version to
install.

They are independent because they move for different reasons. A package needs a release when Zod
changes major, when a type is made more precise, when a build is fixed — none of which is a change
to the protocol, and all of which would otherwise force an edition nobody meant. In the other
direction, an edition can turn on a sentence in `spec/` that no schema expresses, and that release
would be a package version with nothing in it.

So **a package states which edition it encodes**, and that declaration is the only link between the
two numbers. Reading the package version instead is the mistake this section exists to prevent: it
is the kind that survives review and surfaces later, in a consumer's lockfile, as a schema that
does not mean what the code around it assumed.

The package's PATCH component keeps its ordinary SemVer meaning — a change with no effect on what
the package exports. It has no protocol meaning at all, which is the clearest illustration of the
two numbers being independent: the edition has no PATCH, because
[descriptor.md](../spec/descriptor.md) argues a specification has no use for a component that by
construction changes no verdict. One rule keeps the two honest: **a release that changes which
edition a package encodes is never a PATCH.**

Nothing declares an edition yet. `spec/` is `draft`, no version is tagged, and `0.1` appears in the
text only as an illustration of what a citation looks like — so `@worker-protocol/schemas` sits at
`0.0.0` and encodes no edition. The declaration lands when the first edition does.

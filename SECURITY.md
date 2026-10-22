# Security

How to report a weakness in this repository, what it covers, and what to expect back. The
deployment-side guidance — what a Worker author, a Tower operator and a consumer each owe — is in
[docs/security.md](docs/security.md); this file is only about reporting.

## What is in scope

- The five packages published to npm under `@worker-protocol/`: `schemas`, `hono`, `client`,
  `conformance` and `cloudflare`, at every version that still has an `edition-*` dist-tag.
- The normative artifacts: `spec/`, `schemas/` and `openapi/`. A rule that lets a conformant Worker
  be misread by a conformant client — a credential sent where it should not go, a refusal that
  hides a failure, a page that can be replayed — is a vulnerability in the protocol and is wanted
  here, even when no code is involved.
- The two example Workers in `examples/`. They are templates people copy, so an unsafe default
  there reaches every Worker built from them.
- The release pipeline in `.github/workflows/` and `scripts/`.

Out of scope: a Worker somebody built with these packages, a Control Tower product, and the
hosting underneath either. Report those to whoever runs them.

## How to report

Use GitHub's private vulnerability reporting on this repository: **Security → Report a
vulnerability**. It opens a private advisory that only the maintainers can read, and it is where a
fix, a CVE if one is warranted, and the credit are coordinated.

If that is not available to you, write to `<security contact — to be filled in by the
maintainers>`. Do not open a public issue or a pull request for a weakness that is still
unpatched.

Include what you can of: the package and version or the `spec/` rule id; a request and response,
or a fixture, that shows the problem; and what an attacker gains. A proof of concept against your
own Worker is welcome. Please do not test against Workers you do not operate.

## What to expect

- An acknowledgement within five working days.
- An assessment of whether it is a vulnerability, a conformance bug or a documentation gap, and
  which of the three it will be handled as.
- A fix in a patch release of every affected package that still carries an `edition-*` dist-tag,
  and a `CHANGELOG.md` entry that names the advisory once it is public. A fix that changes what a
  conformant Worker must do takes a new rule id and a withdrawal, as any rule change does.
- Credit in the advisory, unless you ask otherwise.

## Supported versions

| Version | Supported |
|---|---|
| The latest `0.x` minor on npm | Yes |
| An earlier `0.x` that still has an `edition-*` dist-tag | Security fixes only, where the fix does not require the newer edition |
| Anything older | No |

Until 1.0 a MINOR may break, as `README.md` says, so a security fix that needs the current
edition's shape ships only on the current line and the advisory says so.

## What the packages verify for you

A release is published from `.github/workflows/publish.yml` with npm provenance, so each tarball
carries an attestation naming the commit and the workflow that built it. Verify it before trusting
a tarball somebody hands you:

```
npm audit signatures
```

The pipeline that produces a release, and what a maintainer runs before tagging one, is described
in [packages/README.md](packages/README.md).

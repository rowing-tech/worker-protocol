# @worker-protocol/conformance

Point it at a Worker's base URL, get a report of what it complies with.

**worker-protocol is an open specification for Workers that can be seen, operated and given work by
people who did not build them.** HTTP and JSON Schema, no runtime. A *Worker* describes itself in a
Descriptor served at `/.well-known/worker-protocol` — the one address this protocol fixes — and
declares there which of its Capabilities it implements.

This is the tool that checks whether it does what it says. It is also how the name is earned: the
protocol is Apache-2.0, but a claim that something *speaks worker-protocol* is one this project
vouches for, and a report from here is what stands behind it.

## Run it

```
npx @worker-protocol/conformance https://fleet.example.com
```

```
worker-protocol-conformance <base-url> [options]

  --credential <token>  Presented as `Authorization: Bearer <token>`.
                        Prefer WORKER_PROTOCOL_CREDENTIAL: argv is visible to
                        every process on the machine, and a CI log often keeps it.
  --may-perform         Allow POSTs to Actions. Off by default: an Action is an
                        operation somebody's operators chose to expose, and a tool
                        pointed at a Worker to inspect it does not perform work on
                        it uninvited. Rules needing one report notExercised.
  --json                Write the report to stdout as JSON, and nothing else.
  -h, --help            This.

Exit: 0 nothing failed, 1 a rule failed, 2 the run could not be made.
```

Everything but `actions` is a read, and a read leaves the Worker as it found it. That is why
`--may-perform` is a decision you make rather than a default: the rules that need a POST report
`notExercised` with that as the reason until you do.

## From TypeScript

```ts
import { tally, verify } from "@worker-protocol/conformance";

const report = await verify({
  baseUrl: "https://fleet.example.com",
  credential: process.env.WORKER_PROTOCOL_CREDENTIAL,
  mayPerform: true,
  arrangement: {
    safeAction: { name: "answer-check", input: { vehicle: "ABC-123", reachable: true } },
    secondCredential: process.env.SECOND_CREDENTIAL,
  },
});

const counts = tally(report.results);
for (const { rule, verdict, detail } of report.results) {
  if (verdict === "fails") console.error(`${rule.id} (${rule.file}): ${detail}`);
}
```

**`verify()` runs in any runtime with a `fetch`** — Node, Bun, Deno, a Cloudflare Worker, a Vercel
edge function, a Convex action — so a Control Tower can verify the Workers it enrolls from inside
its own runtime. The library imports no Node built-in and reads no file: the rule universe is
compiled into the module, so a bundler that inlines the package leaves nothing behind. Only the
command line needs Node. This package's own suite runs `verify()` on workerd with no Node
compatibility enabled.

`verify` also takes a `fetch` of your own, for a test, for a caller that needs its own agent, or
for a Worker reached in-process through its `app.fetch` rather than over the network.

## The verdicts, and why there are five

A report covers **every** rule the edition defines, not only the ones a run exercised. A rule that
nothing claimed is not silence — it says under its own name why nothing claimed it.

| Verdict | What it means |
|---|---|
| `passes` | The check ran and the Worker satisfied it. |
| `fails` | The check ran and the Worker did not. Exit 1. |
| `notExercised` | The Worker declares no such Capability, or the check needs a Worker *arranged* to be observed and this one is not. A gap somebody can close. |
| `unverified` | The rule's subject is the Worker, and no party outside it can observe a violation. |
| `otherSubject` | The rule binds a verifier, a Control Tower, a consumer or an issuer — not a Worker. This tool never contacted whoever it obliges. |

`notExercised` never fails the run, and it is deliberately not the same word as `unverified`: they
read alike on a page and are opposite facts. A report that counted either as compliance would be
vouching for something nobody checked.

Each result carries the rule's id, the specification file that defines it, whether the rule is
`required` or `recommended`, and one line saying why for every verdict but `passes`. The ids are
fixed from edition 0.1 on: a rewrite that could change a verdict takes a new id and withdraws the
old, so a report stays true however long after it was produced somebody reads it.

## Arranging a Worker so more can be seen

Some rules have no ordinary witness: nothing a tool can do to an unarranged Worker will ever see a
violation. An Action that succeeds, an input refused on the Worker's own rules, a second credential
issued to the same holder, a Worker that started moments ago. The arrangement cannot come from the
protocol — putting test scaffolding into a Descriptor would make every Worker in the network carry
it — so it arrives the way the base URL and the credential do: out of band, from whoever set it up.

`arrangement` takes `safeAction`, `refusedInput`, `asyncAction`, `secondCredential`,
`consumerCredential`, `unprivilegedCredential`, `justStarted`, `replaceableSettings` and
`publishedEvent`. Anything not arranged reports `notExercised` naming what was missing.

## Editions

The verifier declares which edition it holds, and the report carries both that and what the Worker
declared. A verifier that does not hold the Worker's MAJOR verifies **nothing** and reports that it
is the one that is behind — rather than failing a Worker for a surface added after this tool was
built.

The rule universe travels inside this package, generated from the specification, and `universe()`
hands it back: the rules, the error codes, and the map from a place inside a document to the rule
that governs it — which is how a report names the obligation that was broken rather than
announcing that a document is invalid. It ships twice from one generation: compiled into the
library, and as `rules.json` for a reader outside JavaScript.

## What standing it has

**Nothing here carries behavior of its own.** Every check reports against a rule id, and a check
that observed something the specification does not require would be this package making the
standard. When this tool and the specification disagree, the specification is right and this is the
bug.

## Fixing what it reports, with a coding agent

```
npx skills add rowing-tech/worker-protocol --skill worker-protocol
```

An [Agent Skill](https://agentskills.io) carrying the protocol in any language: what each rule id
means, where its file is, the surface an implementer without an SDK writes by hand, and the gotchas
behind the failures this tool reports most. `--all` adds a second one for TypeScript on Hono.

## Related packages

- `@worker-protocol/schemas` — the Zod objects that generate the normative JSON Schemas.
- `@worker-protocol/hono` — `mount()`: implement an interface and get every address, header and
  refusal this protocol fixes.
- `@worker-protocol/client` — `consume()`: read a Worker, and take work from it.

## License and name

Apache-2.0, patent grant included — implement the protocol in any product, commercial or not,
without asking anyone. The name is not part of that grant (Apache-2.0 §6).

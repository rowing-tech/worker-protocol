---
name: worker-protocol-hono
description: >-
  Build or change a worker-protocol Worker in TypeScript with @worker-protocol/hono: write
  defineWorker({ id, authenticate, health, metrics, actions, alerts, activity, nudges, tasks,
  skills, events, logs }), let mount() carry every address, header, envelope, refusal, cursor and
  bucket boundary the specification fixes, then run app.fetch on Cloudflare Workers, Vercel edge,
  Deno Deploy, Node or Bun. Use this skill whenever the work touches a Worker in TypeScript —
  declaring an Action with action(), wiring an outcome store for idempotency, adding a Capability,
  serving logs from a store, mounting on Hono, or when tsc complains about a member of the Worker
  type — and whenever somebody asks how to expose health, metrics, alerts or tasks over HTTP from a
  TypeScript service. Load the worker-protocol skill first for the rules themselves.
license: Apache-2.0
metadata:
  workerProtocolEdition: "0.2"
  version: "2.0.0"
---

# Workers on `@worker-protocol/hono`

`mount()` writes everything the protocol fixes: the addresses, both headers, the credential check,
the error envelope, the page envelope with its cursor and cap, the refusals, the bucket boundaries
cut in a declared time zone, the idempotency window, and the JSON Schema the Descriptor carries.

What is left is what only the Worker knows. Declaring all nine Capabilities is about 175 lines of
domain; growing much past that means a rule `mount()` already carries is being re-derived.

**Load the `worker-protocol` skill first** for the rules, the ids and the Capability-choosing table.
Deciding which Capability a fact belongs on comes before writing the member for it, because consoles
get built against where it went.

## Start here

1. `npm i @worker-protocol/hono hono zod` — `hono` and `zod` are peer dependencies, and two copies
   of Zod make the Worker's `z.object()` and the package's disagree about what a schema is.
2. Decide which Capabilities this Worker implements. Omit the rest entirely: a member left out is an
   address not served, and this interface cannot produce a Descriptor that declares what it does not
   serve (DESC-18).
3. Name the Worker, and every Task type, event type and metric, under the team's DNS name (NAME-8).
4. If any Action declares `idempotency`, build the outcome store once at module scope — see the
   gotcha below, which is the mistake this package exists to catch.
5. Write the Worker as a builder:
   `export const worker = defineWorker<Env>((env) => ({ id, authenticate, ...members }))`. Declare
   every Action input, Task payload, Skill payload and event `data` as a Zod object.
6. `export const app = mount(worker)`, then hand `app.fetch` to the platform:
   `export default { fetch: app.fetch }` on Cloudflare, Vercel edge and Deno Deploy;
   `serve({ fetch: app.fetch })` on Node, Bun and Deno.
7. Verify: `npx @worker-protocol/conformance <base-url>`. Fix by rule id.

Read `references/members.md` for the signature of each member, and
`node_modules/@worker-protocol/hono/README.md` for a complete Worker that compiles.

## Gotchas this package adds

- **Write the Worker as a builder, not an object.** Bindings and secrets arrive per request on
  Cloudflare, Vercel edge and Deno Deploy, and are ambient only on Node and Bun, so a Worker built
  at module scope cannot reach a database or a durable object at all. `defineWorker` returns its
  argument unchanged; its whole job is to report a mistake on the member it was written on, rather
  than at the `mount()` call about a type nested six levels deep.
- **The builder runs on every request**, the Tower's polls included. Cache what it reads from a
  store in module scope — on an isolate runtime that is a cache and not durable state, which is
  right. What it *declares* may not differ between callers (REG-8).
- **An Action with `idempotency` needs `actions.outcomes`, built outside the builder** (ENDP-16).
  Built inside, a new store is made per request and forgets what the last one recorded, so every
  retry performs the work again while the caller believes it is protected. `memoryOutcomes()` is
  correct in one long-lived process only; anywhere horizontally scaled, back it with a durable
  object, KV or a table. `mount()` reports both mistakes by name — treat that warning as a failure.
- **Declare each Action with `action({ input, run })`**, not as a bare object. `action()` infers
  `run`'s parameter from the Zod object beside it; a record annotated by hand makes it `unknown` and
  the shape gets written twice, which is two declarations that can disagree silently.
- **`run` never chooses a status.** Return the result for `200`, `undefined` for `204` (ACT-10), or
  `{ code: "unprocessable_content", message }` for input that is schema-valid and the Worker's own
  rules refuse (ACT-9). Every other refusal belongs to `mount()`.
- **One Zod object is used twice**: `mount()` generates the JSON Schema the Descriptor carries from
  it and validates incoming requests against the same object. Never write that JSON Schema by hand
  beside it.
- **`metrics.read` is handed buckets already cut** in the declared time zone — do not cut them
  again. Answer `{ start, value }` for each bucket there is a number for, omitting the rest
  (MET-15).
- **`logs.read` is a read the Worker performs, not a list it hands over.** `alerts` and `activity`
  hand over everything they hold and `mount()` pages it; a feed is not bounded by what is happening
  now, so only the store holding it can filter and page it. `mount()` decodes the level floor into
  `levels` (in order, lowest first), the half-open interval, the instant's format, the refusals and
  the envelope. The order (LOG-3) and the cursor (ENDP-33) stay with the store — key the cursor on
  something that only grows and both are free.
- **Nothing `mount()` serves records why the Worker died**, because by then it is not running. On
  Cloudflare, add a Tail Worker: bind the producer's Durable Object with `script_name`, write an
  uncaught exception and a non-`ok` outcome into it, discard `event.logs`. It writes to the store,
  never through this app, and declares no Capability of its own.
  `examples/fleet-worker/src/tail.ts` is one.

## What `mount()` carries, and what is still owed

| `mount()` writes it, the same in every Worker | The Worker writes it, because only it knows |
|---|---|
| The Descriptor, every address, the edition, both headers | `id`, and which Capabilities exist |
| `Authorization: Bearer` everywhere, `401` and `403` | `authenticate(token)` → accepted / unauthenticated / forbidden |
| The error envelope, every code with its status and class | An `unprocessable_content` refusal from `run` |
| Page envelope, cursor, cap, order, unknown-filter refusal | Which Tasks, Alerts and activities exist right now |
| Metric parameters, half-open intervals, buckets in the zone | The value in each bucket |
| Input validation, and the JSON Schema in the Descriptor | The Zod object, and what `run` does |
| Key required, repeat replayed, key reused with another body | Where outcomes are recorded (`actions.outcomes`) |
| Nudge body shape, `404` for an undeclared Skill, `204` | What to do when told there is work |

## Reference

- `references/members.md` — every member of the `Worker` type with its signature, and the helpers
  the package also exports.
- **A complete Worker that compiles** — `node_modules/@worker-protocol/hono/README.md`, under
  "A Worker". Start from it rather than from a blank file.
- **The interface, each member citing the rule it carries** —
  `node_modules/@worker-protocol/hono/dist/worker.d.ts`, with `actions.d.ts`, `tasks.d.ts`,
  `metrics.d.ts` and `logs.d.ts` beside it. Read the one for the Capability being declared.
- **The consumer half** — `@worker-protocol/client`: `consume()` reads a Worker and takes work from
  it, with no web framework. A Tower, a console, or a Worker that answers another's Tasks is built
  on it.
- **Worked examples** — `examples/minimal-worker/src/worker.ts` for all nine Capabilities explained
  line by line, and `examples/fleet-worker` for the same Worker on Cloudflare with a Durable Object,
  an outbox and a Tail Worker. Both at https://github.com/rowing-tech/worker-protocol.
- **The rules themselves** — the `worker-protocol` skill, and `spec/` behind it.

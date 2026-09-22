---
name: worker-protocol-hono
description: >-
  Build a worker-protocol Worker in TypeScript with @worker-protocol/hono. You write
  defineWorker({ id, authenticate, health, metrics, actions, alerts, activity, nudges, tasks,
  skills, events }) and mount() carries every address, header, envelope, refusal, cursor and
  bucket boundary the specification fixes; then app.fetch runs on Cloudflare, Vercel edge, Deno
  Deploy, Node or Bun. Use when writing or changing a Worker in TypeScript, declaring an Action
  with action(), wiring an outcome store for idempotency, mounting on Hono, or when tsc complains
  about a Worker member. Load the worker-protocol skill first for the rules themselves.
license: Apache-2.0
metadata:
  workerProtocolEdition: "0.1"
  version: "1.0.0"
---

# Building a Worker on `@worker-protocol/hono`

**Load the `worker-protocol` skill first.** It carries the protocol: the Descriptor, the
Capabilities, the rules and their ids, and the gotchas that hold in every language. This one is the
TypeScript layer only — what that package writes for you, and what you still write.

You declare what only the Worker knows: who it is, whether a credential is good, how it is doing,
which conditions hold, how much of something happened, what an Action does. `mount()` writes the
rest. A Worker declaring all eight Capabilities is about 140 lines of domain; growing much past that
means re-deriving a rule `mount()` already carries.

## Gotchas — the ones this package adds

- **Write the Worker as a builder: `defineWorker<Env>((env) => ({ ... }))`.** Bindings and secrets
  arrive per request on Cloudflare, Vercel edge and Deno Deploy and are ambient only on Node and
  Bun; a Worker built at module scope cannot reach a database or a durable object at all. The
  builder form runs everywhere. `defineWorker` returns its argument — its whole job is to report a
  mistake on the member you wrote it on, instead of at the `mount()` call about a type six levels
  deep.
- **The builder runs on EVERY request**, the Tower's polls included. Cache what it reads from a
  store, in module scope — on an isolate runtime that is a cache and not durable state, which is
  exactly right. And what it *declares* may not differ between callers (REG-8).
- **Declare each Action with `action({ input, run })`**, not as a bare object. `action()` infers
  `run`'s parameter from the Zod object above it; a record annotated by hand makes it `unknown` and
  you write the shape a second time, which is two declarations that can disagree silently.
- **`run` never chooses a status.** Return the result for `200`, `undefined` for `204` (ACT-10), or
  `{ code: "unprocessable_content", message }` for input that is schema-valid and your rules refuse
  (ACT-9). Every other refusal is `mount()`'s.
- **Any Action with `idempotency` needs `actions.outcomes`, built OUTSIDE the builder** (ENDP-16).
  Built inside, a new store is made per request and forgets what the last one recorded, so every
  retry performs the work again while the caller believes it is protected. `memoryOutcomes()` is
  correct in one long-lived process only; on Cloudflare or anything horizontally scaled, back it
  with a durable object, KV or a table. `mount()` reports both mistakes by name — treat that
  warning as a failure.
- **`hono` and `zod` are peer dependencies.** Install them yourself. Two copies of Zod make your
  `z.object()` and the package's disagree about what a schema is, and the error names two
  declarations that look identical.
- **One Zod object is used twice**: `mount()` generates the JSON Schema the Descriptor carries from
  it, and validates incoming requests against the same object. Never write the JSON Schema by hand
  beside it.
- **`metrics.read` is handed buckets already cut** in the time zone the entry declares — do not cut
  them yourself. Answer `{ start, value }` per bucket you have a number for, omitting the rest
  (MET-15).
- **A Capability you do not implement is a member you leave out**, and its address is then not
  served. This interface cannot produce a Descriptor that declares what it does not serve (DESC-18).

## Procedure

1. `npm i @worker-protocol/hono hono zod`.
2. Decide which Capabilities this Worker implements; omit the rest entirely.
3. Name the Worker and every Task type, event type and metric under your team's DNS name (NAME-8).
4. If any Action declares `idempotency`, build the outcome store once at module scope.
5. Write `export const worker = defineWorker<Env>((env) => ({ id, authenticate, ...members }))`.
   Declare every Action input, Task payload, Skill payload and event `data` as a Zod object.
6. `export const app = mount(worker)`, then hand `app.fetch` to the platform:
   `export default { fetch: app.fetch }` on Cloudflare, Vercel edge and Deno Deploy;
   `serve({ fetch: app.fetch })` on Node, Bun and Deno.
7. Run it and verify: `npx @worker-protocol/conformance <base-url>`. Fix by rule id.

## What `mount()` carries and what you owe

| `mount()` writes, once, the same in every Worker | You write, because only the Worker knows it |
|---|---|
| The Descriptor, every address, the edition, both headers | `id`, and which Capabilities exist |
| `Authorization: Bearer` on every address, `401` and `403` | `authenticate(token)` → accepted / unauthenticated / forbidden |
| Error envelope, every code with its status and class | An `unprocessable_content` refusal from `run` |
| Page envelope, cursor, cap, order, unknown-filter refusal | Which Tasks, Alerts and Activities exist right now |
| Metric parameters, half-open intervals, buckets in your zone | The value in each bucket |
| Input validation, and the JSON Schema in the Descriptor | The Zod object, and what `run` does |
| Key required, repeat replayed, key reused with another body | Where outcomes are recorded (`actions.outcomes`) |
| Nudge body shape, `404` for an undeclared Skill, `204` | What to do when told there is work |

## The members

Beside `id`, and not a Capability:

- `skills: { [type]: { payload?, produces? } }` — the Task types this Worker answers: what it needs
  to receive, and what it hands back (TASK-31).
- `authenticate: (token) => "accepted" | "unauthenticated" | "forbidden"`, or a promise of one.
- `edition?` — only to pin the edition you verified against; otherwise the package's.

The eight Capabilities:

- `health: () => ({ status, checks })` — one status, named checks beneath it.
- `metrics: { timeZone, publishes, read({ metric, granularity, buckets, fixed, by }) }`.
- `actions: { accepts, settings?, outcomes? }` — each entry of `accepts` is
  `action({ input, result?, idempotency?, completesWithinCall?, run })`.
- `alerts: () => Alert[]` — `{ id, severity: "warning" | "critical", since, summary, actions }`.
- `activity: () => Activity[]` — `{ id, state, since, summary }`, state being `scheduled`,
  `pending` or `running`.
- `nudges: (type) => void` — note the type and read the work sooner.
- `tasks: { raises: { [type]: { payload, answeredBy } }, current(), covers?, pageSize? }`.
- `events: { broker, protocolBinding, destination, publishes: { [type]: { data } },
  republishWindowSeconds? }` — a declaration only; no address is served.

## Also exported

`jsonSchema()` for a schema you need in hand; `CODES` and `ErrorCode` for the refusal vocabulary;
`bucketsIn`, `startOf`, `endOf`, `rfc3339` for metric boundaries; and the route objects
(`readDescriptor`, `pollHealth`, `readMetric`, `performAction`, `readTasks`, `readAlerts`,
`readActivity`) that `openapi/` is generated from.

## Where the detail is

Load these when you need them. The first three are on disk after `npm i`.

- **A complete Worker that compiles** — `node_modules/@worker-protocol/hono/README.md`, under
  "A Worker". Start from it.
- **The interface, each member citing the rule it carries** —
  `node_modules/@worker-protocol/hono/dist/worker.d.ts`, with `actions.d.ts`, `tasks.d.ts` and
  `metrics.d.ts` beside it. Read the one for the Capability you are declaring.
- **The consumer half** — `@worker-protocol/client`: `consume()` reads a Worker and takes work from
  it, with no web framework. A Tower, a console or a Worker that answers another's Tasks is built
  on it.
- **All eight Capabilities, explained line by line** —
  https://github.com/rowing-tech/worker-protocol/blob/main/examples/minimal-worker/src/worker.ts —
  and the same Worker on Cloudflare with a Durable Object in `examples/fleet-worker`.
- **The rules themselves** — the `worker-protocol` skill, and `spec/` behind it.

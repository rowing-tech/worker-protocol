# @worker-protocol/hono

The protocol's surface as Hono routes, and `mount()`: implement an interface, and get every address,
header, envelope and refusal worker-protocol fixes.

**worker-protocol is an open specification for Workers that can be seen, operated and given work by
people who did not build them.** HTTP and JSON Schema, no runtime. A *Worker* describes itself in a
Descriptor served at `/.well-known/worker-protocol` — the one address this protocol fixes — and
declares there which of its Capabilities it implements: `health`, `metrics`, `actions`, `alerts`,
`activity`, `nudges`, `tasks`, `events`. Any combination is allowed, including none.

This package is what makes complying cheap. You write what your Worker *is* — what it knows how to
do, what it counts, which conditions hold, what it is working on — and `mount()` writes the rest,
once, the same way in every Worker.

## Install

```
npm i @worker-protocol/hono hono zod
```

`hono` (`^4.13.7`) and `zod` (`^4.5.4`) are peer dependencies, so your app and this package share
one instance of each.

## A Worker

```ts
import { action, defineWorker, memoryOutcomes, mount, type OpenTask } from "@worker-protocol/hono";
import * as z from "zod";

const SILENT_VEHICLE = "tech.rowing.fleet.check-silent-vehicle";

const silent = new Map<string, Date>();
const checked = new Set<string>();

// Where a repeat under one idempotency key finds the outcome the first call recorded. Built out
// here, not inside the Worker below: that is answered per request, and a store built there would
// forget what the last one recorded while the caller believed the repeat was protected.
const outcomes = memoryOutcomes();

export const fleetWorker = defineWorker<{ CREDENTIAL?: string }>((env) => ({
  // Not the URL, and not derived from it: moving this Worker to another host must not make it
  // another Worker.
  id: "tech.rowing.fleet.watcher",

  authenticate: (token) => (token === env.CREDENTIAL ? "accepted" : "unauthenticated"),

  health: () => ({
    status: silent.size > 100 ? "degraded" : "healthy",
    checks: { store: { status: "healthy", detail: `${silent.size} vehicles tracked` } },
  }),

  actions: {
    outcomes,
    accepts: {
      "answer-check": action({
        input: z.object({ vehicle: z.string().min(1), reachable: z.boolean() }),
        result: z.object({ recordedAt: z.string() }),
        // A repeat under the caller's key replays the first answer instead of doing the work
        // again, against the store named above.
        idempotency: { required: true, from: "header", windowSeconds: 3600 },
        run: ({ vehicle }) => {
          checked.add(vehicle);
          return { recordedAt: new Date().toISOString() };
        },
      }),
    },
  },

  tasks: {
    // What this Worker sends with a Task of this type, and the one operation of its own that
    // answers it. Whoever does the work never has to be told where to send the answer.
    raises: {
      [SILENT_VEHICLE]: {
        payload: z.object({ vehicle: z.string() }),
        answeredBy: "answer-check",
      },
    },
    // The condition, and the whole of what this Worker owes. A Task exists while its vehicle is
    // quiet and unchecked, and it stops existing when that stops being true: nobody closes one,
    // so nothing here can be left open by a consumer that crashed.
    current: (): OpenTask[] =>
      [...silent.entries()]
        .filter(([vehicle]) => !checked.has(vehicle))
        .map(([vehicle, since]) => ({ id: `silent:${vehicle}`, type: SILENT_VEHICLE, payload: { vehicle }, since })),
  },
}));

export const app = mount(fleetWorker);
```

`app` is an `OpenAPIHono`, so `app.fetch` is what every platform wants: `export default { fetch:
app.fetch }` on Cloudflare, Vercel edge and Deno Deploy; `serve({ fetch: app.fetch })` on Node, Bun
and Deno. Writing the Worker as a function of its environment is what makes the same file run in all
of them — bindings and secrets arrive per request on an edge platform and are ambient on a server,
and a Worker that reads them at module scope works in one place only.

## What `mount()` carries, so your Worker does not

- Every address, derived from the Capabilities you declared, and the Descriptor that publishes them.
- The Descriptor itself, including the JSON Schema of each Action's input and each Task type's
  payload, written from the Zod objects you handed in — so what a console renders a form from and
  what your Worker accepts cannot drift apart.
- The error envelope and which code answers which refusal, the difference between a `reject` a
  caller must not repeat and a `retry` it should.
- The page envelope, its cursor and the order a page is returned in.
- Metric bucket boundaries, cut in the time zone your Worker declared.
- The idempotency window: a repeat under a key replays the recorded outcome instead of performing
  the work twice.
- Authentication, as `Authorization: Bearer <token>` on every address, answered by your
  `authenticate`; and the refusal of a Nudge for a Task type you declare no Skill for.

What it never does is anything the specification leaves to you: what a Task's condition is, what an
Action does, what a number means.

## Also exported

`action()` and `jsonSchema()` for declaring an Action; `memoryOutcomes()` as an outcome store for a
single long-lived process (an edge deployment wants a durable one — a `Map` per isolate has the same
problem one step further out); `CODES` and `ErrorCode`; `bucketsIn`, `startOf`, `endOf`, `rfc3339`
for metric boundaries; and the route objects themselves — `readDescriptor`, `pollHealth`,
`readMetric`, `performAction`, `readTasks`, `readAlerts`, `readActivity` — which are the declaration
the protocol's OpenAPI documents are generated from.

Types: `Worker`, `Activity`, `Alert`, `Answer`, `Refusal`, `SkillDeclaration`, `OpenTask`,
`TaskFacts`, `TaskTypes`, `MetricFacts`, `MetricQuery`, `MetricSample`, `Bucket`, `ActionFacts`,
`ActionDeclarations`, `OutcomeStore`, `Reservation`, `Recorded`, `WorkerSource`, `WorkerBuilder`,
`ExecutionCtx`.

## What standing this package has

**Nothing in it carries behavior of its *own*.** What is forbidden is a package doing something the
specification does not say — that is how a package becomes the standard and the text starts to rot.
What is wanted is a package carrying everything the specification *does* say, because the
alternative is every Worker author deriving the same rules again and the ones who get a detail wrong
being non-conformant in a way only a verifier ever finds. Every line here cites the rule id it
carries. If `mount()` does something no rule requires, that is the bug.

What vouches for it is not this README: it is `@worker-protocol/conformance` run against a Worker
built on it.

## Writing one with a coding agent

```
npx skills add rowing-tech/worker-protocol --all
```

Two [Agent Skills](https://agentskills.io): `worker-protocol` carries the rules and their ids, and
`worker-protocol-hono` carries this package — what `mount()` writes, what you still owe, and the
mistakes that cost a conformance failure. Every rule id they cite is checked against the verifier's
own universe in CI, so neither teaches a rule the specification has withdrawn.

## Related packages

- `@worker-protocol/schemas` — the Zod objects that generate the normative JSON Schemas.
- `@worker-protocol/client` — `consume()`: read a Worker, and take work from it. A consumer is not a
  server and installs no web framework.
- `@worker-protocol/conformance` — point it at a Worker's base URL, get a report of what it complies
  with.

## License and name

Apache-2.0, patent grant included — implement the protocol in any product, commercial or not,
without asking anyone. The name is not part of that grant (Apache-2.0 §6): a claim that something
*speaks worker-protocol* is one this project vouches for, and the conformance tool is how it is
earned.

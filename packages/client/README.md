# @worker-protocol/client

Read a Worker, and take work from it. The consumer half of worker-protocol.

**worker-protocol is an open specification for Workers that can be seen, operated and given work by
people who did not build them.** HTTP and JSON Schema, no runtime. A *Worker* describes itself in a
Descriptor served at `/.well-known/worker-protocol` — the one address this protocol fixes — and
declares there which of its Capabilities it implements and at which addresses.

`consume(url)` reads that document once, resolves every address the Worker declared, and answers an
object with one member per Capability that Worker implements — and nothing for the ones it does not.
A console, a Control Tower, a teams app or a Worker that answers another Worker's Tasks is built on
this.

It depends on `@worker-protocol/schemas` and on `fetch`, and on nothing else. **A consumer is not a
server**, so nothing here asks you to install a web framework in order to make HTTP requests.

## Install

```
npm i @worker-protocol/client zod
```

`zod` is a peer dependency (`^4.5.4`), shared with `@worker-protocol/schemas`.

## Reading a Worker

```ts
import { consume } from "@worker-protocol/client";

const worker = await consume("https://fleet.example.com", { credential: process.env.TOKEN });

worker.descriptor; // the document itself, validated
worker.edition; // the edition this Worker declares it speaks

// Each of these is present only where the Worker declared the Capability.
const health = await worker.health?.();
const alerts = await worker.alerts?.();
const activity = await worker.activity?.();

const buckets = await worker.metrics?.read("vehicles.quiet", {
  granularity: "day",
  from: new Date("2026-09-01T00:00:00Z"),
  by: ["region"],
});

// What the Worker recorded, most recent first, from the window it still holds.
const records = await worker.logs?.read({ level: "warn", from: new Date("2026-09-23T00:00:00Z") });
```

Paging, the cursor, the ordering, the retry that must not happen on a refusal the caller cannot fix,
and the classification of an answer that cannot be read are all carried here. Nine of the rules this
package implements oblige a *consumer* rather than a Worker, and a consumer that wrote this itself
would be deriving every one of them again.

## One page at a time

Every list above reads to the end of the collection. Beside each is `page()`, which answers one
page and the cursor for the next — for a caller whose work is cut into invocations, a scheduled
function or a serverless action, and which keeps the cursor in its own store between them:

```ts
const first = await worker.logs?.page({ level: "warn" });
// ... store first.nextCursor, and in a later invocation:
const next = await worker.logs?.page({ level: "warn", cursor: storedCursor });
```

`worker.alerts?.page()`, `worker.activity?.page()`, `worker.tasks?.page({ type })` and
`worker.metrics?.page(metric, options)` are the same call. `nextCursor` is absent at the end. The
cursor goes back exactly as it arrived and is never built here (ENDP-21), and a Worker that will not
honour it — a deploy since, or simply one that never promised to — answers a refusal that throws
`Refused` with `kind: "reject"`. Start the reading again from the top.

**A cursor continues one reading. It does not find what is new since the last poll, and nothing in
this package does.** The specification gives no cursor that points forward and gives a log record
no identity, so that is the caller's to work out:

- **`logs`** is answered most recent first (LOG-3), so a cursor walks towards *older* records and a
  cursor kept from the last poll reaches nothing written since. Read again from the head with
  `from` set to the newest instant you hold (LOG-8, inclusive), and drop the records at that instant
  you already have. A record carries an instant, a level, a message and perhaps fields, and nothing
  else (LOG-4), so two identical lines recorded at the same instant cannot be told apart.
- **`tasks`, `alerts` and `activity`** are what holds *now*, derived on every read: each ends when
  its condition stops holding, and a new one can sort anywhere in the order. Read the whole list
  and compare it by `id` with what you stored last time.

A cursor has no lifetime this protocol states, and ENDP-21 is what keeps it opaque, so none of that
can be done by holding on to one.

## Taking work

A Task is work a Worker needs somebody to do. Nobody is assigned one and nobody closes one: it
exists while its condition holds and it is gone when that stops being true.

```ts
const open = await worker.tasks?.list();

for (const task of open ?? []) {
  // How to answer this type: the Action to post, and the JSON Schema of what it takes. Both are
  // read out of the Descriptor you already hold — the Task itself says nothing about how to answer
  // it, because that belongs to the Worker that raised it.
  const answer = worker.tasks?.answers(task.type);
  if (answer === undefined) continue;

  const input = doTheWork(task.payload);
  await worker.actions?.perform(answer.action, input, { idempotencyKey: crypto.randomUUID() });
}
```

The schema comes back as it travels, so a console can render a form from it and an agent can build
the document, neither having been told anything about this Worker in advance. Where a Task can end
several ways, that schema is a discriminated union and each ending is a variant.

`worker.nudges?.(type)` tells a Worker there is work of a type it answers. It buys latency and
nothing else — a consumer reading on its own schedule is slower and never wrong — so it answers
nothing and is safe to lose.

## When a call does not succeed

| Thrown | What happened |
|---|---|
| `Refused` | The Worker answered a refusal, and it carries the code. A `reject` is not repeated; a `retry` already was, with backoff, before you saw this. |
| `Malformed` | The Worker answered something this protocol does not admit, naming the rule it broke. |
| `Unserved` | The Worker declared an address that serves nothing there. |

Retries and their backoff are `retries` and `backoffMs` on the options, and default to three
attempts from 200ms. A credential is presented as `Authorization: Bearer <token>` and is never sent
to an origin the Descriptor did not record as the Worker's own.

## Before any work changes hands

```ts
import { canAnswer } from "@worker-protocol/client";

const { verdict, why } = canAnswer(owner.descriptor, answerer.descriptor, taskType);
```

A Worker declares its *Skills*: the Task types it can answer, what it needs to be handed to answer
one, and what it produces. `canAnswer` compares that against what the owner sends and what the
owner's answering Action takes, in both directions, and answers `compatible`, `incompatible` or
`unknown` with a reason. `unknown` is not `false`: an answerer that declares the Skill and states no
requirement has claimed the capability and said nothing about what it needs, which the protocol
allows, and reporting that as a refusal would be inventing an obligation.

## Strict about what this protocol fixes, blind to what it does not

Every document the protocol's schemas describe is validated, and a Worker that answers something
else raises `Malformed` naming the rule. A Task's payload, an Action's input and result, an event's
data are the Worker's own — this protocol has no data model — and nothing here looks inside them.

## Related packages

- `@worker-protocol/schemas` — the Zod objects that generate the normative JSON Schemas.
- `@worker-protocol/hono` — the other half: `mount()`, for building a Worker on Hono.
- `@worker-protocol/conformance` — point it at a Worker's base URL, get a report of what it complies
  with.

## License and name

Apache-2.0, patent grant included — implement the protocol in any product, commercial or not,
without asking anyone. The name is not part of that grant (Apache-2.0 §6): a claim that something
*speaks worker-protocol* is one this project vouches for, and the conformance tool is how it is
earned.

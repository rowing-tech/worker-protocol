# @worker-protocol/schemas

The Zod objects that generate the worker-protocol JSON Schemas, and the way to consume them from
TypeScript.

**worker-protocol is an open specification for Workers that can be seen, operated and given work by
people who did not build them.** HTTP and JSON Schema, no runtime. A *Worker* is any process that
does work on its own — a Cloudflare Worker, an Azure Function, a Convex app, a cron job in Python
over Postgres — and it describes itself in a Descriptor served at `/.well-known/worker-protocol`,
which is the one address this protocol fixes. Everything else is declared in that document.

The JSON Schemas are the normative artifact of that specification: they say what a request and a
response carry, and the prose defers to them. The objects in this package are the source those
schemas are generated from, so anyone validating or typing one of those documents works from the
same line the specification was published from, rather than retyping it and drifting.

## Install

```
npm i @worker-protocol/schemas zod
```

`zod` is a peer dependency (`^4.5.4`) so that your project and this package share one instance:
`z.infer` against an object from somewhere else is a type that does not match.

## Reading a document somebody served you

```ts
import { descriptor, EDITION } from "@worker-protocol/schemas";
import type * as z from "zod";

export type Descriptor = z.infer<typeof descriptor>;

const response = await fetch(new URL(".well-known/worker-protocol", baseUrl));
const worker: Descriptor = descriptor.parse(await response.json());

// DESC-23: the edition this Worker speaks. A reader that does not hold its MAJOR reads nothing
// and says so, rather than failing a Worker for a surface added after the reader was built.
if (worker.edition.split(".")[0] !== EDITION.split(".")[0]) {
  throw new Error(`this reader holds edition ${EDITION}; the Worker declares ${worker.edition}`);
}

for (const [name, entry] of Object.entries(worker.capabilities)) {
  console.log(name, entry.address);
}
```

Every document this protocol defines is here and parses the same way: `health`, `error`, the page
envelope, a metric bucket, a Task, an Alert, an Activity, a Nudge.

## What is exported

| Group | Objects |
|---|---|
| The Descriptor | `descriptor`, `capabilityEntry`, `skillDeclaration`, `healthEntry`, `metricsEntry`, `actionsEntry`, `tasksEntry`, `alertsEntry`, `nudgesEntry`, `activityEntry`, `eventsEntry` |
| Names and addresses | `capabilityName`, `vendorCapabilityName`, `qualifiedName`, `address` |
| Health | `health`, `healthCheck`, `healthStatus` |
| Refusals and paging | `error`, `rejectCodes`, `retryCodes`, `page` |
| Metrics | `metricDeclaration`, `metricDimension`, `metricGranularity`, `metricBucket`, `metricPage`, `timeZone`, `INSTANT`, `DIMENSION_NAME` |
| Actions | `actionDeclaration`, `idempotencyDeclaration` |
| Tasks | `taskTypeDeclaration`, `task`, `taskPage` |
| Alerts, Activity, Nudges | `alert`, `alertSeverity`, `alertPage`, `activity`, `activityState`, `activityPage`, `nudge` |
| Events | `eventTypeDeclaration`, `eventDestination` |
| The edition and the ids | `EDITION`, `schemaId`, `SCHEMA_ID_BASE`, `registry` |

`EDITION` is the edition of worker-protocol these objects encode, and it is **not** this package's
version and cannot be read off it. A package version is SemVer and moves when the code moves; an
edition moves when the protocol does, and a patch release of this package never changes what a
Worker must send.

## What this package deliberately does not do

**Nothing here carries behavior of its own.** Every constraint below the surface encodes a rule the
specification already states, and each one cites the rule id it encodes, so a conformance report can
name the rule rather than the file. Where the specification has not decided something, the object is
deliberately permissive and says so in a comment: a schema that overstates is worse than one that
admits a hole, because the schema is the normative artifact.

It also looks inside nothing that belongs to a Worker. A Task's payload, an Action's input and
result, an event's data are the Worker's own and are declared by that Worker in its own Descriptor —
this protocol has no data model, and there is no object here that describes one.

## Related packages

- `@worker-protocol/hono` — the protocol's surface as Hono routes, and `mount()`: implement an
  interface and get every address, header, envelope and refusal this protocol fixes.
- `@worker-protocol/client` — `consume()`: read a Worker, and take work from it.
- `@worker-protocol/conformance` — point it at a Worker's base URL, get a report of what it complies
  with.

## License and name

Apache-2.0, patent grant included — implement the protocol in any product, commercial or not,
without asking anyone. The name is not part of that grant (Apache-2.0 §6): a claim that something
*speaks worker-protocol* is one this project vouches for, and the conformance tool is how it is
earned.

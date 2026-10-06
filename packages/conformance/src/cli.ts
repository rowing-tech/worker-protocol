#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as z from "zod";
import { type Arrangement, verify } from "./index.ts";
import type { Report, Verdict } from "./report.ts";
import { tally } from "./report.ts";
import { type ListeningSink, listenAsSink } from "./sink.ts";

/**
 * `npx @worker-protocol/conformance <base-url>` — the verifier, from a shell.
 *
 * `docs/roadmap.md` says each language's repository ships its own reference Worker and runs this
 * package against it in CI, and that the report is what ties those repositories together: an SDK is
 * right because its Worker passes, not because somebody read the prose carefully. That promise was
 * being made to repositories in Python, C# and Go, and what it offered them was a TypeScript
 * function — so honouring it began with writing a Node program, which is a toolchain a Python
 * repository should not have to acquire in order to find out whether it conforms. This file is the
 * difference between that and one line of YAML.
 *
 * **Its exit code is the whole point and is the one thing here that must not be clever.** Zero when
 * no rule failed, 1 when one did, 2 when no verdict was reached.
 *
 * Which of those an unreachable Worker is, `verify` has already decided and this file does not
 * revisit: it fails DESC-1, naming what could not be fetched. That is a verdict and a correct one —
 * a Worker is not conformant at an address that does not answer — so it exits 1 like any other
 * failure. What exits 2 is the case where this tool is the one that is behind (DESC-33), and
 * whatever `verify` does not turn into a verdict at all.
 *
 * `notExercised` never fails the run. `conformance/README.md` spends a paragraph on why it is not
 * `fails`: the Worker declares no such Capability, or nobody arranged what the check needs to see.
 * Both are gaps somebody can close, and neither is the Worker breaking an obligation.
 */

const USAGE = `worker-protocol-conformance <base-url> [options]

Verify a Worker against the edition of worker-protocol this package encodes.

Options:
  --credential <token>  Presented as \`Authorization: Bearer <token>\` (REG-3).
                        Prefer WORKER_PROTOCOL_CREDENTIAL: argv is visible to
                        every process on the machine, and a CI log often keeps it.
  --may-perform         Allow POSTs to Actions. Off by default: an Action is an
                        operation somebody's operators chose to expose, and a tool
                        pointed at a Worker to inspect it does not perform work on
                        it uninvited. Rules needing one report notExercised.
  --arrangement <file>  A JSON file of what the Worker's operators arranged so that
                        more can be seen: safe Actions, more credentials, the Action
                        that publishes: verify()'s \`arrangement\`, except \`sink\`,
                        which is the two options below.
  --sink-port <port>    Serve a sink on 127.0.0.1:<port> for \`subscriptions\`. Needs
                        publishingAction in the arrangement. 0 takes a free port.
  --sink-url <url>      Where the Worker is to deliver, when that is not the socket:
                        a tunnel's public https URL forwarding to --sink-port. A
                        deployed Worker refuses a plaintext or loopback sink.
  --json                Write the report to stdout as JSON, and nothing else.
  -h, --help            This.

Exit: 0 nothing failed, 1 a rule failed, 2 the run could not be made.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    credential: { type: "string" },
    "may-perform": { type: "boolean", default: false },
    arrangement: { type: "string" },
    "sink-port": { type: "string" },
    "sink-url": { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const [baseUrl, ...extra] = positionals;

if (baseUrl === undefined || extra.length > 0) {
  refuse(
    baseUrl === undefined
      ? "A Worker's base URL is required."
      : `Expected one base URL, got ${positionals.length}.`,
  );
}

/** The run cannot be made as asked: say why, show how, and exit 2 — nothing was judged. */
function refuse(why: string): never {
  console.error(`${why}\n`);
  console.error(USAGE);
  process.exit(2);
}

const action = z.strictObject({ name: z.string().min(1), input: z.json() });
const safeAction = action.extend({ otherInput: z.json().optional() });

/**
 * What `--arrangement` reads: `Arrangement`, less what a file cannot hold.
 *
 * Strict, because the cost of a typo here is silent. A key spelled wrong is a key not given, and a
 * key not given reports `notExercised` — which is a verdict an operator reads as *nobody arranged
 * that*, while they believe they did. Refusing the file says which key, before anything is sent.
 * `sink` is a function and answers what arrived, so it is the options below and not a key; the two
 * addresses `verify` resolves itself are not a caller's to give.
 */
const arrangementFile = z.strictObject({
  safeAction: safeAction.optional(),
  secondSafeAction: safeAction.optional(),
  refusedInput: action.optional(),
  asyncAction: action.optional(),
  otherCallerCredential: z.string().optional(),
  secondCredential: z.string().optional(),
  consumerCredential: z.string().optional(),
  unprivilegedCredential: z.string().optional(),
  justStarted: z.boolean().optional(),
  replaceableSettings: z.boolean().optional(),
  recordsEveryRequest: z.boolean().optional(),
  publishedEvent: z.json().optional(),
  publishingAction: action.extend({ publishes: z.string().min(1) }).optional(),
}) satisfies z.ZodType<Omit<Arrangement, "sink" | "healthUrl" | "actionsUrl">>;

async function readArrangement(path: string): Promise<Arrangement> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (thrown) {
    refuse(`Could not read the arrangement at ${path}: ${(thrown as Error).message}`);
  }
  if (raw !== null && typeof raw === "object" && "sink" in raw) {
    refuse("`sink` is not a key of the arrangement file: it is --sink-port, and --sink-url.");
  }
  const parsed = arrangementFile.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    refuse(
      `The arrangement at ${path} is not one: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
    );
  }
  return parsed.data;
}

const arrangement =
  values.arrangement === undefined ? {} : await readArrangement(values.arrangement);

/**
 * The sink, where one was asked for. A run without one judges what a credential alone can see of
 * `subscriptions` and reports the rest `notExercised`, so nothing is started unless asked.
 */
async function openSink(): Promise<ListeningSink | undefined> {
  const port = values["sink-port"];
  const publicUrl = values["sink-url"];
  if (port === undefined) {
    if (publicUrl !== undefined) refuse("--sink-url names where --sink-port is reached from.");
    return undefined;
  }
  // A sink nothing publishes to judges nothing, and the run would say so only as `notExercised`.
  if (arrangement.publishingAction === undefined) {
    refuse(
      "--sink-port needs `publishingAction` in the arrangement: nothing else makes a Worker publish.",
    );
  }
  const number = Number(port);
  if (!Number.isInteger(number) || number < 0 || number > 65535) {
    refuse(`--sink-port takes a port, not ${port}.`);
  }
  if (publicUrl !== undefined && !URL.canParse(publicUrl)) {
    refuse(`--sink-url takes an absolute URL, not ${publicUrl}.`);
  }
  try {
    return await listenAsSink({ port: number, ...(publicUrl === undefined ? {} : { publicUrl }) });
  } catch (thrown) {
    refuse(`Could not listen on 127.0.0.1:${port}: ${(thrown as Error).message}`);
  }
}

const sink = await openSink();
if (sink !== undefined && !values.json) {
  console.error(`sink on ${sink.origin}, delivered to at ${sink.url}`);
}

/** The order `tally` fixes, which is the order a reader of `conformance/README.md` meets them in. */
const ORDER: Verdict[] = ["passes", "fails", "notExercised", "unverified", "otherSubject"];

function print(report: Report): void {
  const counts = tally(report.results);

  console.log(`\n${report.baseUrl}`);
  console.log(
    `edition ${report.edition ?? "(none declared)"}, verifier ${report.verifierEdition}\n`,
  );

  for (const verdict of ORDER) {
    console.log(`  ${verdict.padEnd(14)}${String(counts[verdict]).padStart(4)}`);
  }

  const failures = report.results.filter((result) => result.verdict === "fails");
  if (failures.length === 0) return;

  console.log("\nfailed:\n");
  for (const { rule, detail } of failures) {
    // The class is printed beside the id and never folded into the verdict. A `recommended` rule
    // that is not met is still reported — spec/README.md says this specification has standing to
    // give advice — and it is this column that keeps a reader from reading advice as a contract.
    console.log(`  ${rule.id.padEnd(10)} ${rule.class.padEnd(12)} ${rule.file}`);
    if (detail !== undefined) console.log(`    ${detail}`);
  }
}

let report: Report;

try {
  report = await verify({
    baseUrl,
    credential: values.credential ?? process.env.WORKER_PROTOCOL_CREDENTIAL,
    mayPerform: values["may-perform"],
    arrangement:
      sink === undefined
        ? arrangement
        : { ...arrangement, sink: { url: sink.url, received: sink.received } },
  });
} catch (thrown) {
  // A backstop, and it should stay empty. `verify` turns an unreachable Worker, an unresolvable
  // host and a base URL that is not a URL into verdicts of their own, so anything arriving here is
  // this tool failing rather than the Worker — and reporting that as a conformance failure would be
  // the one mistake a CI could not see through.
  console.error(`Could not verify ${baseUrl}: ${(thrown as Error).message}`);
  process.exit(2);
} finally {
  await sink?.close();
}

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  print(report);
}

// DESC-33 binds a verifier rather than a Worker: one that does not hold the declared MAJOR has
// verified nothing and says so. Exit 2, for the same reason as the catch above — the Worker has
// not been judged, and the thing that is behind is this tool.
if (report.older) {
  if (!values.json) {
    console.error(
      `\nThis verifier encodes edition ${report.verifierEdition} and the Worker declares ` +
        `${report.edition}. Nothing was judged. Install a newer @worker-protocol/conformance.`,
    );
  }
  process.exit(2);
}

process.exit(report.results.some((result) => result.verdict === "fails") ? 1 : 0);

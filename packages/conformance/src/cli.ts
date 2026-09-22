#!/usr/bin/env node
import { parseArgs } from "node:util";
import { verify } from "./index.ts";
import type { Report, Verdict } from "./report.ts";
import { tally } from "./report.ts";

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
 * failure. What exits 2 is the case where this tool is the one that is behind (DESC-25), and
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
  --json                Write the report to stdout as JSON, and nothing else.
  -h, --help            This.

Exit: 0 nothing failed, 1 a rule failed, 2 the run could not be made.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    credential: { type: "string" },
    "may-perform": { type: "boolean", default: false },
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
  console.error(
    baseUrl === undefined
      ? "A Worker's base URL is required.\n"
      : `Expected one base URL, got ${positionals.length}.\n`,
  );
  console.error(USAGE);
  process.exit(2);
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
  });
} catch (thrown) {
  // A backstop, and it should stay empty. `verify` turns an unreachable Worker, an unresolvable
  // host and a base URL that is not a URL into verdicts of their own, so anything arriving here is
  // this tool failing rather than the Worker — and reporting that as a conformance failure would be
  // the one mistake a CI could not see through.
  console.error(`Could not verify ${baseUrl}: ${(thrown as Error).message}`);
  process.exit(2);
}

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  print(report);
}

// DESC-25 binds a verifier rather than a Worker: one that does not hold the declared MAJOR has
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

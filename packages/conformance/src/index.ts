import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EDITION } from "@worker-protocol/schemas";
import type { Attribution } from "./attribution.ts";
import { checkActions } from "./checks/actions.ts";
import { checkAlerts } from "./checks/alerts.ts";
import { checkArranged } from "./checks/arranged.ts";
import { readDescriptor } from "./checks/descriptor.ts";
import { type Code, judgeTranscript } from "./checks/endpoints.ts";
import { checkEvents } from "./checks/events.ts";
import { checkHealth } from "./checks/health.ts";
import { checkMetrics } from "./checks/metrics.ts";
import { callSurfaces } from "./checks/surfaces.ts";
import { checkTasks } from "./checks/tasks.ts";
import { type Report, type Result, type Rule, unclaimed } from "./report.ts";
import { transcript } from "./transcript.ts";

export type { Attribution } from "./attribution.ts";
export type { Report, Result, Rule, Verdict } from "./report.ts";
export { tally } from "./report.ts";
export type { Exchange } from "./transcript.ts";

/**
 * `@worker-protocol/conformance` — point it at a Worker's base URL, get a report of what it
 * complies with.
 *
 * Its subject is a Worker and nothing else. Twenty-six rules in `spec/` bind a verifier, a Control
 * Tower, a consumer, an issuer or the specification itself; this tool reports those as
 * `otherSubject` rather than passing them, because it never contacted the party they oblige.
 * `conformance/verifiability.md` is where that classification is decided and `conformance/
 * README.md` holds the verdict vocabulary.
 *
 * Nothing here carries behaviour of its own. Every check reports against a rule id, and a check
 * that observed something `spec/` does not require would be this package making the standard.
 */

export type VerifyOptions = {
  /** The Worker's enrolled base URL, with or without a path. */
  baseUrl: string;
  /** Presented as `Authorization: Bearer <token>` (REG-3). */
  credential?: string;
  /**
   * Whether the verifier may POST to this Worker.
   *
   * Every surface but `actions` is read, and a read establishes what it establishes and leaves the
   * Worker as it found it. An Action is an operation somebody's operators chose to expose, so the
   * default is `false`: a tool pointed at a Worker to inspect it does not perform work on it
   * uninvited, and the rules that need a POST report `notExercised` with that as the reason.
   */
  mayPerform?: boolean;
  /**
   * What the Worker's operators arranged so that a rule with no ordinary witness can be observed.
   *
   * `conformance/verifiability.md` classes a rule `H` when nothing a tool can do to an unarranged
   * Worker will ever see a violation — a performance that succeeds, an input refused on content, a
   * second credential. The arrangement cannot come from the protocol, because putting test
   * scaffolding into a Descriptor would make every Worker in the network carry it. So it arrives
   * the way the base URL and the credential do: out of band, from the person who set it up.
   *
   * Anything not arranged reports `notExercised` naming what was missing, which is a gap somebody
   * can close rather than a verdict.
   */
  arrangement?: Arrangement;
  /** For tests and for a caller that needs its own agent. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
};

export type Arrangement = {
  /** An Action that is safe to perform, and an input its declared schema accepts. */
  safeAction?: { name: string; input: unknown };
  /** An input that is schema-valid and that the Worker refuses on its own rules (ACT-9). */
  refusedInput?: { name: string; input: unknown };
  /** An Action that declares it does not complete within the call, and an input for it (ACT-11). */
  asyncAction?: { name: string; input: unknown };
  /**
   * Whether the verifier may claim a Task, and release it again.
   *
   * Separate from `mayPerform` because it is a different consent. Performing an Action does
   * something to the Worker; claiming takes work away from whoever would otherwise have taken it,
   * for as long as the lease runs. The verifier releases every Claim it takes, so a Worker is left
   * as it was found — but a Task held for even a moment is a Task somebody else could not have,
   * and that is the operators' call rather than this tool's.
   */
  mayClaim?: boolean;
  /** A Task the operators are willing to have claimed and released (TASK-9 onward). */
  claimableTask?: string;
  /** A Task the Worker is not currently granting leases on (TASK-11). */
  unclaimableTask?: string;
  /** A second credential issued to the same holder (REG-8, REG-28, ALRT-6, TASK-6). */
  secondCredential?: string;
  /** A credential the Worker authenticates and that carries no right here (REG-32). */
  unprivilegedCredential?: string;
  /** That this Worker was started moments ago, so HLTH-4's window is still open. */
  justStarted?: boolean;
  /** That the operators will let the verifier write this Worker's settings back (ACT-14). */
  replaceableSettings?: boolean;
  /** An event this Worker published, since a verifier holds no broker and sees none (EVT-1). */
  publishedEvent?: unknown;
  /** Resolved by `verify` and not by a caller: the addresses the arranged checks need. */
  healthUrl?: string;
  actionsUrl?: string;
};

type Universe = { rules: Rule[]; codes: Code[]; attribution: Attribution };

/** Generated from `spec/` by `src/generate-rules.ts` and committed beside the source. */
export async function universe(): Promise<Universe> {
  const path = join(import.meta.dirname, "..", "rules.json");
  return JSON.parse(await readFile(path, "utf8")) as Universe;
}

export async function verify(options: VerifyOptions): Promise<Report> {
  const { rules: all, codes, attribution } = await universe();
  const byId = new Map(all.map((rule) => [rule.id, rule]));
  const tape = transcript(options.fetch ?? globalThis.fetch, options.credential);

  const descriptor = await readDescriptor(options.baseUrl, byId, attribution, tape);

  // DESC-25: a verifier that does not hold the declared edition's MAJOR verifies NOTHING and
  // reports that it is older than the Worker — rather than failing a Worker for a surface added
  // after this tool was built. The ordering DESC-23 fixes is what lets it say `older` rather than
  // merely `unrecognised`, and that is the difference between telling an operator to upgrade the
  // verifier and leaving the Worker under suspicion for what is the reader's problem.
  const declaredMajor = descriptor.document?.edition.split(".")[0];
  if (declaredMajor !== undefined && declaredMajor !== EDITION.split(".")[0]) {
    return {
      baseUrl: options.baseUrl,
      edition: descriptor.document?.edition ?? null,
      verifierEdition: EDITION,
      older: true,
      results: all.map((rule) => ({
        rule,
        verdict: "notExercised" as const,
        detail: `this verifier holds edition ${EDITION} and the Worker declares ${descriptor.document?.edition}`,
      })),
    };
  }
  const results: Result[] = [...descriptor.results];
  // Addresses a Capability declares INSIDE its own entry rather than beside it — `configure`'s
  // reading address is the first. ENDP-1 judges what the verifier called against what the
  // Descriptor declared, so an address it could not see would read as the Worker's fault.
  const nested: string[] = [];

  if (descriptor.document !== null && descriptor.url !== null) {
    results.push(
      ...(await callSurfaces(
        descriptor.surfaces,
        descriptor.url,
        // ENDP-6 is probed on the writes too, and these are the two this protocol has: the
        // Actions address, and the address a claim is posted to.
        [
          descriptor.surfaces.find((s) => s.capability === "actions")?.url,
          typeof (descriptor.document.capabilities.tasks as { claimAddress?: unknown } | undefined)
            ?.claimAddress === "string" && descriptor.url !== null
            ? new URL(
                (descriptor.document.capabilities.tasks as { claimAddress: string }).claimAddress,
                descriptor.url,
              ).toString()
            : undefined,
        ].filter((url): url is string => url !== undefined),
        byId,
        tape,
        options.credential,
        options.mayPerform === true,
      )),
    );
    const performed = await checkActions(
      descriptor.document.capabilities.actions,
      descriptor.surfaces.find((s) => s.capability === "actions")?.url ?? null,
      descriptor.url,
      byId,
      attribution,
      tape,
      options.mayPerform === true,
      options.arrangement ?? {},
    );
    results.push(...performed.results);
    nested.push(...performed.addresses);
    results.push(
      ...(await checkMetrics(
        descriptor.document.capabilities.metrics,
        descriptor.surfaces.find((s) => s.capability === "metrics")?.url ?? null,
        byId,
        attribution,
        tape,
      )),
    );
    // TASK-2 is an agreement between two entries rather than a shape inside one, so the tasks
    // check is handed the Action names the `actions` entry holds.
    const actionNames = Object.keys(
      (
        descriptor.document.capabilities.actions as
          | { actions?: Record<string, unknown> }
          | undefined
      )?.actions ?? {},
    );
    // `events` has no address by design (DESC-22), so this check sends nothing and takes no
    // transcript. It is the only Capability a verifier judges entirely from the Descriptor.
    results.push(...checkEvents(descriptor.document.capabilities.events, byId, attribution));
    results.push(
      ...(await checkAlerts(
        descriptor.document.capabilities.alerts,
        descriptor.surfaces.find((s) => s.capability === "alerts")?.url ?? null,
        actionNames,
        byId,
        attribution,
        tape,
      )),
    );
    const claimed = await checkTasks(
      descriptor.document.capabilities.tasks,
      descriptor.surfaces.find((s) => s.capability === "tasks")?.url ?? null,
      descriptor.url,
      actionNames,
      byId,
      attribution,
      tape,
      {
        ...(options.arrangement ?? {}),
        // TASK-16 sends the Action and then the outcome, so it needs the address the `actions`
        // entry declared. `verify` resolves it once rather than every check resolving it again.
        actionsUrl: descriptor.surfaces.find((s) => s.capability === "actions")?.url ?? undefined,
      },
      options.mayPerform === true,
    );
    results.push(...claimed.results);
    nested.push(...claimed.addresses);
    results.push(
      ...(await checkHealth(
        descriptor.document.capabilities.health,
        descriptor.surfaces.find((s) => s.capability === "health")?.url ?? null,
        byId,
        attribution,
        tape,
      )),
    );
  }

  if (descriptor.document !== null) {
    const surface = (name: string) =>
      descriptor.surfaces.find((s) => s.capability === name)?.url ?? null;
    const configure = (
      descriptor.document.capabilities.actions as
        | { actions?: Record<string, { readAddress?: string }> }
        | undefined
    )?.actions?.configure?.readAddress;

    results.push(
      ...(await checkArranged(
        {
          descriptorUrl: descriptor.url,
          alertsUrl: surface("alerts"),
          tasksUrl: surface("tasks"),
          settingsUrl:
            configure === undefined || descriptor.url === null
              ? null
              : new URL(configure, descriptor.url).toString(),
          workerId: descriptor.document.id,
          eventTypes: Object.keys(
            (descriptor.document.capabilities.events as { events?: Record<string, unknown> })
              ?.events ?? {},
          ),
        },
        {
          ...(options.arrangement ?? {}),
          healthUrl: surface("health") ?? undefined,
          actionsUrl: surface("actions") ?? undefined,
        },
        options.mayPerform === true,
        byId,
        tape,
      )),
    );
  }

  // Last, and over everything the run provoked. ENDP-26 is a statement about a set of responses
  // rather than about one, so it cannot be asked until there are no more to come.
  const declared = new Set([
    ...(descriptor.url === null ? [] : [descriptor.url]),
    ...descriptor.surfaces.map((s) => s.url),
    ...nested,
  ]);
  results.push(...judgeTranscript(tape.exchanges, codes, declared, byId));

  // Every rule gets a verdict, never only the ones a check claimed. A report covering 23 rules of
  // 102, all green, tells an operator the Worker was checked against the protocol — and the reader
  // concludes more than was established, which is the fault this whole directory is written
  // against. `unclaimed` is what says which kind of silence each remaining rule is.
  const claimed = new Set(results.map((result) => result.rule.id));
  const complete: Result[] = [
    ...results,
    ...all.filter((rule) => !claimed.has(rule.id)).map(unclaimed),
  ];
  complete.sort((a, b) => a.rule.id.localeCompare(b.rule.id, "en", { numeric: true }));

  return {
    baseUrl: options.baseUrl,
    edition: descriptor.document?.edition ?? null,
    verifierEdition: EDITION,
    results: complete,
  };
}

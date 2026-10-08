import { EDITION } from "@worker-protocol/schemas";
import type { Attribution } from "./attribution.ts";
import { checkActions } from "./checks/actions.ts";
import { checkActivity } from "./checks/activity.ts";
import { checkAlerts } from "./checks/alerts.ts";
import { checkArranged } from "./checks/arranged.ts";
import { readDescriptor } from "./checks/descriptor.ts";
import { type Code, judgeTranscript } from "./checks/endpoints.ts";
import { checkEvents } from "./checks/events.ts";
import { checkHealth } from "./checks/health.ts";
import { checkLogs } from "./checks/logs.ts";
import { checkMetrics } from "./checks/metrics.ts";
import { checkNudges } from "./checks/nudges.ts";
import { checkSubscriptions, type SinkExchange } from "./checks/subscriptions.ts";
import { callSurfaces } from "./checks/surfaces.ts";
import { checkTasks } from "./checks/tasks.ts";
import { type Report, type Result, type Rule, unclaimed } from "./report.ts";
import { UNIVERSE } from "./rules.generated.ts";
import { transcript, withParams } from "./transcript.ts";

export type { Attribution } from "./attribution.ts";
export type { Report, Result, Rule, Verdict } from "./report.ts";
export { tally } from "./report.ts";
export type { Exchange } from "./transcript.ts";

/**
 * `@worker-protocol/conformance` — point it at a Worker's base URL, get a report of what it
 * complies with.
 *
 * Its subject is a Worker and nothing else. Twenty-seven rules in `spec/` bind a verifier, a Control
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

/**
 * An Action safe to perform, an input its declared schema accepts, and optionally a second one.
 *
 * `otherInput` is another input the schema accepts and that is just as safe to perform. A verifier
 * cannot invent one — a body it made up is refused by any schema that admits no extra member — and
 * ENDP-17, ENDP-34 and ENDP-35 all need a second body under one key.
 */
export type SafeAction = { name: string; input: unknown; otherInput?: unknown };

export type Arrangement = {
  /** An Action that is safe to perform, and an input its declared schema accepts. */
  safeAction?: SafeAction;
  /**
   * A second safe Action, whose idempotency key comes from the other origin (ENDP-34, ENDP-35).
   *
   * An Action reads its key from the header or from the input and never both, so one safe Action
   * reaches only one of the two rules. Each check uses whichever of the two declares its origin,
   * and a Worker whose keys all come from one origin has no reason to invent the other.
   */
  secondSafeAction?: SafeAction;
  /**
   * A credential the Worker's authentication attributes to a different caller than the recorded
   * one (ENDP-34, ENDP-35).
   *
   * Not `secondCredential`, which is issued to the same holder and is therefore the same caller: a
   * Worker is right to answer `409` to a header key reused under it. A Worker with one caller has
   * no such credential to hand in, and both rules report that rather than a verdict.
   */
  otherCallerCredential?: string;
  /** An input that is schema-valid and that the Worker refuses on its own rules (ACT-17). */
  refusedInput?: { name: string; input: unknown };
  /** An Action that declares it does not complete within the call, and an input for it (ACT-18). */
  asyncAction?: { name: string; input: unknown };
  /** A second credential issued to the same holder (REG-8, REG-28, ALRT-6). */
  secondCredential?: string;
  /**
   * A credential issued under a Contract rather than recorded at enrollment (TASK-6).
   *
   * TASK-6 compares what it sees against what the recorded credential sees. Where none is given it
   * falls back to the second credential.
   */
  consumerCredential?: string;
  /** A credential the Worker authenticates and that carries no right here (REG-32). */
  unprivilegedCredential?: string;
  /** That this Worker was started moments ago, so HLTH-4's window is still open. */
  justStarted?: boolean;
  /** That the operators will let the verifier write this Worker's settings back (ACT-20). */
  replaceableSettings?: boolean;
  /**
   * That this Worker records a log record for every request it serves (LOG-3, ENDP-33).
   *
   * It is what gives a verifier a way to make a record exist — read anything — without knowing the
   * Worker's domain, and both rules need one: an order is only visible against something newer,
   * and a cursor is only tested while the feed is being written to. Without it the two report
   * `notExercised`, because an unchanged page is then ambiguous between a Worker that got the
   * order wrong and a Worker that wrote nothing.
   */
  recordsEveryRequest?: boolean;
  /** An event this Worker published, since a verifier holds no broker and sees none (EVT-1). */
  publishedEvent?: unknown;
  /**
   * A sink the Worker can reach, and what arrived at it (SUB-2 to SUB-16, EVT-1, EVT-15).
   *
   * The caller's, because `verify()` starts no server and so runs in any runtime: `url` is where
   * the Worker delivers, and `received` answers every request that reached it — the handshake and
   * the deliveries alike — oldest first. The sink allows the Worker's origin in the webhook
   * handshake and answers deliveries `2xx`.
   */
  sink?: {
    url: string;
    received: () => Promise<SinkExchange[]> | SinkExchange[];
    /**
     * How the sink answers deliveries from now on: a status and, where it says, a `Retry-After`;
     * `undefined` puts it back to `2xx`. Optional: a sink that cannot be told to fail leaves SUB-12,
     * the failing half of SUB-16, SUB-14 and SUB-15 to report that it could not.
     */
    respond?: (answer: { status: number; retryAfter?: string } | undefined) => void;
  };
  /**
   * An Action safe to perform that publishes one named event type (SUB-11, SUB-13, EVT-15).
   *
   * Nothing else lets a verifier make a Worker publish. It is performed once, after the verifier
   * has subscribed to `publishes` at the arranged sink, and what reaches the sink is judged.
   */
  publishingAction?: { name: string; input: unknown; publishes: string };
  /**
   * Actions the verifier performs before any check, in order — a source paused so that an Alert is
   * open, a Task raised so that the Task rules have one to read. It needs `mayPerform`, and a step
   * the Worker refuses stops the run: the verdicts would describe a Worker in a state it was never
   * put in.
   */
  before?: Step[];
  /**
   * Actions the verifier performs after every check, whatever they found — what puts a deployed
   * Worker back as it was found: the source resumed, the Task answered.
   */
  after?: Step[];
  /**
   * That the operators will wait `abandonAfterSeconds` for SUB-14 and SUB-15: the verifier makes the
   * sink fail without interruption until the Worker abandons the subscription and says so. Off by
   * default, because the wait is the Worker's declared window, which may be an hour or a day. Needs
   * a sink that can be told to fail (`sink.respond`).
   */
  abandonment?: boolean;
  /** Resolved by `verify` and not by a caller: the addresses the arranged checks need. */
  healthUrl?: string;
  actionsUrl?: string;
};

type Universe = { rules: Rule[]; codes: Code[]; attribution: Attribution };

/**
 * Generated from `spec/` by `src/generate-rules.ts` and committed beside the source.
 *
 * Imported rather than read from `rules.json`, so that nothing on the library path needs a
 * filesystem and `verify()` runs anywhere a `fetch` does. It stays async because it was, and a
 * caller awaiting it should not have to change. Each call hands back its own copy, as each parse
 * of the file did: a caller that edits what it was given must not edit the next run's universe.
 * The copy is a JSON round trip rather than `structuredClone`, which not every runtime a Tower
 * lives in is known to carry, and the universe is JSON by construction.
 */
export async function universe(): Promise<Universe> {
  return JSON.parse(JSON.stringify(UNIVERSE)) as Universe;
}

/** DESC-23: editions are ordered by comparing MAJOR and then MINOR, as numbers. */
const later = (a: string, b: string): boolean => {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am !== bm ? am > bm : an > bn;
};

/** DESC-31: whether a rule is one of the obligations an edition contains. */
const contains = (edition: string, rule: Rule): boolean =>
  !later(rule.introducedIn, edition) &&
  (rule.withdrawnIn === undefined || later(rule.withdrawnIn, edition));

/**
 * The verdict for a rule no check claimed, once DESC-31 has said whether the edition holds it.
 *
 * A rule outside the declared edition is a gap in the Worker's claim and not in its conduct, so it
 * is not exercised and says which edition it belongs to. A withdrawn rule inside it is one this
 * verifier may no longer carry a check for, and it says so rather than being passed or dropped.
 */
const outside = (rule: Rule, edition: string): Result => {
  if (later(rule.introducedIn, edition)) {
    return {
      rule,
      verdict: "notExercised",
      detail: `introduced in ${rule.introducedIn}; the Worker declares ${edition}`,
    };
  }
  if (rule.withdrawnIn !== undefined && !later(rule.withdrawnIn, edition)) {
    return {
      rule,
      verdict: "notExercised",
      detail: `withdrawn in ${rule.withdrawnIn}; the Worker declares ${edition}`,
    };
  }
  if (rule.withdrawnIn !== undefined) {
    return {
      rule,
      verdict: "notExercised",
      detail: `withdrawn in ${rule.withdrawnIn}; this verifier no longer checks it`,
    };
  }
  return unclaimed(rule);
};

/** One Action the arrangement asks the verifier to perform before the checks or after them. */
export type Step = { name: string; input: unknown };

/**
 * Performs the arrangement's `before` or `after` steps, in order, each under a key of its own.
 *
 * They need `mayPerform`, because each is a write the operators asked for. A step the Worker does
 * not perform is an arrangement that does not hold, and the run stops there rather than reporting
 * verdicts about a Worker that was not put in the state they assume — `after` steps still run.
 */
async function prepare(given: {
  steps: Step[] | undefined;
  when: "before" | "after";
  actionsUrl: string | null;
  mayPerform: boolean;
  tape: ReturnType<typeof transcript>;
}): Promise<void> {
  const { steps, when, actionsUrl, mayPerform, tape } = given;
  if (steps === undefined || steps.length === 0) return;
  if (!mayPerform || actionsUrl === null) {
    throw new Error(
      `The arrangement names steps to perform ${when} the checks, which needs \`mayPerform\` ` +
        "and a Worker that declares `actions`.",
    );
  }
  for (const [at, step] of steps.entries()) {
    const answer = await tape.send(
      withParams(actionsUrl, { action: step.name }),
      `the arrangement's step ${at + 1} ${when} the checks, \`${step.name}\``,
      {
        method: "POST",
        body: JSON.stringify(step.input),
        headers: {
          "content-type": "application/json",
          "idempotency-key": `conformance-${when}-${at}-${Date.now()}`,
        },
      },
    );
    if (answer.status < 200 || answer.status > 299) {
      throw new Error(
        `The arrangement's step ${at + 1} ${when} the checks, \`${step.name}\`, answered ` +
          `${answer.status}.`,
      );
    }
  }
}

export async function verify(options: VerifyOptions): Promise<Report> {
  const { rules: all, codes, attribution } = await universe();
  const tape = transcript(options.fetch ?? globalThis.fetch, options.credential);

  // Read with every rule the universe holds, because the edition it declares is not known until
  // the Descriptor is read, and that read is judged by the rules of the edition it turns out to
  // declare — the filter below takes back what the declared edition does not contain.
  const descriptor = await readDescriptor(
    options.baseUrl,
    new Map(all.map((rule) => [rule.id, rule])),
    attribution,
    tape,
  );

  // DESC-33: a verifier that does not hold the declared edition's MAJOR verifies NOTHING and
  // reports that it is older than the Worker — rather than failing a Worker for a surface added
  // after this tool was built. While the MAJOR is 0 a later MINOR counts the same, because DESC-32
  // lets a MINOR break before 1.0. The ordering DESC-23 fixes is what lets it say `older` rather
  // than merely `unrecognised`, and that is the difference between telling an operator to upgrade
  // the verifier and leaving the Worker under suspicion for what is the reader's problem.
  const declaredEdition = descriptor.document?.edition;
  const [heldMajor] = EDITION.split(".");
  const behind =
    declaredEdition !== undefined &&
    (declaredEdition.split(".")[0] !== heldMajor ||
      (heldMajor === "0" && later(declaredEdition, EDITION)));
  if (behind) {
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

  // DESC-31: a Worker is judged by the rules the edition it declares contains, and by no other. A
  // Worker built to an earlier MINOR and correct in it is correct in the edition it claimed, so a
  // rule added since is not exercised rather than failed, and a rule withdrawn since is still one
  // it owes. From 1.0, where the Worker declares a later MINOR than this verifier holds, DESC-33 has
  // it judge by what it holds; with no edition read there is nothing to place the Worker in but
  // this verifier's own.
  const judged =
    declaredEdition === undefined || later(declaredEdition, EDITION) ? EDITION : declaredEdition;
  const byId = new Map(all.filter((rule) => contains(judged, rule)).map((rule) => [rule.id, rule]));

  const results: Result[] = descriptor.results.filter((result) => byId.has(result.rule.id));
  // Addresses a Capability declares INSIDE its own entry rather than beside it — `configure`'s
  // reading address is the first. ENDP-1 judges what the verifier called against what the
  // Descriptor declared, so an address it could not see would read as the Worker's fault.
  const nested: string[] = [];

  /** The address a Capability declared, resolved by `readDescriptor` per DESC-36. */
  const surface = (name: string) =>
    descriptor.surfaces.find((one) => one.capability === name)?.url ?? null;

  // The arrangement's own steps, around every check: what the Worker has to be put in so that its
  // rules can be exercised now rather than at the minute that happens to have them, and what puts
  // it back afterwards whatever the checks found.
  const actionsUrl = surface("actions");
  const steps = options.arrangement ?? {};
  if (descriptor.document !== null) {
    await prepare({
      steps: steps.before,
      when: "before",
      actionsUrl,
      mayPerform: options.mayPerform === true,
      tape,
    });
  }
  try {
    if (descriptor.document !== null && descriptor.url !== null) {
      results.push(
        ...(await callSurfaces(
          descriptor.surfaces,
          descriptor.url,
          // ENDP-6 is probed on every write this protocol has, and being wrong on a write is what
          // the rule is for: a Worker that refuses an unanswerable version on a read and performs
          // one here has done the thing it exists to prevent.
          [surface("actions"), surface("nudges")].filter((url): url is string => url !== null),
          byId,
          tape,
          options.credential,
          options.mayPerform === true,
        )),
      );
      // TASK-35 is an agreement between two entries rather than a shape inside one, so the tasks
      // check is handed the `actions` entry itself: every name a Task type points at must be one it
      // accepts, and that is not reachable from inside `tasks`.
      const accepts =
        (
          descriptor.document.capabilities.actions as
            | { accepts?: Record<string, { input?: unknown }> }
            | undefined
        )?.accepts ?? {};
      // Tasks before Actions, and the order is not a preference: an Action that answers a Task
      // resolves its condition (TASK-15), so a Worker whose Tasks are read after its Actions are
      // performed may have none left to read. Every check here is a GET and changes nothing.
      const listed = await checkTasks(
        descriptor.document.capabilities.tasks,
        surface("tasks"),
        Object.keys(descriptor.document.skills ?? {}),
        accepts,
        byId,
        attribution,
        tape,
      );
      results.push(...listed.results);
      nested.push(...listed.addresses);
      const performed = await checkActions(
        descriptor.document.capabilities.actions,
        surface("actions"),
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
          surface("metrics"),
          byId,
          attribution,
          tape,
        )),
      );
      // `events` has no address by design (DESC-22), so this check sends nothing and takes no
      // transcript. It is the only Capability a verifier judges entirely from the Descriptor.
      results.push(
        ...checkEvents({
          entry: descriptor.document.capabilities.events,
          subscriptions: descriptor.document.capabilities.subscriptions,
          rules: byId,
          attribution,
        }),
      );
      results.push(
        ...(await checkAlerts(
          descriptor.document.capabilities.alerts,
          surface("alerts"),
          accepts,
          byId,
          attribution,
          tape,
        )),
      );
      results.push(
        ...(await checkActivity(
          descriptor.document.capabilities.activity,
          surface("activity"),
          byId,
          attribution,
          tape,
        )),
      );
      results.push(
        ...(await checkLogs(
          descriptor.document.capabilities.logs,
          surface("logs"),
          byId,
          attribution,
          tape,
        )),
      );
      results.push(
        ...(await checkHealth(
          descriptor.document.capabilities.health,
          surface("health"),
          byId,
          attribution,
          tape,
        )),
      );
      // Last of the Capability checks, because it is the only one that sends the Worker somewhere: a
      // nudge it accepts has it read a Task list. Everything above it is a read.
      results.push(
        ...(await checkNudges(
          descriptor.document.capabilities.nudges,
          surface("nudges"),
          Object.keys(descriptor.document.skills ?? {}),
          byId,
          attribution,
          tape,
          options.mayPerform === true,
        )),
      );
    }

    if (descriptor.document !== null) {
      const configure = (
        descriptor.document.capabilities.actions as
          | { accepts?: Record<string, { readAddress?: string }> }
          | undefined
      )?.accepts?.configure?.readAddress;

      results.push(
        ...(await checkArranged(
          {
            descriptorUrl: descriptor.url,
            alertsUrl: surface("alerts"),
            activityUrl: surface("activity"),
            logsUrl: surface("logs"),
            tasksUrl: surface("tasks"),
            settingsUrl:
              configure === undefined || descriptor.url === null
                ? null
                : new URL(configure, descriptor.url).toString(),
            workerId: descriptor.document.id,
            eventTypes: Object.keys(
              (descriptor.document.capabilities.events as { publishes?: Record<string, unknown> })
                ?.publishes ?? {},
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

    // SUB-1 to SUB-16, and EVT-1 and EVT-15 at last: what the Worker pushes. After every other
    // check, because the Action that publishes changes the Worker's Facts like any performance.
    if (descriptor.document !== null) {
      const events = descriptor.document.capabilities.events as
        | { publishes?: Record<string, { extensions?: Record<string, unknown> }> }
        | undefined;
      results.push(
        ...(await checkSubscriptions({
          entry: descriptor.document.capabilities.subscriptions,
          url: surface("subscriptions"),
          workerId: descriptor.document.id,
          publishes: Object.keys(events?.publishes ?? {}),
          extensions: Object.fromEntries(
            Object.entries(events?.publishes ?? {}).map(([type, one]) => [
              type,
              one.extensions ?? {},
            ]),
          ),
          actionsUrl: surface("actions"),
          mayPerform: options.mayPerform === true,
          arrangement: options.arrangement ?? {},
          rules: byId,
          attribution,
          transcript: tape,
        })),
      );
    }
  } finally {
    if (descriptor.document !== null) {
      await prepare({
        steps: steps.after,
        when: "after",
        actionsUrl,
        mayPerform: options.mayPerform === true,
        tape,
      });
    }
  }

  // Last, and over everything the run provoked. ENDP-26 is a statement about a set of responses
  // rather than about one, so it cannot be asked until there are no more to come.
  const declared = new Set([
    ...(descriptor.url === null ? [] : [descriptor.url]),
    ...descriptor.surfaces.map((s) => s.url),
    ...nested,
  ]);
  results.push(
    ...judgeTranscript({
      exchanges: tape.exchanges,
      codes,
      declared,
      descriptorUrl: descriptor.url,
      rules: byId,
    }),
  );

  // Every rule gets a verdict, never only the ones a check claimed. A report covering 23 rules of
  // 102, all green, tells an operator the Worker was checked against the protocol — and the reader
  // concludes more than was established, which is the fault this whole directory is written
  // against. `unclaimed` is what says which kind of silence each remaining rule is.
  const claimed = new Set(results.map((result) => result.rule.id));
  const complete: Result[] = [
    ...results,
    ...all.filter((rule) => !claimed.has(rule.id)).map((rule) => outside(rule, judged)),
  ];
  complete.sort((a, b) => a.rule.id.localeCompare(b.rule.id, "en", { numeric: true }));

  return {
    baseUrl: options.baseUrl,
    edition: descriptor.document?.edition ?? null,
    verifierEdition: EDITION,
    results: complete,
  };
}

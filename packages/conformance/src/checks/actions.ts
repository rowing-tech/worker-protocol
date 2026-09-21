import { actionsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import type { Arrangement } from "../index.ts";
import type { Result, Rule } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `actions` Capability.
 *
 * **This is the first check in the verifier that sends a POST, and it asks permission first.**
 * Every other surface here is read: a GET establishes what it establishes and leaves the Worker as
 * it found it. An Action is an operation somebody's operators chose to expose, and a tool that
 * posted to one uninvited would be performing work on a system it was pointed at to inspect —
 * which is not a thing a conformance report is worth. So every probe that posts is behind
 * `mayPerform`, and without it those rules report `notExercised` with the reason.
 *
 * The refusals below perform nothing even when they are allowed — an Action name no entry
 * declares, a request naming none, an input no schema could accept — but the request is still a
 * POST to somebody's Worker, and whether that is acceptable is theirs to say rather than this
 * tool's to assume.
 */
export const CLAIMS = [
  "ACT-16",
  "ACT-2",
  "ACT-3",
  "ACT-4",
  "ACT-6",
  "ACT-7",
  "ACT-8",
  "ACT-12",
  "ACT-15",
  "DESC-11",
  "ENDP-3",
  "ENDP-15",
  "ENDP-18",
  "REG-31",
  // Only observable against a Worker whose operators arranged one, and said so.
  "ACT-5",
  "ACT-9",
  "ACT-10",
  "ACT-11",
  "ENDP-12",
  "ENDP-16",
  "ENDP-17",
] as const;

type Declaration = {
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  completesWithinCall: boolean;
  idempotency?: { required: boolean; from: string; member?: string; windowSeconds: number };
  readAddress?: string;
};

export async function checkActions(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  descriptorUrl: string,
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
  mayPerform: boolean,
  arrangement: Arrangement,
): Promise<{ results: Result[]; addresses: string[] }> {
  const results: Result[] = [];
  const addresses: string[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };
  const allExcept = (verdict: Result["verdict"], why: string, except: string[] = []) => {
    for (const id of CLAIMS) if (!except.includes(id)) say(id, verdict, why);
  };

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `actions`");
    return { results, addresses };
  }

  // ACT-16 to ACT-4, ACT-12 and ENDP-15 are read off the Descriptor, and a verifier fails the
  // Worker on them without sending anything at all.
  const declared = actionsEntry.safeParse(entry);
  if (!declared.success) {
    const blamed = new Set<string>();
    for (const issue of declared.error.issues) {
      const id = ruleFor(attribution, "actions-entry", issue.path) ?? "ACT-16";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    allExcept("notExercised", "the `actions` entry did not validate", [...blamed]);
    return { results, addresses };
  }

  const { accepts: actions } = declared.data as unknown as {
    accepts: Record<string, Declaration>;
  };
  for (const id of ["ACT-16", "ACT-2", "ACT-3", "ACT-4"]) say(id, "passes");

  // ACT-12 and ENDP-15 are the same declaration seen from two files: ENDP-15 requires it and
  // ACT-12 says where it lives and what it carries. Where no Action takes a key there is nothing
  // to judge, and saying so is not the same as passing.
  const withKeys = Object.entries(actions).filter(([, a]) => a.idempotency !== undefined);
  if (withKeys.length === 0) {
    say("ACT-12", "notExercised", "no Action declares an idempotency key");
    say("ENDP-15", "notExercised", "no Action declares an idempotency key");
    say("DESC-11", "notExercised", "no Capability declares a behaviour conditional on a call");
  } else {
    // The schema made the half-set state unspellable — `from: "input"` with no member named is a
    // document nobody can write — so validating it IS the check.
    say("ACT-12", "passes");
    say("ENDP-15", "passes");
    // DESC-11: where a Capability's behaviour on a call is conditional, the condition is declared
    // in its entry. An idempotency declaration is that rule's first case.
    say("DESC-11", "passes");
  }

  // ACT-15: a Worker that declares `configure` declares a reading address for it, and a GET of
  // that address answers a document its own `configure` would accept. Without it a console renders
  // an empty form and an operator replaces everything they did not remember.
  const configure = actions.configure;
  if (configure === undefined) {
    say("ACT-15", "notExercised", "the Worker declares no `configure`");
  } else if (typeof configure.readAddress !== "string" || configure.readAddress.length === 0) {
    say("ACT-15", "fails", "`configure` is declared with no reading address");
  } else if (url === null) {
    say("ACT-15", "notExercised", "the `actions` address did not resolve");
  } else {
    // DESC-12 resolves a relative reference against the URL THE DESCRIPTOR WAS READ FROM, not
    // against the Capability's own address. The two coincide for a Worker at the origin root and
    // diverge the moment one is mounted under a path, which is the case that catches it.
    const target = new URL(configure.readAddress, descriptorUrl).toString();
    // ENDP-1: every address a caller uses is one the Descriptor declared, and this one is — inside
    // the Action that declared it rather than beside the Capability. Each Capability knows where
    // its own addresses live, which is why it hands them back rather than being guessed at.
    addresses.push(target);
    const answer = await transcript.send(target, "the `configure` reading address");
    if (answer.status !== 200) {
      say("ACT-15", "fails", `${target} answered ${answer.status}`);
    } else if (answer.json === null || typeof answer.json !== "object") {
      say("ACT-15", "fails", "the reading address did not answer a document");
    } else {
      say("ACT-15", "passes");
    }
  }

  if (url === null) {
    allExcept("notExercised", "the `actions` address did not resolve", [
      "ACT-16",
      "ACT-2",
      "ACT-3",
      "ACT-4",
      "ACT-12",
      "ACT-15",
      "DESC-11",
      "ENDP-15",
    ]);
    return { results, addresses };
  }

  if (!mayPerform) {
    for (const id of [
      "ACT-6",
      "ACT-7",
      "ACT-8",
      "ENDP-3",
      "ENDP-18",
      "REG-31",
      "ACT-5",
      "ACT-9",
      "ACT-10",
      "ACT-11",
      "ENDP-12",
      "ENDP-16",
      "ENDP-17",
    ]) {
      say(id, "notExercised", "the verifier was not permitted to POST to this Worker");
    }
    return { results, addresses };
  }

  const post = (
    parameters: string,
    body: string,
    intent: string,
    extra: { headers?: HeadersInit; permanent?: boolean } = {},
  ) => transcript.send(`${url}${parameters}`, intent, { method: "POST", body, ...extra });

  const code = (answer: { json: unknown }) => (answer.json as { code?: string } | null)?.code;

  // ACT-7: a request naming no Action has not said what it wants, which is a parameter fault.
  const unnamed = await post("", "{}", "a POST naming no Action", { permanent: true });
  if (unnamed.status === 400 && code(unnamed) === "invalid_parameter") say("ACT-7", "passes");
  else say("ACT-7", "fails", `answered ${unnamed.status} with \`${code(unnamed) ?? "no code"}\``);

  // ENDP-3: everything that changes state is POST, on an address declared for the purpose. The
  // witness is the converse — the address answers a POST, and does not serve the same operation
  // to a GET, which ENDP-2 reserves for reads that change nothing.
  const asRead = await transcript.send(
    `${url}?action=${encodeURIComponent(Object.keys(actions)[0] ?? "x")}`,
    "the Actions address as a GET",
  );
  if (unnamed.status !== 404 && asRead.status === 404) say("ENDP-3", "passes");
  else if (asRead.status !== 404)
    say("ENDP-3", "fails", `a GET of the Actions address answered ${asRead.status}`);
  else say("ENDP-3", "fails", "the Actions address does not answer a POST");

  // REG-31 recommends a credential on every address that changes state. A write accepted from the
  // world is an operation performed by anyone who asks — and this protocol has published the
  // address and the schema of every one of them in the Descriptor, which is the hard half of the
  // attacker's work already done. It recommends rather than binds because it is advice about a
  // deployment's exposure: every call to a Worker that ignores it still succeeds.
  const uncredentialed = await transcript.send(
    `${url}?action=${encodeURIComponent(Object.keys(actions)[0] ?? "x")}`,
    "a POST with no credential at all",
    {
      method: "POST",
      body: "[]",
      headers: { authorization: "" },
      permanent: true,
    },
  );
  if (uncredentialed.status === 401 || uncredentialed.status === 403) say("REG-31", "passes");
  else say("REG-31", "fails", `a POST with no credential answered ${uncredentialed.status}`);

  // ACT-6: an Action the entry does not declare is a resource that does not exist, and nothing is
  // performed on the way to finding that out.
  const absent = await post(
    "?action=no-such-action-b7d2",
    "{}",
    "an Action the entry does not declare",
    { permanent: true },
  );
  if (absent.status === 404 && code(absent) === "not_found") say("ACT-6", "passes");
  else say("ACT-6", "fails", `answered ${absent.status} with \`${code(absent) ?? "no code"}\``);

  const [name, declaration] = Object.entries(actions)[0] ?? [];
  if (name === undefined || declaration === undefined) {
    say("ACT-8", "notExercised", "the entry declares no Action to post to");
    say("ENDP-18", "notExercised", "the entry declares no Action to post to");
    return { results, addresses };
  }

  // ACT-8: an input that does not match the declared schema. The body is an empty ARRAY on
  // purpose: it is the smallest document that no Action's input schema could describe, so a Worker
  // that acted on it would have acted on no input at all. A conformance tool has to pick something
  // to be refused, and this is the one thing that cannot be mistaken for a request to do work.
  //
  // A key travels with it where the Action declares one. Two faults are present otherwise — a body
  // that does not match AND a required key that is absent — and no rule fixes which a Worker names
  // first, so a probe that provoked both would be asking a question the specification does not
  // answer and failing whichever Worker answered it the other way. ENDP-18 has its own probe below.
  const mismatched = await post(
    `?action=${encodeURIComponent(name)}`,
    "[]",
    "an input no schema could accept",
    {
      permanent: true,
      ...(declaration.idempotency === undefined
        ? {}
        : { headers: { "idempotency-key": `conformance-mismatch-${Date.now()}` } }),
    },
  );
  if (mismatched.status === 400 && code(mismatched) === "schema_mismatch") say("ACT-8", "passes");
  else
    say(
      "ACT-8",
      "fails",
      `answered ${mismatched.status} with \`${code(mismatched) ?? "no code"}\``,
    );

  // ENDP-18: a required key that is absent is `400`. A Worker that performs the Action anyway has
  // performed exactly the operation the key existed to protect.
  const needsKey = Object.entries(actions).find(([, a]) => a.idempotency?.required === true);
  if (needsKey === undefined) {
    say("ENDP-18", "notExercised", "no Action requires an idempotency key");
  } else {
    const [keyed] = needsKey;
    const without = await post(
      `?action=${encodeURIComponent(keyed)}`,
      "[]",
      "an Action that requires a key, with none",
      { permanent: true },
    );
    if (without.status === 400 && code(without) === "idempotency_key_required") {
      say("ENDP-18", "passes");
    } else {
      say("ENDP-18", "fails", `answered ${without.status} with \`${code(without) ?? "no code"}\``);
    }
  }

  await checkArranged(actions, arrangement, mismatched.status, post, say);

  return { results, addresses };
}

/**
 * The rules that need a Worker arranged for them, and told to the verifier.
 *
 * Every probe above is refused by design and performs nothing. These are the opposite: they ask a
 * Worker to actually do something, so they need TWO consents — `mayPerform`, and an operator
 * naming which Action is safe. Without both, each reports what was missing.
 */
async function checkArranged(
  actions: Record<string, Declaration>,
  arrangement: Arrangement,
  mismatchedStatus: number,
  post: (
    parameters: string,
    body: string,
    intent: string,
    extra?: { headers?: HeadersInit; permanent?: boolean },
  ) => Promise<{ status: number; body: string; json: unknown }>,
  say: (id: string, verdict: "passes" | "fails" | "notExercised", detail?: string) => void,
): Promise<void> {
  const code = (answer: { json: unknown }) => (answer.json as { code?: string } | null)?.code;
  const query = (name: string) => `?action=${encodeURIComponent(name)}`;

  // ACT-5 and ACT-10: a performance that succeeds, answering `200` with the declared result or
  // `204` where the Action declares none.
  const safe = arrangement.safeAction;
  if (safe === undefined) {
    for (const id of ["ACT-5", "ACT-10", "ENDP-16", "ENDP-17"]) {
      say(id, "notExercised", "no Action was named as safe to perform");
    }
  } else {
    const declaration = actions[safe.name];
    const key = declaration?.idempotency !== undefined ? `conformance-${Date.now()}` : undefined;
    const headers = key === undefined ? undefined : { "idempotency-key": key };
    const body = JSON.stringify(safe.input);
    const done = await post(query(safe.name), body, `the Action \`${safe.name}\``, { headers });

    const wantsResult = declaration?.result !== undefined;
    if (done.status === 200 || done.status === 204) {
      say("ACT-5", "passes");
      if (wantsResult && done.status === 200) say("ACT-10", "passes");
      else if (!wantsResult && done.status === 204) say("ACT-10", "passes");
      else {
        const expected = wantsResult ? "200 with its result" : "204";
        say(
          "ACT-10",
          "fails",
          `it declares ${wantsResult ? "a result" : "none"} and answered ${done.status}, not ${expected}`,
        );
      }
    } else {
      say("ACT-5", "fails", `answered ${done.status} with \`${code(done) ?? "no code"}\``);
      say("ACT-10", "notExercised", "the performance did not succeed");
    }

    if (key === undefined) {
      for (const id of ["ENDP-16", "ENDP-17"]) {
        say(id, "notExercised", `\`${safe.name}\` declares no idempotency key`);
      }
    } else {
      // ENDP-16: within the window, a repeat under the same key is not a second performance — the
      // Worker answers the outcome it recorded.
      const again = await post(query(safe.name), body, "the same Action under the same key", {
        headers,
      });
      if (again.status === done.status && again.body === done.body) say("ENDP-16", "passes");
      else say("ENDP-16", "fails", `the repeat answered ${again.status}, not the recorded outcome`);

      // ENDP-17: a key reused with a different body is `409`. Only the caller can tell a retry
      // from a genuine repeat, and this is the Worker refusing to guess.
      const other = JSON.stringify({ ...(safe.input as object), "conformance-probe": true });
      const reused = await post(query(safe.name), other, "the same key with another body", {
        headers,
        permanent: true,
      });
      if (reused.status === 409) say("ENDP-17", "passes");
      else say("ENDP-17", "fails", `answered ${reused.status}, not 409`);
    }
  }

  // ACT-9 and ENDP-12: an input that matches the schema and that the Worker will not accept on its
  // own rules. ENDP-12 needs BOTH halves — a 400 for a body it could not read and a 422 for one it
  // read and refused — and the 400 came from the schema-mismatch probe above.
  const refused = arrangement.refusedInput;
  if (refused === undefined) {
    say("ACT-9", "notExercised", "no input was named that this Worker refuses on its own rules");
    say("ENDP-12", "notExercised", "nothing provoked a 422 to compare against the 400");
  } else {
    const answer = await post(
      query(refused.name),
      JSON.stringify(refused.input),
      `\`${refused.name}\` with an input it refuses`,
      { permanent: true },
    );
    if (answer.status === 422 && code(answer) === "unprocessable_content") {
      say("ACT-9", "passes");
      if (mismatchedStatus === 400) say("ENDP-12", "passes");
      else say("ENDP-12", "fails", `an unreadable body answered ${mismatchedStatus}, not 400`);
    } else {
      say("ACT-9", "fails", `answered ${answer.status} with \`${code(answer) ?? "no code"}\``);
      say("ENDP-12", "notExercised", "no 422 was provoked");
    }
  }

  // ACT-11: an Action that declares it does not complete within the call answers `202` and no
  // body. The declaration is read from the Descriptor, so a Worker that named the wrong Action
  // here fails on what it itself declared.
  const async = arrangement.asyncAction;
  if (async === undefined) {
    say("ACT-11", "notExercised", "no Action was named that does not complete within the call");
  } else if (actions[async.name]?.completesWithinCall !== false) {
    say("ACT-11", "fails", `\`${async.name}\` declares that it DOES complete within the call`);
  } else {
    const answer = await post(
      query(async.name),
      JSON.stringify(async.input),
      `\`${async.name}\`, which does not complete within the call`,
    );
    if (answer.status === 202 && answer.body.length === 0) say("ACT-11", "passes");
    else if (answer.status !== 202) say("ACT-11", "fails", `answered ${answer.status}, not 202`);
    else say("ACT-11", "fails", "answered 202 with a body");
  }
}

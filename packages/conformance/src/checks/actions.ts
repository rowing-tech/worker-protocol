import { actionsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
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
  "ACT-1",
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

  // ACT-1 to ACT-4, ACT-12 and ENDP-15 are read off the Descriptor, and a verifier fails the
  // Worker on them without sending anything at all.
  const declared = actionsEntry.safeParse(entry);
  if (!declared.success) {
    const blamed = new Set<string>();
    for (const issue of declared.error.issues) {
      const id = ruleFor(attribution, "actions-entry", issue.path) ?? "ACT-1";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    allExcept("notExercised", "the `actions` entry did not validate", [...blamed]);
    return { results, addresses };
  }

  const { actions } = declared.data as unknown as { actions: Record<string, Declaration> };
  for (const id of ["ACT-1", "ACT-2", "ACT-3", "ACT-4"]) say(id, "passes");

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
      "ACT-1",
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
    for (const id of ["ACT-6", "ACT-7", "ACT-8", "ENDP-3", "ENDP-18"]) {
      say(id, "notExercised", "the verifier was not permitted to POST to this Worker");
    }
    return { results, addresses };
  }

  const post = (parameters: string, body: string, intent: string, headers?: HeadersInit) =>
    transcript.send(`${url}${parameters}`, intent, { method: "POST", body, headers });

  const code = (answer: { json: unknown }) => (answer.json as { code?: string } | null)?.code;

  // ACT-7: a request naming no Action has not said what it wants, which is a parameter fault.
  const unnamed = await post("", "{}", "a POST naming no Action");
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

  // ACT-6: an Action the entry does not declare is a resource that does not exist, and nothing is
  // performed on the way to finding that out.
  const absent = await post(
    "?action=no-such-action-b7d2",
    "{}",
    "an Action the entry does not declare",
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
  const mismatched = await post(
    `?action=${encodeURIComponent(name)}`,
    "[]",
    "an input no schema could accept",
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
    );
    if (without.status === 400 && code(without) === "idempotency_key_required") {
      say("ENDP-18", "passes");
    } else {
      say("ENDP-18", "fails", `answered ${without.status} with \`${code(without) ?? "no code"}\``);
    }
  }

  return { results, addresses };
}

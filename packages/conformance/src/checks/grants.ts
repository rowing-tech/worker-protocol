import { grantPage, grantReceipt, taskPage } from "@worker-protocol/schemas";
import type { Arrangement } from "../index.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Transcript, withParams } from "../transcript.ts";

/**
 * GRANT-1 to GRANT-9: applying a grant, what its credential covers, and when a change takes effect.
 *
 * Everything past GRANT-1 issues or revokes a real credential on the Worker, so it waits for
 * `applyGrants` as well as `mayPerform`, as ACT-20 waits for settings its operators will let go of.
 * The verifier's own credential is the applicant. The grant it applies has an id of its own, covers
 * no Task type and no event type, and is revoked before this returns, whatever went wrong.
 */
export const CLAIMS = [
  "GRANT-1",
  "GRANT-2",
  "GRANT-3",
  "GRANT-4",
  "GRANT-5",
  "GRANT-6",
  "GRANT-7",
  "GRANT-8",
  "GRANT-9",
  "GRANT-10",
] as const;

const NEVER_DECLARED = "tech.rowing.worker-protocol.never-declared-by-anyone";

export async function checkGrants(given: {
  entry: unknown;
  url: string | null;
  descriptorUrl: string | null;
  /** GRANT-10: a surface of enrollment to read with the grant's credential. */
  healthUrl: string | null;
  actionsUrl: string | null;
  tasksUrl: string | null;
  /** The Actions the Worker declares, by name, for GRANT-8 and GRANT-9 to post one. */
  actions: string[];
  mayPerform: boolean;
  arrangement: Arrangement;
  rules: Map<string, Rule>;
  transcript: Transcript;
}): Promise<Result[]> {
  const { url, descriptorUrl, healthUrl, actionsUrl, tasksUrl, actions, arrangement, transcript } =
    given;
  const { results, say, allExcept } = verdicts(given.rules, CLAIMS);

  // GRANT-1: the entry carries an address. Read off the Descriptor, so it needs nothing arranged.
  if (given.entry === undefined) {
    allExcept("notExercised", "the Worker declares no `grants`");
    return results;
  }
  const address = (given.entry as { address?: unknown }).address;
  if (typeof address !== "string" || address.length === 0 || url === null) {
    say("GRANT-1", "fails", "the `grants` entry carries no address");
    allExcept("notExercised", "the `grants` entry carries no address", ["GRANT-1"]);
    return results;
  }
  say("GRANT-1", "passes");
  const at: string = url;
  if (!given.mayPerform || arrangement.applyGrants !== true) {
    allExcept("notExercised", "the verifier was not permitted to apply grants on this Worker", [
      "GRANT-1",
    ]);
    return results;
  }

  const id = `wp-conformance-${crypto.randomUUID().slice(0, 8)}`;
  const as = (credential: string) => ({ authorization: `Bearer ${credential}` });
  const apply = (body: Record<string, unknown>, intent: string, headers?: HeadersInit) =>
    transcript.send(at, intent, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const listed = async (intent: string, headers?: HeadersInit) => {
    const read = await transcript.send(at, intent, headers === undefined ? {} : { headers });
    const page = grantPage.safeParse(read.json);
    return { status: read.status, page: page.success ? page.data : null, raw: read.json };
  };
  const readsDescriptor = async (credential: string, intent: string) =>
    descriptorUrl === null
      ? null
      : (await transcript.send(descriptorUrl, intent, { headers: as(credential) })).status;
  const codeOf = (json: unknown) => (json as { code?: unknown } | null)?.code;
  /** GRANT-4, GRANT-5: the credential an application answered, where it answered one. */
  const credentialOf = (answer: { json: unknown }) => {
    const receipt = grantReceipt.safeParse(answer.json);
    return receipt.success ? receipt.data.credential : undefined;
  };
  /** GRANT-7: the verifier's grant revoked, as its applicant or as somebody else. */
  const revoke = (intent: string, headers?: HeadersInit) =>
    transcript.send(withParams(at, { grant: id }), intent, {
      method: "DELETE",
      ...(headers === undefined ? {} : { headers }),
    });

  // GRANT-3: a name the Worker does not declare is refused, and nothing is applied.
  const unknown = await apply(
    { id, tasks: [NEVER_DECLARED], actions: [], events: [] },
    "a grant naming a Task type the Worker does not declare",
  );
  if (unknown.status === 403) {
    allExcept(
      "notExercised",
      "the verifier's credential is not one this Worker accepts as an applicant",
      ["GRANT-1"],
    );
    return results;
  }
  const afterUnknown = await listed("the grants, after an unknown name");
  if (unknown.status !== 422 || codeOf(unknown.json) !== "unprocessable_content") {
    say("GRANT-3", "fails", `an undeclared Task type was answered ${unknown.status}, not 422`);
  } else if (afterUnknown.page?.items.some((one) => one.id === id)) {
    say("GRANT-3", "fails", "the grant naming an undeclared Task type was applied anyway");
  } else {
    say("GRANT-3", "passes");
  }

  let revoked = false;
  try {
    // GRANT-4: creating issues a credential, and the credential is one the Worker reads.
    const created = await apply(
      { id, tasks: [], actions: "all", events: [] },
      "a grant covering every Action and no Task type",
    );
    const first = credentialOf(created);
    if (created.status !== 201 || first === undefined) {
      say("GRANT-4", "fails", `creating a grant answered ${created.status} without a credential`);
      allExcept("notExercised", "no grant could be created", ["GRANT-1", "GRANT-3", "GRANT-4"]);
      return results;
    }
    const reads = await readsDescriptor(first, "the Descriptor, with the grant's credential");
    if (reads !== null && reads !== 200) {
      say("GRANT-4", "fails", `the credential it issued read the Descriptor ${reads}`);
    } else {
      say("GRANT-4", "passes");
    }

    // GRANT-2: a grant's credential never applies one.
    const byCredential = await apply(
      { id: `${id}-x`, tasks: [], actions: [], events: [] },
      "a grant applied with a grant's credential",
      as(first),
    );
    if (byCredential.status === 403 && codeOf(byCredential.json) === "forbidden") {
      say("GRANT-2", "passes");
    } else {
      say("GRANT-2", "fails", `a grant's credential applying one answered ${byCredential.status}`);
    }

    // GRANT-10: watching is enrollment, and no grant names it.
    if (healthUrl === null) {
      say("GRANT-10", "notExercised", "the Worker declares no `health` to read");
    } else {
      const watched = await transcript.send(healthUrl, "health, with the grant's credential", {
        headers: as(first),
      });
      if (watched.status === 403 && codeOf(watched.json) === "forbidden") {
        say("GRANT-10", "passes");
      } else {
        say(
          "GRANT-10",
          "fails",
          `a grant's credential read health and was answered ${watched.status}`,
        );
      }
    }

    // GRANT-8: no Task type, so no Tasks; every Action, so a declared one is not refused `403`.
    const action = actions[0];
    const post = (credential: string, intent: string) =>
      actionsUrl === null || action === undefined
        ? null
        : transcript.send(withParams(actionsUrl, { action }), intent, {
            method: "POST",
            headers: { ...as(credential), "content-type": "application/json" },
            body: "not json",
          });
    const tasks =
      tasksUrl === null
        ? null
        : taskPage.safeParse(
            (
              await transcript.send(tasksUrl, "Tasks, with the grant's credential", {
                headers: as(first),
              })
            ).json,
          );
    const covered = await post(first, `${action}, covered by the grant`);
    if (tasks?.success === true && tasks.data.items.length > 0) {
      say("GRANT-8", "fails", "a credential whose grant names no Task type read Tasks");
    } else if (covered !== null && (covered.status === 403 || covered.status === 401)) {
      say("GRANT-8", "fails", `an Action its grant covers was refused ${covered.status}`);
    } else if (tasks === null && covered === null) {
      say("GRANT-8", "notExercised", "the Worker declares neither `tasks` nor any Action");
    } else {
      say("GRANT-8", "passes");
    }

    // GRANT-5, first half: applying again replaces and issues nothing. GRANT-9, narrowing: what the
    // credential no longer covers is `403`, and the credential is still read.
    const narrowed = await apply(
      { id, tasks: [], actions: [], events: [] },
      "the same grant, narrowed to no Action",
    );
    const replacedWell =
      narrowed.status === 200 &&
      grantReceipt.safeParse(narrowed.json).success &&
      credentialOf(narrowed) === undefined;
    const lost = await post(first, `${action}, after the grant was narrowed`);

    // GRANT-6: the applicant's own grant, without a credential; another caller's list without it.
    const mine = await listed("the grants, as their applicant");
    const entry = mine.page?.items.find((one) => one.id === id);
    const leaked = JSON.stringify(mine.raw ?? null).includes(first);
    const other = arrangement.otherCallerCredential;
    const theirs =
      other === undefined ? null : await listed("the grants, as another caller", as(other));
    if (mine.status !== 200 || entry === undefined) {
      say("GRANT-6", "fails", "the applicant's list did not carry the grant it applied");
    } else if (leaked) {
      say("GRANT-6", "fails", "the list carried the credential");
    } else if (theirs?.page?.items.some((one) => one.id === id)) {
      say("GRANT-6", "fails", "another caller's list carried this applicant's grant");
    } else {
      say("GRANT-6", "passes");
    }

    // GRANT-5, second half: a rotation issues a new credential and the previous one is `401`.
    const rotated = await apply(
      { id, tasks: [], actions: [], events: [], rotate: true },
      "the same grant, rotated",
    );
    const second = credentialOf(rotated);
    const old = await readsDescriptor(first, "the Descriptor, with the credential rotated away");
    if (!replacedWell) {
      say("GRANT-5", "fails", `applying again answered ${narrowed.status}, or issued a credential`);
    } else if (rotated.status !== 200 || second === undefined || second === first) {
      say("GRANT-5", "fails", "a rotation did not answer a new credential");
    } else if (old !== null && old !== 401) {
      say("GRANT-5", "fails", `the credential a rotation replaced read the Descriptor ${old}`);
    } else {
      say("GRANT-5", "passes");
    }

    // GRANT-7: another caller cannot revoke it; its applicant can, once.
    const stranger =
      other === undefined ? null : await revoke("revoking, as another caller", as(other));
    const revoking = await revoke("revoking the grant");
    revoked = revoking.status === 204;
    const again = await revoke("revoking it again");
    if (stranger !== null && stranger.status !== 404 && stranger.status !== 403) {
      say("GRANT-7", "fails", `another caller revoking it was answered ${stranger.status}`);
    } else if (!revoked) {
      say("GRANT-7", "fails", `revoking was answered ${revoking.status}, not 204`);
    } else if (again.status !== 404 || codeOf(again.json) !== "not_found") {
      say("GRANT-7", "fails", `revoking an id it no longer holds was answered ${again.status}`);
    } else {
      say("GRANT-7", "passes");
    }

    // GRANT-9: narrowed is `403` and still read; revoked is `401`.
    const gone =
      second === undefined ? null : await readsDescriptor(second, "the Descriptor, revoked");
    if (lost !== null && lost.status !== 403) {
      say("GRANT-9", "fails", `an Action narrowed away was answered ${lost.status}, not 403`);
    } else if (gone !== null && gone !== 401) {
      say("GRANT-9", "fails", `a revoked credential read the Descriptor ${gone}, not 401`);
    } else if (lost === null && gone === null) {
      say("GRANT-9", "notExercised", "neither a narrowing nor a revocation could be observed");
    } else {
      say("GRANT-9", "passes");
    }
  } finally {
    if (!revoked) await revoke("revoking the grant, cleaning up");
  }
  return results;
}

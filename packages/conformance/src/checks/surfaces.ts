import type { Result, Rule } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * What calling each declared address establishes, before any Capability's own file is consulted.
 *
 * DESC-18 is here rather than beside the Descriptor because its witness is a declared address
 * answering `404`, which needs the call the Descriptor check deliberately does not make.
 */
export const CLAIMS = [
  "DESC-18",
  "REG-3",
  "REG-7",
  "REG-21",
  "ENDP-2",
  "ENDP-6",
  "ENDP-24",
] as const;

export type Surface = { capability: string; url: string };

/**
 * Capabilities whose surface is written rather than read.
 *
 * DESC-18's witness is a declared address answering `404`, and this sweep finds it with a GET —
 * which is the right question for every surface but one. ENDP-3 puts everything that changes state
 * behind a POST, so the Actions address answers `404` to a GET while serving perfectly well, and a
 * check that read that as an undeclared surface would fail a conformant Worker on the one
 * Capability that does anything. `checks/actions.ts` judges that address instead, with the POST it
 * had to ask permission for.
 */
const WRITTEN = new Set(["actions"]);

export async function callSurfaces(
  surfaces: Surface[],
  descriptorUrl: string,
  rules: Map<string, Rule>,
  transcript: Transcript,
  credential: string | undefined,
): Promise<Result[]> {
  const results: Result[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };

  if (surfaces.length === 0) {
    say("DESC-18", "passes", "the Descriptor declares no address, so none can be missing");
  }

  const missing: string[] = [];
  const refused: string[] = [];
  const answered: { capability: string; url: string; body: string }[] = [];

  for (const surface of surfaces) {
    if (WRITTEN.has(surface.capability)) continue;
    let answer: Awaited<ReturnType<Transcript["send"]>>;
    try {
      answer = await transcript.send(surface.url, `the \`${surface.capability}\` address`);
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : String(cause);
      missing.push(`\`${surface.capability}\` at ${surface.url} could not be reached: ${why}`);
      continue;
    }

    // DESC-18: a Descriptor that declares a Capability the Worker does not serve is a fault in the
    // Descriptor, not in the surface — so the finding is reported against the document.
    if (answer.status === 404) {
      missing.push(`\`${surface.capability}\` is declared at ${surface.url} and answers 404`);
    }

    // REG-21: a Worker accepts the credential recorded for it on every address this protocol
    // defines. A surface that refuses the recorded credential is not a surface a Tower can poll.
    if (answer.status === 401 || answer.status === 403) {
      refused.push(`\`${surface.capability}\` at ${surface.url} answered ${answer.status}`);
    }

    if (answer.status === 200) {
      answered.push({ capability: surface.capability, url: surface.url, body: answer.body });
    }
  }

  if (surfaces.length > 0) {
    if (missing.length === 0) say("DESC-18", "passes");
    else say("DESC-18", "fails", missing.join("; "));
  }

  await probeReads(answered, transcript, say);

  if (credential === undefined) {
    // Without one there is nothing to present, and a Worker that reads openly is conformant —
    // registration.md says in as many words that a Worker may answer more than REG-21 requires.
    for (const id of ["REG-3", "REG-7", "REG-21"]) {
      say(id, "notExercised", "no credential was given to the verifier");
    }
    return results;
  }

  if (refused.length === 0) {
    say("REG-21", "passes");
    // REG-3 fixes only how a credential is presented. What establishes it is that the Worker read
    // one arriving as `Authorization: Bearer <token>` — which is what every call above did.
    say("REG-3", "passes");
  } else {
    say("REG-21", "fails", refused.join("; "));
    say("REG-3", "notExercised", "the recorded credential was refused, so nothing read it");
  }

  // REG-7: a Worker does not answer 404 in place of 401 or 403 on an address it serves. The
  // Descriptor's route is the one address every Worker has, and it answered above, so it is served
  // by definition — which is exactly the precondition the rule needs.
  const wrong = `${credential}-is-not-this`;
  let probe: Awaited<ReturnType<Transcript["send"]>>;
  try {
    probe = await transcript.send(
      descriptorUrl,
      "the Descriptor with a credential it never issued",
      {
        headers: { authorization: `Bearer ${wrong}` },
      },
    );
  } catch {
    say("REG-7", "notExercised", "the Descriptor route could not be reached a second time");
    return results;
  }

  if (probe.status === 404) {
    say("REG-7", "fails", "the Descriptor route answered 404 to a credential it does not accept");
  } else if (probe.status === 401 || probe.status === 403) {
    say("REG-7", "passes");
  } else {
    // A Worker that serves its Descriptor openly is conformant (REG-31 only recommends a
    // credential on addresses that change state), and there is then no refusal to judge.
    say("REG-7", "notExercised", `the Worker answered ${probe.status} rather than refusing`);
  }

  return results;
}

/**
 * What a declared surface can be asked, once it is known to answer.
 *
 * These are the last rules in [endpoints](../../../spec/endpoints.md) with a witness against an
 * ordinary Worker, and each needs a request nothing else in a run would send: a parameter the
 * Worker cannot know, a Capability version it cannot answer, a read repeated to see whether it
 * changed anything.
 */
async function probeReads(
  answered: { capability: string; url: string; body: string }[],
  transcript: Transcript,
  say: (id: string, verdict: Result["verdict"], detail?: string) => void,
): Promise<void> {
  if (answered.length === 0) {
    for (const id of ["ENDP-2", "ENDP-6", "ENDP-24"]) {
      say(id, "notExercised", "no declared surface answered");
    }
    return;
  }

  // ENDP-2: a GET changes nothing a later reader could observe. As with DESC-5 this is the weakest
  // form and the honest one — a verifier cannot prove the absence of a side effect, only catch a
  // Worker whose read has one it shows. A collection is where it would show: listing a Worker's
  // open Tasks must not consume them.
  const changed: string[] = [];
  for (const surface of answered) {
    const again = await transcript.send(
      surface.url,
      `the \`${surface.capability}\` address, again`,
    );
    if (again.status !== 200) {
      changed.push(`\`${surface.capability}\` answered ${again.status} on a second read`);
      continue;
    }
    if (again.body !== surface.body) changed.push(`\`${surface.capability}\` answered differently`);
  }

  if (changed.length === 0) say("ENDP-2", "passes");
  else say("ENDP-2", "fails", changed.join("; "));

  // ENDP-24: an unrecognized filter parameter is 400, and is never ignored.
  const ignored: string[] = [];
  for (const surface of answered) {
    const probed = new URL(surface.url);
    probed.searchParams.set("no-such-filter-8e31", "1");
    const answer = await transcript.send(probed.toString(), "a filter the Worker cannot know");
    const code = (answer.json as { code?: string } | null)?.code;
    if (answer.status !== 400 || code !== "unknown_filter") {
      ignored.push(
        `\`${surface.capability}\` answered ${answer.status} with \`${code ?? "no code"}\``,
      );
    }
  }
  if (ignored.length === 0) say("ENDP-24", "passes");
  else say("ENDP-24", "fails", ignored.join("; "));

  // ENDP-6: a caller may state the Capability version it expects, and a Worker that cannot answer
  // it refuses the request whole rather than substituting its own. A version no edition will reach
  // soon is the only way to ask without a Worker having to cooperate.
  const unanswerable: string[] = [];
  for (const surface of answered) {
    const answer = await transcript.send(
      surface.url,
      "a Capability version the Worker cannot answer",
      {
        headers: { "worker-protocol-capability-version": "99999" },
      },
    );
    const code = (answer.json as { code?: string } | null)?.code;
    if (answer.status !== 400 || code !== "unsupported_version") {
      unanswerable.push(
        `\`${surface.capability}\` answered ${answer.status} with \`${code ?? "no code"}\``,
      );
    }
  }
  if (unanswerable.length === 0) say("ENDP-6", "passes");
  else say("ENDP-6", "fails", unanswerable.join("; "));
}

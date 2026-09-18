import type { Result, Rule } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * What calling each declared address establishes, before any Capability's own file is consulted.
 *
 * DESC-18 is here rather than beside the Descriptor because its witness is a declared address
 * answering `404`, which needs the call the Descriptor check deliberately does not make.
 */
export const CLAIMS = ["DESC-18", "REG-3", "REG-7", "REG-21"] as const;

export type Surface = { capability: string; url: string };

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

  for (const surface of surfaces) {
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
  }

  if (surfaces.length > 0) {
    if (missing.length === 0) say("DESC-18", "passes");
    else say("DESC-18", "fails", missing.join("; "));
  }

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

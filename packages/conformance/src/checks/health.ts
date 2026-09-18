import { health as healthSchema } from "@worker-protocol/schemas";
import type { Result, Rule } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * The `health` Capability.
 *
 * HLTH-4 is absent and will stay absent until the reference Worker is arranged for it: a Worker
 * that has not yet established its state answers `unhealthy`, and the only window in which that is
 * observable is between a process starting and its first evaluation.
 * `conformance/verifiability.md` classifies it `H` for exactly that reason.
 */
export const CLAIMS = ["HLTH-1", "HLTH-2", "HLTH-3", "HLTH-5"] as const;

export async function checkHealth(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  rules: Map<string, Rule>,
  transcript: Transcript,
): Promise<Result[]> {
  const results: Result[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };

  if (entry === undefined) {
    // DESC-2: a Worker that declares no `health` is conformant, and DESC-1's argument says what
    // stands in for it — the Tower fetches the Descriptor on a schedule anyway.
    for (const id of CLAIMS) say(id, "notExercised", "the Worker declares no `health`");
    return results;
  }

  // HLTH-1: a `health` entry declares an address. A verifier sees this in the Descriptor and fails
  // the Worker without calling anything.
  if (typeof entry.address !== "string" || entry.address.length === 0) {
    say("HLTH-1", "fails", "the `health` entry declares no address");
    for (const id of ["HLTH-2", "HLTH-3", "HLTH-5"]) {
      say(id, "notExercised", "there is no address to poll");
    }
    return results;
  }
  say("HLTH-1", "passes");

  if (url === null) {
    for (const id of ["HLTH-2", "HLTH-3", "HLTH-5"]) {
      say(id, "notExercised", "the declared address did not resolve");
    }
    return results;
  }

  let answer: Awaited<ReturnType<Transcript["send"]>>;
  try {
    answer = await transcript.send(url, "the `health` address");
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    for (const id of ["HLTH-2", "HLTH-3", "HLTH-5"]) {
      say(id, "notExercised", `${url} could not be reached: ${why}`);
    }
    return results;
  }

  // HLTH-5: a Worker answers its health address 200 whatever it reports. Anything else means the
  // Worker did not answer, not that it is unwell — which is the one distinction a health surface
  // exists to draw, and the one `503` destroys.
  if (answer.status === 200) {
    say("HLTH-5", "passes");
  } else {
    say("HLTH-5", "fails", `answered ${answer.status}; the status is read from the body`);
  }

  const parsed = healthSchema.safeParse(answer.json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    say("HLTH-2", "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    say("HLTH-3", "notExercised", "the answer did not validate, so it could not be judged");
    return results;
  }
  say("HLTH-2", "passes");

  // HLTH-3: a Worker does not answer `healthy` while any check it reports is not. It is what stops
  // the summary from being decorative — the one field every console renders first.
  const unwell = Object.entries(parsed.data.checks).filter(([, c]) => c.status !== "healthy");
  if (parsed.data.status === "healthy" && unwell.length > 0) {
    const names = unwell.map(([name, c]) => `${name} is ${c.status}`).join(", ");
    say("HLTH-3", "fails", `the Worker answers \`healthy\` while ${names}`);
  } else {
    say("HLTH-3", "passes");
  }

  return results;
}

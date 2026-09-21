import { type Result, type Rule, verdicts } from "../report.ts";
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
 * had to ask permission for, and `checks/nudges.ts` does the same for the other one.
 */
const WRITTEN = new Set(["actions", "nudges"]);

export async function callSurfaces(
  surfaces: Surface[],
  descriptorUrl: string,
  writeAddresses: string[],
  rules: Map<string, Rule>,
  transcript: Transcript,
  credential: string | undefined,
  mayPerform: boolean,
): Promise<Result[]> {
  const { results, say } = verdicts(rules, CLAIMS);

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

  await probeReads(answered, writeAddresses, mayPerform, transcript, say);

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
      { headers: { authorization: `Bearer ${wrong}` }, permanent: true },
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
  writeAddresses: string[],
  mayPerform: boolean,
  transcript: Transcript,
  say: (id: string, verdict: Result["verdict"], detail?: string) => void,
): Promise<void> {
  // A Worker whose only declared surface is written — a thin proxy that accepts an operation and
  // passes it on, which DESC-1's argument names as a Worker worth admitting — has nothing to read
  // twice and nothing to hand an unknown filter to. ENDP-6 is not in that position: it is about a
  // REQUEST, and a write is one, so it goes on below with whatever write addresses there are.
  if (answered.length === 0) {
    for (const id of ["ENDP-2", "ENDP-24"]) {
      say(id, "notExercised", "no declared surface answered a read");
    }
    if (writeAddresses.length === 0 || !mayPerform) {
      say("ENDP-6", "notExercised", "no surface was reachable to state a version at");
      return;
    }
  }

  // ENDP-2: a GET changes nothing a later reader could observe.
  //
  // **What is compared is which items came back, not which bytes.** Byte equality was the first
  // form of this check and it was wrong in a way that only shows against a real Worker: a health
  // `detail` carrying an observed value, or any surface whose facts moved between two reads,
  // answers different bytes having changed nothing. Failing that Worker would be this tool
  // inventing an obligation nobody wrote.
  //
  // What the rule is actually about is stated in its own argument: listing a Worker's open Tasks
  // does not consume them, reading its Alerts does not dismiss them. The witness is items that
  // were there and are gone, with none arriving — a read that empties what it read. That is not
  // airtight either, because a Task may close on its own between two calls, and the detail says
  // what was compared so a reader can weigh it.
  const items = (payload: string): string[] | null => {
    try {
      const parsed = JSON.parse(payload) as { items?: unknown };
      if (!Array.isArray(parsed.items)) return null;
      return parsed.items.map((item) =>
        typeof item === "object" && item !== null && "id" in item
          ? String((item as { id: unknown }).id)
          : JSON.stringify(item),
      );
    } catch {
      return null;
    }
  };

  const emptied: string[] = [];
  let collections = 0;
  for (const surface of answered) {
    const again = await transcript.send(
      surface.url,
      `the \`${surface.capability}\` address, again`,
    );
    if (again.status !== 200) {
      emptied.push(`\`${surface.capability}\` answered ${again.status} on a second read`);
      continue;
    }
    const before = items(surface.body);
    const after = items(again.body);
    if (before === null || after === null) continue;
    collections += 1;

    const present = new Set(after);
    const gone = before.filter((id) => !present.has(id));
    const arrived = after.filter((id) => !new Set(before).has(id));
    if (gone.length > 0 && arrived.length === 0) {
      emptied.push(`\`${surface.capability}\` lost ${gone.length} item(s) to being read`);
    }
  }

  if (answered.length > 0) {
    if (emptied.length > 0) say("ENDP-2", "fails", emptied.join("; "));
    else if (collections === 0) {
      say("ENDP-2", "notExercised", "no declared surface answered a collection to read twice");
    } else {
      say("ENDP-2", "passes", "every collection answered the same items on a second read");
    }
  }

  // ENDP-24: an unrecognized filter parameter is 400, and is never ignored.
  const ignored: string[] = [];
  for (const surface of answered) {
    const probed = new URL(surface.url);
    probed.searchParams.set("no-such-filter-8e31", "1");
    const answer = await transcript.send(probed.toString(), "a filter the Worker cannot know", {
      permanent: true,
    });
    const code = (answer.json as { code?: string } | null)?.code;
    if (answer.status !== 400 || code !== "unknown_filter") {
      ignored.push(
        `\`${surface.capability}\` answered ${answer.status} with \`${code ?? "no code"}\``,
      );
    }
  }
  if (answered.length > 0) {
    if (ignored.length === 0) say("ENDP-24", "passes");
    else say("ENDP-24", "fails", ignored.join("; "));
  }

  // ENDP-6: a caller may state the Capability version it expects, and a Worker that cannot answer
  // it refuses the request WHOLE rather than substituting its own. A version no edition will reach
  // soon is the only way to ask without a Worker having to cooperate.
  //
  // The write addresses are probed too, and they are where the rule matters most: a Worker that
  // refuses an unanswerable version on a read and PERFORMS one on a write has done the thing the
  // rule exists to prevent, on the calls where being wrong costs something. They are POSTs, so
  // they need `mayPerform` — and a Worker that obeys the rule performs nothing, which is why
  // asking is safe once permission is given.
  const unanswerable: string[] = [];
  const probes: { what: string; url: string; init: RequestInit & { permanent?: boolean } }[] = [
    ...answered.map((surface) => ({
      what: `\`${surface.capability}\``,
      url: surface.url,
      init: { headers: { "worker-protocol-capability-version": "99999" }, permanent: true },
    })),
    ...(mayPerform
      ? writeAddresses.map((url) => ({
          what: `the write address ${url}`,
          url,
          init: {
            method: "POST",
            body: "{}",
            headers: { "worker-protocol-capability-version": "99999" },
            permanent: true,
          },
        }))
      : []),
  ];

  for (const probe of probes) {
    const answer = await transcript.send(
      probe.url,
      "a Capability version the Worker cannot answer",
      probe.init,
    );
    const code = (answer.json as { code?: string } | null)?.code;
    if (answer.status !== 400 || code !== "unsupported_version") {
      unanswerable.push(`${probe.what} answered ${answer.status} with \`${code ?? "no code"}\``);
    }
  }
  if (unanswerable.length === 0) say("ENDP-6", "passes");
  else say("ENDP-6", "fails", unanswerable.join("; "));
}

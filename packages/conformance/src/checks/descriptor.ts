import {
  capabilityName,
  descriptor as descriptorSchema,
  vendorCapabilityName,
} from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import type { Transcript } from "../transcript.ts";

/**
 * What the Descriptor document alone establishes.
 *
 * Every rule here is one `conformance/verifiability.md` classifies `W`, and every one of them is
 * reached without calling a single declared address — which is why this is the slice the verifier
 * started with: it is the only surface a Worker is required to have at all (DESC-1).
 *
 * DESC-18 is deliberately absent. It is `W`, but its witness is a declared address answering 404,
 * so it belongs with the checks that call one.
 */
export const CLAIMS = [
  "DESC-1",
  "DESC-3",
  "DESC-5",
  "DESC-6",
  "DESC-8",
  "DESC-9",
  "DESC-12",
  "DESC-14",
  "DESC-22",
  "DESC-23",
  // TASK-31 lives here rather than in the tasks check because `skills` is on the ROOT: a Worker
  // that only ANSWERS Tasks declares a Skill and no `tasks` Capability at all, and a verdict
  // reached only through that Capability would have been silent about exactly that Worker.
  "TASK-31",
] as const;

export type Descriptor = {
  id: string;
  edition: string;
  /** TASK-31. Absent for a Worker with no Skill, which DESC-2 admits of anything it does not do. */
  skills?: Record<string, unknown>;
  capabilities: Record<string, Record<string, unknown>>;
};

export type DescriptorReading = {
  results: Result[];
  /** The document, where one was read and validated. Later checks need its addresses. */
  document: Descriptor | null;
  /** The route it was read from, which later checks probe again. */
  url: string | null;
  /** Each declared address resolved against that route (DESC-12). */
  surfaces: { capability: string; url: string }[];
};

const ROUTE = ".well-known/worker-protocol";

export async function readDescriptor(
  baseUrl: string,
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
): Promise<DescriptorReading> {
  const { results, say } = verdicts(rules, CLAIMS);
  const nothingRead = (why: string, except: string[]) => {
    for (const id of CLAIMS) if (!except.includes(id)) say(id, "notExercised", why);
  };

  // DESC-3 is answered before anything is called, because its subject is the enrolled base URL and
  // not the document. A verifier that reached the Worker over plaintext has already established
  // the fault, and says so without pretending a call proved it.
  let base: URL;
  try {
    base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    say("DESC-3", "fails", `not a URL: ${baseUrl}`);
    nothingRead("no Descriptor could be read", ["DESC-3"]);
    return { results, document: null, url: null, surfaces: [] };
  }

  if (base.protocol === "https:") say("DESC-3", "passes");
  else say("DESC-3", "fails", `the base URL is \`${base.protocol}\` and DESC-3 fixes \`https\``);

  const url = new URL(ROUTE, base).toString();

  let first: Awaited<ReturnType<Transcript["send"]>>;
  try {
    first = await transcript.send(url, "the Descriptor route");
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    say("DESC-1", "fails", `${url} could not be reached: ${why}`);
    nothingRead("no Descriptor could be read", ["DESC-1", "DESC-3"]);
    return { results, document: null, url, surfaces: [] };
  }

  if (first.status < 200 || first.status >= 300) {
    say("DESC-1", "fails", `${url} answered ${first.status}`);
    nothingRead("no Descriptor could be read", ["DESC-1", "DESC-3"]);
    return { results, document: null, url, surfaces: [] };
  }

  if (first.json === null) {
    say("DESC-1", "fails", `${url} did not answer JSON`);
    nothingRead("the Descriptor did not parse", ["DESC-1", "DESC-3"]);
    return { results, document: null, url, surfaces: [] };
  }

  // DESC-5: a GET changes nothing a later reader could observe, so the same request answers the
  // same document. This is the weakest form of the check and it is the honest one — a verifier
  // cannot prove the absence of a side effect, only catch a Worker whose read has one it shows.
  const second = await transcript.send(url, "the Descriptor route, a second time");
  if (second.status === first.status && second.body === first.body) say("DESC-5", "passes");
  else say("DESC-5", "fails", "a second GET of the Descriptor answered something else");

  const validation = descriptorSchema.safeParse(first.json);

  /**
   * DESC-8 and DESC-14, judged before the document as a whole.
   *
   * The attribution map cannot reach these, and the reason is worth stating rather than working
   * around: the key schema is a union of the reserved enumeration and the vendor pattern, and a
   * key that fails it matched neither — so nothing in `schemas/` says which branch it was reaching
   * for. Attribution would land on DESC-22, and DESC-8 would become a rule that can pass and never
   * fail, which is a check that only knows how to say yes.
   *
   * What tells them apart is DESC-14 itself: a name containing a `.` is the Worker's own, and a
   * name without one is reserved to the edition or is nothing. That is the rule, applied — not the
   * verifier deciding anything — and the enumeration it compares against is `capabilityName`,
   * which is the normative list DESC-8 points at.
   */
  const keys = Object.keys(
    (first.json as { capabilities?: Record<string, unknown> })?.capabilities ?? {},
  );
  const reserved = new Set<string>(capabilityName.options);
  const unknownReserved = keys.filter((key) => !key.includes(".") && !reserved.has(key));
  const malformedVendor = keys.filter(
    (key) => key.includes(".") && !vendorCapabilityName.safeParse(key).success,
  );

  const judgedKeys = new Set<string>();
  if (unknownReserved.length > 0) {
    judgedKeys.add("DESC-8");
    const names = unknownReserved.map((k) => `\`${k}\``).join(", ");
    say("DESC-8", "fails", `${names}: undotted, and this edition defines no such Capability`);
  }
  if (malformedVendor.length > 0) {
    judgedKeys.add("DESC-14");
    const names = malformedVendor.map((k) => `\`${k}\``).join(", ");
    say("DESC-14", "fails", `${names}: dotted, and not a well-formed vendor Capability name`);
  }

  if (!validation.success) {
    // A report that answered "the Descriptor is invalid" would be the failure the rule ids exist
    // to prevent: an operator cannot act on it, and two very different faults read identically.
    // The rule each issue belongs to is read off `schemas/` rather than judged here — see
    // `src/attribution.ts` for why that distinction is worth the machinery.
    const blamed = new Set<string>(judgedKeys);
    // Where a key was already judged precisely above, the map's coarser verdict on the same fault
    // is suppressed: DESC-22 is about the map's shape, and reporting it beside DESC-8 would give
    // an operator two findings for one mistake and send them to the wrong one first.
    if (judgedKeys.size > 0) blamed.add("DESC-22");
    for (const issue of validation.error.issues) {
      const id = ruleFor(attribution, "descriptor", issue.path) ?? "DESC-1";
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    nothingRead("the Descriptor did not validate, so this could not be judged", [
      "DESC-3",
      "DESC-5",
      ...blamed,
    ]);
    return { results, document: null, url, surfaces: [] };
  }

  const document = validation.data as Descriptor;
  say("DESC-1", "passes");
  // TASK-31: what this Worker answers, which is what a Tower catalogs it by. Absent is conformant
  // and is not a pass — a Worker with no Skill exercised nothing, and saying so is the difference
  // between a report that was checked and one that had nothing to check.
  if (document.skills === undefined) {
    say("TASK-31", "notExercised", "the Worker declares no Skill");
  } else {
    say("TASK-31", "passes");
  }

  // DESC-6: the id is not the URL it is served from. DESC-27 and DESC-28 carry the clauses nothing
  // outside can reach, and the report marks those unverified rather than passing them here.
  const addresses = [base.toString(), base.toString().replace(/\/$/, ""), url];
  if (addresses.includes(document.id)) {
    say("DESC-6", "fails", "the id is the URL the Descriptor is served from");
  } else {
    say("DESC-6", "passes");
  }

  // The rest are what validation established. Saying so per rule rather than once is the whole
  // point of the ids: a reader learns which obligations were actually judged.
  for (const id of ["DESC-8", "DESC-9", "DESC-12", "DESC-14", "DESC-22", "DESC-23"]) {
    if (!judgedKeys.has(id)) say(id, "passes");
  }

  // DESC-12: an address is an absolute https URL, or a relative reference resolved against the URL
  // the Descriptor was read from — which is this route, not the base URL.
  const surfaces: { capability: string; url: string }[] = [];
  for (const [capability, entry] of Object.entries(document.capabilities)) {
    if (typeof entry.address !== "string") continue;
    try {
      surfaces.push({ capability, url: new URL(entry.address, url).toString() });
    } catch {
      // Unreachable while validation passed, and swallowing it silently would be the one thing
      // this file exists against — so it is left to DESC-12, which validation already judged.
    }
  }

  return { results, document, url, surfaces };
}

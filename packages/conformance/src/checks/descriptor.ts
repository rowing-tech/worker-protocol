import { descriptor as descriptorSchema } from "@worker-protocol/schemas";
import type { Result, Rule } from "../report.ts";

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
] as const;

export type DescriptorReading = {
  results: Result[];
  /** The document, where one was read and validated. Later checks need its addresses. */
  document: { id: string; edition: string; capabilities: Record<string, unknown> } | null;
};

const ROUTE = ".well-known/worker-protocol";

/**
 * Which rule a schema failure belongs to.
 *
 * A report that answered "the Descriptor is invalid" would be the failure the rule ids exist to
 * prevent — an operator cannot act on it, and two very different faults read identically. So each
 * issue path is attributed to the rule that states the thing it broke, and anything unattributed
 * falls to DESC-1, which is the rule that a Worker serves a Descriptor at all.
 */
const attribute = (path: PropertyKey[]): string => {
  const [head, , leaf] = path;
  if (head === "edition") return "DESC-23";
  if (head === "id") return "DESC-6";
  if (head === "capabilities") {
    if (path.length === 1) return "DESC-22";
    if (leaf === "version") return "DESC-9";
    if (leaf === "address") return "DESC-12";
    // A key that is neither a reserved name nor a well-formed vendor one. DESC-14 draws that line
    // and DESC-8 holds the reserved list, so which of the two is wrong depends on the dot.
    return String(path[1]).includes(".") ? "DESC-14" : "DESC-8";
  }
  return path.length === 0 ? "DESC-22" : "DESC-1";
};

export async function readDescriptor(
  baseUrl: string,
  rules: Map<string, Rule>,
  request: (url: string) => Promise<Response>,
): Promise<DescriptorReading> {
  const results: Result[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };

  // DESC-3 is answered before anything is called, because its subject is the enrolled base URL and
  // not the document. A verifier that reached the Worker over plaintext has already established
  // the fault, and says so without pretending a call proved it.
  let base: URL;
  try {
    base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    say("DESC-3", "fails", `not a URL: ${baseUrl}`);
    for (const id of CLAIMS) {
      if (id !== "DESC-3") say(id, "notExercised", "no Descriptor could be read");
    }
    return { results, document: null };
  }

  if (base.protocol !== "https:") {
    say("DESC-3", "fails", `the base URL is \`${base.protocol}\` and DESC-3 fixes \`https\``);
  } else {
    say("DESC-3", "passes");
  }

  const url = new URL(ROUTE, base).toString();

  let first: Response;
  let body: string;
  try {
    first = await request(url);
    body = await first.text();
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    say("DESC-1", "fails", `${url} could not be reached: ${why}`);
    for (const id of CLAIMS) {
      if (id !== "DESC-1" && id !== "DESC-3") {
        say(id, "notExercised", "no Descriptor could be read");
      }
    }
    return { results, document: null };
  }

  if (!first.ok) {
    say("DESC-1", "fails", `${url} answered ${first.status}`);
    for (const id of CLAIMS) {
      if (id !== "DESC-1" && id !== "DESC-3") {
        say(id, "notExercised", "no Descriptor could be read");
      }
    }
    return { results, document: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    say("DESC-1", "fails", `${url} did not answer JSON`);
    for (const id of CLAIMS) {
      if (id !== "DESC-1" && id !== "DESC-3") {
        say(id, "notExercised", "the Descriptor did not parse");
      }
    }
    return { results, document: null };
  }

  const validation = descriptorSchema.safeParse(parsed);

  // DESC-5: a GET changes nothing a later reader could observe, so the same request answers the
  // same document. This is the weakest form of the check and it is the honest one — a verifier
  // cannot prove the absence of a side effect, only catch a Worker whose read has one it shows.
  const second = await request(url);
  const again = await second.text();
  if (second.ok && again === body) {
    say("DESC-5", "passes");
  } else {
    say("DESC-5", "fails", "a second GET of the Descriptor answered something else");
  }

  if (!validation.success) {
    const blamed = new Set<string>();
    for (const issue of validation.error.issues) {
      const id = attribute(issue.path);
      if (blamed.has(id)) continue;
      blamed.add(id);
      say(id, "fails", `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    for (const id of CLAIMS) {
      if (id === "DESC-3" || id === "DESC-5" || blamed.has(id)) continue;
      say(id, "notExercised", "the Descriptor did not validate, so this could not be judged");
    }
    return { results, document: null };
  }

  const document = validation.data;
  say("DESC-1", "passes");

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
    say(id, "passes");
  }

  return { results, document };
}

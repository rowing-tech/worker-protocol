import { error as errorSchema } from "@worker-protocol/schemas";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Exchange, isJson } from "../transcript.ts";

/**
 * The rules that are about every response rather than about one surface.
 *
 * These run last, over the whole transcript, because several of them are statements no single
 * exchange can break: ENDP-26 forbids one code arriving under two statuses, which is a fact about
 * a set. A check that asked it inside one surface would be asking a question it could not answer.
 */
export const CLAIMS = [
  "ENDP-1",
  "ENDP-11",
  "ENDP-4",
  "ENDP-5",
  "ENDP-19",
  "ENDP-25",
  "ENDP-26",
  "ENDP-29",
] as const;

/** The status and class each code fixes, generated from endpoints.md into rules.json (ENDP-26). */
export type Code = { code: string; status: number; class: "reject" | "retry" };

export function judgeTranscript(
  exchanges: Exchange[],
  codes: Code[],
  declared: Set<string>,
  rules: Map<string, Rule>,
): Result[] {
  const { results, say } = verdicts(rules, CLAIMS);

  if (exchanges.length === 0) {
    for (const id of CLAIMS) say(id, "notExercised", "no response was collected");
    return results;
  }

  /**
   * ENDP-1 is about an address, not about a URL.
   *
   * A read carries its parameters in the query string — MET-16 spells a dimension into one — and
   * comparing whole URLs would report every filtered read as an undeclared address. What the
   * Descriptor declares is where a surface answers; what a caller puts after the `?` is the
   * question it asks there, and each surface's own file says which parameters those are.
   */
  const address = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  const addresses = new Set([...declared].map(address));

  const byCode = new Map(codes.map((c) => [c.code, c]));
  const failures = new Map<string, string[]>();
  const fail = (id: string, why: string) => {
    const already = failures.get(id);
    if (already) already.push(why);
    else failures.set(id, [why]);
  };

  for (const exchange of exchanges) {
    const where = `${exchange.method} ${exchange.url} → ${exchange.status}`;

    // ENDP-1: every address other than the Descriptor's own route is declared in the Descriptor.
    // The verifier can only judge its own behaviour here: it reaches an address because it read
    // one, so what this establishes is that nothing it called was undeclared.
    if (!addresses.has(address(exchange.url))) {
      fail("ENDP-1", `${where} — an address the Descriptor did not declare`);
    }

    // ENDP-4: bodies and responses are JSON, UTF-8, `application/json`.
    //
    // A response with no body is not judged, and that is the rule read as written rather than a
    // concession. A content type is a claim ABOUT a body; ACT-10 and ACT-11 have a Worker answer
    // `204` and `202` with none, and requiring one there would be this verifier inventing an
    // obligation out of a sentence that constrains bodies.
    if (exchange.body.length > 0) {
      if (!isJson(exchange.headers)) {
        const got = exchange.headers.get("content-type") ?? "(none)";
        fail("ENDP-4", `${where} — content-type ${got}`);
      } else if (exchange.json === null) {
        fail("ENDP-4", `${where} — said application/json and did not parse`);
      }
    }

    // ENDP-5: every protocol response carries both headers, stating what produced it.
    for (const header of ["worker-protocol-edition", "worker-protocol-capability-version"]) {
      if (!exchange.headers.has(header)) fail("ENDP-5", `${where} — no ${header}`);
    }

    if (exchange.status >= 200 && exchange.status < 300) continue;

    // ENDP-29: a response that is not a success carries one of the statuses the table lists. The
    // success side is deliberately open, which is why only this branch is judged.
    const statuses = new Set(codes.map((c) => c.status));
    if (!statuses.has(exchange.status)) {
      fail("ENDP-29", `${where} — a status no code in spec/endpoints.md names`);
    }

    // ENDP-25: every response that is not a success carries the shared envelope.
    const envelope = errorSchema.safeParse(exchange.json);
    if (!envelope.success) {
      fail("ENDP-25", `${where} — ${envelope.error.issues[0]?.message ?? "no error envelope"}`);
      continue;
    }

    // ENDP-26: a Worker answers a code with the status that code names. The class is already
    // carried with the code by schemas/error.json, which is the half a schema can assert; this is
    // the other half, and it is the reason the status table is generated rather than retyped.
    const expected = byCode.get(envelope.data.code);
    if (expected && expected.status !== exchange.status) {
      fail("ENDP-26", `${where} — the code \`${envelope.data.code}\` fixes ${expected.status}`);
    }
  }

  // ENDP-11: a Worker does not answer 5xx for a condition that will not change. A bad body
  // answered with a 500 is an instruction to redeliver an unusable payload forever, and the
  // sender will comply. The witness is ordinarily out of reach — nothing outside can tell a
  // transient fault from a permanent one — but the verifier knows which of its OWN requests were
  // deliberately and permanently wrong, because it made them that way.
  const permanent = exchanges.filter((exchange) => exchange.permanent);
  const wrongly = permanent.filter((exchange) => exchange.status >= 500);
  if (permanent.length === 0) {
    say("ENDP-11", "notExercised", "the run provoked no condition that will not change");
  } else if (wrongly.length === 0) {
    say("ENDP-11", "passes");
  } else {
    const first = wrongly[0];
    say("ENDP-11", "fails", `${first.intent} answered ${first.status}`);
  }

  // ENDP-19 recommends that a Worker cap the page size rather than negotiating it. The witness is
  // a collection longer than the cap, which is a cursor coming back; short of that there is
  // nothing to see, and a Worker whose collections all fit in one page has not been observed
  // either following it or not.
  const capped = exchanges.some((exchange) => {
    const cursor = (exchange.json as { nextCursor?: unknown } | null)?.nextCursor;
    return typeof cursor === "string" && cursor.length > 0;
  });
  if (capped) say("ENDP-19", "passes");
  else say("ENDP-19", "notExercised", "no collection was long enough to be capped");

  for (const id of CLAIMS) {
    if (id === "ENDP-11" || id === "ENDP-19") continue;
    const why = failures.get(id);
    if (why === undefined) say(id, "passes");
    else say(id, "fails", why.length === 1 ? why[0] : `${why.length} responses: ${why[0]}, …`);
  }

  return results;
}

import { error as errorSchema } from "@worker-protocol/schemas";
import type { Result, Rule } from "../report.ts";
import { type Exchange, isJson } from "../transcript.ts";

/**
 * The rules that are about every response rather than about one surface.
 *
 * These run last, over the whole transcript, because several of them are statements no single
 * exchange can break: ENDP-26 forbids one code arriving under two statuses, which is a fact about
 * a set. A check that asked it inside one surface would be asking a question it could not answer.
 */
export const CLAIMS = ["ENDP-1", "ENDP-4", "ENDP-5", "ENDP-25", "ENDP-26", "ENDP-29"] as const;

/** The status and class each code fixes, generated from endpoints.md into rules.json (ENDP-26). */
export type Code = { code: string; status: number; class: "reject" | "retry" };

export function judgeTranscript(
  exchanges: Exchange[],
  codes: Code[],
  declared: Set<string>,
  rules: Map<string, Rule>,
): Result[] {
  const results: Result[] = [];
  const say = (id: string, verdict: Result["verdict"], detail?: string) => {
    const rule = rules.get(id);
    if (rule) results.push({ rule, verdict, detail });
  };

  if (exchanges.length === 0) {
    for (const id of CLAIMS) say(id, "notExercised", "no response was collected");
    return results;
  }

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
    if (!declared.has(exchange.url)) {
      fail("ENDP-1", `${where} — an address the Descriptor did not declare`);
    }

    // ENDP-4: bodies and responses are JSON, UTF-8, `application/json`.
    if (!isJson(exchange.headers)) {
      const got = exchange.headers.get("content-type") ?? "(none)";
      fail("ENDP-4", `${where} — content-type ${got}`);
    } else if (exchange.body.length > 0 && exchange.json === null) {
      fail("ENDP-4", `${where} — said application/json and did not parse`);
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

  for (const id of CLAIMS) {
    const why = failures.get(id);
    if (why === undefined) say(id, "passes");
    else say(id, "fails", why.length === 1 ? why[0] : `${why.length} responses: ${why[0]}, …`);
  }

  return results;
}

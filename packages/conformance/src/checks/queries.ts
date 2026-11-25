import { page as pageSchema } from "@worker-protocol/schemas";
import type { Arrangement } from "../index.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { type Transcript, withParams } from "../transcript.ts";
import { agrees, type Declared } from "./inputs.ts";

/**
 * The `queries` Capability: the reads a Worker defines.
 *
 * **Almost all of it is `W`, and ENDP-2 is why.** A Query is a GET and changes nothing, so a
 * verifier may read every one it can name the parameters of without asking anybody — which is the
 * position `actions` is never in, where ACT-5 waits for an Action somebody arranged to be safe.
 * What it cannot do is invent a value for a parameter a Query requires: a vehicle that exists, an
 * instant inside what the Worker holds. So QRY-5 and QRY-9 are judged on the Queries that require
 * none, and say so where every Query requires one.
 *
 * QRY-11 is not here: it needs the credential of a grant, so `checks/grants.ts` judges it.
 *
 * **What a Query answers is judged against what its schema fixes about one value, and one level of
 * members, and no further** — the limit `checks/inputs.ts` states for TASK-37, kept for the same
 * reason: this package carries no JSON Schema validator. The register says so.
 */
export const CLAIMS = [
  "QRY-1",
  "QRY-2",
  "QRY-3",
  "QRY-4",
  "QRY-5",
  "QRY-6",
  "QRY-7",
  "QRY-8",
  "QRY-9",
  "QRY-10",
] as const;

/** A name no Worker would declare, so the refusal is about the name and nothing else. */
const NO_SUCH_QUERY = "no-such-query-7b2e";
/** A parameter no Query would declare: ENDP-24's `400` for a credential that covers the Query. */
const NO_SUCH_PARAMETER = "no-such-parameter-8e31";

/** QRY-3. The two parameters the read defines itself. */
const RESERVED = ["query", "cursor"];

type Schema = Declared & { required?: unknown };
type Query = { parameters?: Schema; result?: Schema; items?: Schema };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const required = (schema: Schema | undefined): string[] =>
  Array.isArray(schema?.required)
    ? schema.required.filter((one): one is string => typeof one === "string")
    : [];

const refusalOf = (answer: { status: number; json: unknown }) =>
  `${answer.status} with \`${(answer.json as { code?: string } | null)?.code ?? "no code"}\``;

const refusedAs = (answer: { status: number; json: unknown }, status: number, code: string) =>
  answer.status === status && (answer.json as { code?: string } | null)?.code === code;

/** Why `value` is not what `schema` declares, as far as this package reads a schema; else null. */
const disagreement = (schema: Schema, value: unknown): string | null => {
  if (!agrees(schema, value)) return "is not of the declared type";
  if (!isObject(value)) return null;
  for (const member of required(schema)) {
    if (!(member in value)) return `lacks \`${member}\`, which the schema requires`;
  }
  for (const [member, declared] of Object.entries(schema.properties ?? {})) {
    if (member in value && !agrees(declared, value[member])) {
      return `carries \`${member}\` with a value its schema refuses`;
    }
  }
  return null;
};

/** A Query that declares what it takes and exactly one of what it answers: one that can be read. */
const wellDeclared = (declared: Query): boolean =>
  isObject(declared) &&
  isObject(declared.parameters) &&
  isObject(declared.result) !== isObject(declared.items);

/**
 * One read of a Query that requires no parameter, for ENDP-24 to add a filter to, or none.
 *
 * ENDP-24 is `checks/surfaces.ts`'s and stays there: [queries](../../../spec/queries.md) cites the
 * rule and does not restate it, so the verdict is the one every other address shares. What that
 * check cannot do is read this address bare, which is why it is handed a read from here.
 */
export const readableQuery = (
  entry: Record<string, unknown> | undefined,
  url: string | null,
): { capability: string; url: string }[] => {
  if (url === null || !isObject(entry?.answers)) return [];
  const found = Object.entries(entry.answers as Record<string, Query>).find(
    ([, declared]) => wellDeclared(declared) && required(declared.parameters).length === 0,
  );
  return found === undefined
    ? []
    : [{ capability: "queries", url: withParams(url, { query: found[0] }) }];
};

export async function checkQueries(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  rules: Map<string, Rule>,
  transcript: Transcript,
  arrangement: Arrangement,
): Promise<Result[]> {
  const { results, say, allExcept } = verdicts(rules, CLAIMS);

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `queries`");
    return results;
  }

  // QRY-1: an address, and a map of Queries. Read by hand rather than through the schema, because
  // the four rules below are about a JSON Schema held INSIDE the declaration, which no schema of
  // the declaration can assert, and a verdict per rule is worth more than the first parse error.
  if (typeof entry.address !== "string" || !isObject(entry.answers)) {
    say("QRY-1", "fails", "the entry carries no address, or no `answers` map");
    allExcept("notExercised", "the `queries` entry could not be read", ["QRY-1"]);
    return results;
  }
  say("QRY-1", "passes");
  const answers = entry.answers as Record<string, Query>;

  const unstringed: string[] = [];
  const reserved: string[] = [];
  const unanswered: string[] = [];
  for (const [name, declared] of Object.entries(answers)) {
    const parameters = declared.parameters;
    if (!isObject(parameters) || (parameters.type !== undefined && parameters.type !== "object")) {
      unstringed.push(`\`${name}\` declares no schema of an object for its parameters`);
    } else {
      for (const [parameter, schema] of Object.entries(parameters.properties ?? {})) {
        if (RESERVED.includes(parameter)) reserved.push(`\`${name}\` declares \`${parameter}\``);
        if (!isObject(schema) || schema.type !== "string") {
          unstringed.push(`\`${parameter}\` of \`${name}\` is not declared a string`);
        }
      }
    }
    if (isObject(declared.result) === isObject(declared.items)) {
      unanswered.push(
        `\`${name}\` declares ${isObject(declared.result) ? "both" : "neither"} of \`result\` and \`items\``,
      );
    }
  }
  if (Object.keys(answers).length === 0) {
    for (const id of ["QRY-2", "QRY-3", "QRY-4"]) {
      say(id, "notExercised", "the entry declares no Query");
    }
  } else {
    say("QRY-2", unstringed.length === 0 ? "passes" : "fails", unstringed.join("; ") || undefined);
    say("QRY-3", reserved.length === 0 ? "passes" : "fails", reserved.join("; ") || undefined);
    say("QRY-4", unanswered.length === 0 ? "passes" : "fails", unanswered.join("; ") || undefined);
  }

  const calls = ["QRY-5", "QRY-6", "QRY-7", "QRY-8", "QRY-9", "QRY-10"];
  if (url === null) {
    for (const id of calls) say(id, "notExercised", "the declared address did not resolve");
    return results;
  }

  // QRY-7: a request that names no Query has not said what it wants.
  const unnamed = await transcript.send(url, "the `queries` address, naming no Query", {
    permanent: true,
  });
  if (refusedAs(unnamed, 400, "invalid_parameter")) say("QRY-7", "passes");
  else say("QRY-7", "fails", `answered ${refusalOf(unnamed)}`);

  // QRY-6: a Query the entry does not declare is a resource that does not exist.
  const unknown = await transcript.send(
    withParams(url, { query: NO_SUCH_QUERY }),
    "a Query no Worker declares",
    { permanent: true },
  );
  if (refusedAs(unknown, 404, "not_found")) say("QRY-6", "passes");
  else say("QRY-6", "fails", `answered ${refusalOf(unknown)}`);

  // QRY-5, QRY-9: every Query that requires no parameter is read, and what it answers is judged
  // against what it declared. Reading changes nothing (ENDP-2), so nothing here waits to be asked.
  const well = Object.entries(answers).filter(([, declared]) => wellDeclared(declared));
  const readable = well.filter(([, declared]) => required(declared.parameters).length === 0);
  if (readable.length === 0) {
    const why =
      well.length === 0
        ? "the entry declares no Query that could be read"
        : "every Query requires a parameter, and a verifier cannot invent a value for one";
    say("QRY-5", "notExercised", why);
    say("QRY-9", "notExercised", why);
  } else {
    const unread: string[] = [];
    const wrong: string[] = [];
    for (const [name, declared] of readable) {
      const answered = await transcript.send(withParams(url, { query: name }), `the Query ${name}`);
      if (answered.status !== 200) {
        unread.push(`\`${name}\` answered ${refusalOf(answered)}`);
        continue;
      }
      if (declared.result !== undefined) {
        const fault = disagreement(declared.result, answered.json);
        if (fault !== null) wrong.push(`what \`${name}\` answered ${fault}`);
        continue;
      }
      const envelope = pageSchema.safeParse(answered.json);
      if (!envelope.success) {
        wrong.push(`\`${name}\` declares \`items\` and did not answer the page envelope`);
        continue;
      }
      const items = declared.items as Schema;
      const fault = envelope.data.items
        .map((item) => disagreement(items, item))
        .find((one) => one !== null);
      if (fault !== undefined) wrong.push(`an item \`${name}\` answered ${fault}`);
    }
    say("QRY-5", unread.length === 0 ? "passes" : "fails", unread.join("; ") || undefined);
    if (unread.length === readable.length) {
      say("QRY-9", "notExercised", "no Query answered a read to judge");
    } else {
      say("QRY-9", wrong.length === 0 ? "passes" : "fails", wrong.join("; ") || undefined);
    }
  }

  // QRY-8: a parameter the Query requires, left out; failing that, one it declares, sent twice.
  const demanding = well.find(([, declared]) => required(declared.parameters).length > 0);
  const taking = well.find(
    ([, declared]) => Object.keys(declared.parameters?.properties ?? {}).length > 0,
  );
  if (demanding !== undefined) {
    const [name, declared] = demanding;
    const missing = required(declared.parameters)[0];
    const answered = await transcript.send(
      withParams(url, { query: name }),
      `the Query ${name}, without \`${missing}\`, which it requires`,
      { permanent: true },
    );
    if (refusedAs(answered, 400, "invalid_parameter")) say("QRY-8", "passes");
    else
      say("QRY-8", "fails", `\`${name}\` without \`${missing}\` answered ${refusalOf(answered)}`);
  } else if (taking !== undefined) {
    const [name, declared] = taking;
    const twice = Object.keys(declared.parameters?.properties ?? {})[0] as string;
    const answered = await transcript.send(
      withParams(url, { query: name, [twice]: ["a", "b"] }),
      `the Query ${name}, with \`${twice}\` sent twice`,
      { permanent: true },
    );
    if (refusedAs(answered, 400, "invalid_parameter")) say("QRY-8", "passes");
    else
      say("QRY-8", "fails", `\`${name}\` with \`${twice}\` twice answered ${refusalOf(answered)}`);
  } else {
    say("QRY-8", "notExercised", "no Query declares a parameter");
  }

  // QRY-10: with a parameter no Query declares, so that ENDP-24 would answer `400` were the
  // parameters judged first. Nothing outside can tell which Queries a credential lacks, so it is
  // told, as ACT-22's is.
  const uncovered = arrangement.uncoveredQuery;
  if (uncovered === undefined) {
    say("QRY-10", "notExercised", "no credential was given with a Query it does not cover");
  } else {
    const answered = await transcript.send(
      withParams(url, { query: uncovered.name, [NO_SUCH_PARAMETER]: "1" }),
      `the Query ${uncovered.name}, with a credential that does not cover it`,
      { headers: { authorization: `Bearer ${uncovered.credential}` } },
    );
    if (refusedAs(answered, 403, "forbidden")) say("QRY-10", "passes");
    else {
      say(
        "QRY-10",
        "fails",
        `a Query the credential does not cover answered ${refusalOf(answered)}, before \`403\` + \`forbidden\``,
      );
    }
  }

  return results;
}

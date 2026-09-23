import { logLevel, logPage, logsEntry } from "@worker-protocol/schemas";
import { type Attribution, ruleFor } from "../attribution.ts";
import { type Result, type Rule, verdicts } from "../report.ts";
import { iso, type Transcript, withParams } from "../transcript.ts";

/**
 * The `logs` Capability.
 *
 * What a tool can reach here is the shape, the vocabulary, the floor a level filter names and the
 * half-open interval. What it cannot reach from one page is the order: LOG-6 forbids reconstructing
 * it from the instants, and a clock that stepped backwards would make a non-ascending check fail a
 * Worker that is right. So LOG-3 and ENDP-33 are `H`, they live in `arranged.ts`, and what they need
 * is a Worker that records something when it is read.
 *
 * LOG-6 binds a caller and is `P` — a tool pointed at a Worker never contacted one. LOG-10 is `H`
 * beside ALRT-6 and ACTV-6, because two credentials have to exist before two lists can be compared.
 */
export const CLAIMS = ["LOG-1", "LOG-2", "LOG-4", "LOG-5", "LOG-7", "LOG-8", "LOG-9"] as const;

/** LOG-5's ladder, which LOG-7 reads a floor off. The top of it is the sharpest filter to ask for. */
const HIGHEST = logLevel.options[logLevel.options.length - 1];

export async function checkLogs(
  entry: Record<string, unknown> | undefined,
  url: string | null,
  rules: Map<string, Rule>,
  attribution: Attribution,
  transcript: Transcript,
): Promise<Result[]> {
  const { results, say, allExcept } = verdicts(rules, CLAIMS);

  if (entry === undefined) {
    allExcept("notExercised", "the Worker declares no `logs`");
    return results;
  }

  const declared = logsEntry.safeParse(entry);
  if (!declared.success) {
    const issue = declared.error.issues[0];
    const id = ruleFor(attribution, "logs-entry", issue?.path ?? []) ?? "LOG-1";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the `logs` entry did not validate", [id]);
    return results;
  }
  say("LOG-1", "passes");

  if (url === null) {
    allExcept("notExercised", "the declared address did not resolve", ["LOG-1"]);
    return results;
  }

  const readUrl = (parameters: Record<string, string>) => withParams(url, parameters);

  const answer = await transcript.send(url, "what the Worker recorded while it was working");
  if (answer.status !== 200) {
    say("LOG-2", "fails", `the address answered ${answer.status}`);
    allExcept("notExercised", "no page of records was read", ["LOG-1", "LOG-2"]);
    return results;
  }

  const page = logPage.safeParse(answer.json);
  if (!page.success) {
    const issue = page.error.issues[0];
    const id = ruleFor(attribution, "log-page", issue?.path ?? []) ?? "LOG-2";
    say(id, "fails", `${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    allExcept("notExercised", "the page did not validate", ["LOG-1", id]);
    return results;
  }
  say("LOG-2", "passes");

  // LOG-4 and LOG-5 are what validation established, said per rule because a report naming one of
  // them is the point of having ids. A Worker holding nothing exercises neither, and that is `not
  // exercised` rather than a pass: an empty page is conformant and proves nothing about a record.
  const records = page.data.items;
  if (records.length === 0) {
    say("LOG-4", "notExercised", "the Worker holds no record, so none was read");
    say("LOG-5", "notExercised", "the Worker holds no record, so no level was read");
  } else {
    say("LOG-4", "passes");
    say("LOG-5", "passes");
  }

  // LOG-9: the flat, scalar-valued map — established by validation when one arrives, and unclaimed
  // when none does. It is optional, so a Worker whose records carry no fields is conformant and
  // has shown nothing about the shape of one.
  const withFields = records.find((record) => record.fields !== undefined);
  if (withFields === undefined) {
    say("LOG-9", "notExercised", "no record carried `fields`");
  } else {
    say("LOG-9", "passes");
  }

  // LOG-7: a floor. Asking for the top of the ladder must answer that level and nothing below it,
  // and a name outside the vocabulary is `400` with `invalid_parameter` rather than being ignored.
  const filtered = await transcript.send(readUrl({ level: HIGHEST }), `records at \`${HIGHEST}\``);
  const filteredPage = logPage.safeParse(filtered.json);
  const invented = await transcript.send(
    readUrl({ level: "chatter" }),
    "a level outside the vocabulary",
    { permanent: true },
  );
  const inventedCode = (invented.json as { code?: string } | null)?.code;
  if (filtered.status !== 200 || !filteredPage.success) {
    say("LOG-7", "fails", `a filtered read answered ${filtered.status}`);
  } else if (filteredPage.data.items.some((record) => record.level !== HIGHEST)) {
    say("LOG-7", "fails", `\`level=${HIGHEST}\` answered a record below it`);
  } else if (invented.status !== 400 || inventedCode !== "invalid_parameter") {
    say(
      "LOG-7",
      "fails",
      `an invented level answered ${invented.status} with \`${inventedCode ?? "no code"}\``,
    );
  } else {
    say("LOG-7", "passes");
  }

  // LOG-8: half-open, so two adjacent reads carry no record twice. Checked against the boundary
  // rather than by comparing the two pages, because two records may legitimately be identical —
  // there is no id here — and a Worker would then fail for holding a repeat it was right to hold.
  const cut = Date.now() - 60_000;
  const boundary = iso(cut);
  const after = await transcript.send(readUrl({ from: boundary }), "records from a boundary");
  const before = await transcript.send(readUrl({ to: boundary }), "records up to that boundary");
  const afterPage = logPage.safeParse(after.json);
  const beforePage = logPage.safeParse(before.json);
  if (!afterPage.success || !beforePage.success) {
    say("LOG-8", "fails", `an interval read answered ${after.status} and ${before.status}`);
  } else if (afterPage.data.items.length === 0 && beforePage.data.items.length === 0) {
    say("LOG-8", "notExercised", "the Worker holds no record on either side of an interval");
  } else if (afterPage.data.items.some((record) => Date.parse(record.at) < cut)) {
    say("LOG-8", "fails", "`from` answered a record before it, so the bound is not inclusive");
  } else if (beforePage.data.items.some((record) => Date.parse(record.at) >= cut)) {
    say("LOG-8", "fails", "`to` answered a record at or after it, so the bound is not exclusive");
  } else {
    say("LOG-8", "passes");
  }

  return results;
}

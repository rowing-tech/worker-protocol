import type { LogFacts, LogLevel, LogPage, LogQuery, LogRecord } from "@worker-protocol/hono";

/**
 * The `logs` Capability, arranged to be checked.
 *
 * Two of its rules are `H` and neither is reachable against a Worker that merely happens to hold
 * records. LOG-3 says the order is most recent first, and no page of unknown records shows that:
 * LOG-6 forbids reading the order off the instants, so there is nothing inside one page to compare.
 * ENDP-33 says a page reached through a cursor never carries a record written after the page that
 * produced it, and a feed nothing is writing to proves nothing about it.
 *
 * What makes both reachable is one arrangement: **this Worker records a line for every request it
 * serves.** A verifier then has a way to make a record exist — read something — without knowing
 * anything about this Worker's domain. A Worker recording its own traffic is an ordinary thing to
 * write on purpose, which is what `spec/logs.md` asks for; what that file declines is capturing a
 * runtime's output, and nothing here does.
 *
 * `pageSize` is two, for the reason `tasks` caps at two: a cap nothing ever reaches is a cap nobody
 * has seen work, and ENDP-33 needs a second page to exist at all.
 */

/** One record, with the position the cursor names. `seq` never travels. */
type Held = { seq: number; record: LogRecord };

/** The window this Worker keeps. A window rather than an archive, as `spec/logs.md` has it. */
const KEEP = 40;

export function createLogs() {
  const held: Held[] = [];
  let next = 1;

  const record = (level: LogLevel, message: string, fields?: LogRecord["fields"]): void => {
    held.push({
      seq: next++,
      record: { at: new Date(), level, message, ...(fields === undefined ? {} : { fields }) },
    });
    // The oldest go first, which is what makes the end of this collection mean *the end of what I
    // still hold*. A cursor into what has been dropped answers an empty page, and `spec/logs.md`
    // says so in prose rather than signalling it in an envelope six other surfaces share.
    if (held.length > KEEP) held.splice(0, held.length - KEEP);
  };

  const facts: LogFacts = {
    // ENDP-19: a cap of two, so that this Worker's own records actually page.
    pageSize: 2,
    read(query: LogQuery): LogPage {
      const before = query.cursor === undefined ? Number.POSITIVE_INFINITY : Number(query.cursor);

      // LOG-3: most recent first — `reverse` rather than a sort, because `held` is append-only and
      // is already ascending by `seq`, and saying so is worth more than re-deriving it. ENDP-33
      // falls out of the same fact: `seq` only ever grows, so a page asked for what is older than
      // a position cannot contain anything written since. It would not be free under an offset.
      const matching = held
        .filter(
          (one) =>
            one.seq < before &&
            query.levels.includes(one.record.level) &&
            (query.from === undefined || one.record.at >= query.from) &&
            (query.to === undefined || one.record.at < query.to),
        )
        .reverse();

      const page = matching.slice(0, query.limit);
      // ENDP-20: absent at the end — and the end here is the end of what is still held.
      const last = matching.length > query.limit ? page.at(-1) : undefined;
      return {
        records: page.map((one) => one.record),
        ...(last === undefined ? {} : { nextCursor: String(last.seq) }),
      };
    },
  };

  return { record, facts };
}

export type Logs = ReturnType<typeof createLogs>;

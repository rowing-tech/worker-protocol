import { describe, expect, it } from "vitest";
import { durableLogs, type LogRow, tailRecords } from "../src/index.ts";
import { whole } from "./outbound.ts";

/** LOG-2's window, over a Durable Object of the test's own; `Whole` keeps five records. */
const fresh = whole;

const row = (at: number, level: LogRow["level"] = "info"): LogRow => ({
  at,
  level,
  message: `at ${at}`,
});

describe("withLogs", () => {
  it("keeps a window, most recent first, and pages it with a cursor (LOG-2, LOG-3, ENDP-33)", async () => {
    const stub = fresh();
    await stub.record([1, 2, 3, 4, 5, 6, 7].map((at) => row(at)));
    const logs = durableLogs(stub, { pageSize: 2 });

    const first = await logs.read({ levels: ["debug", "info", "warn", "error"], limit: 2 });
    if ("code" in first) throw new Error("refused");
    expect(first.records.map((one) => one.at.getTime())).toEqual([7, 6]);

    const rest = await logs.read({
      levels: ["debug", "info", "warn", "error"],
      limit: 10,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });
    if ("code" in rest) throw new Error("refused");
    // Five kept, two already read: the window's end is the end of what the Worker still holds.
    expect(rest.records.map((one) => one.at.getTime())).toEqual([5, 4, 3]);
    expect(rest.nextCursor).toBeUndefined();
  });

  it("answers a level and everything above it, within a half-open interval (LOG-7, LOG-8)", async () => {
    const stub = fresh();
    await stub.record([row(10, "debug"), row(20, "warn"), row(30, "error"), row(40, "warn")]);
    const page = await durableLogs(stub, { pageSize: 10 }).read({
      levels: ["warn", "error"],
      from: new Date(20),
      to: new Date(40),
      limit: 10,
    });
    if ("code" in page) throw new Error("refused");
    expect(page.records.map((one) => one.at.getTime())).toEqual([30, 20]);
  });
});

describe("tailRecords", () => {
  const traced = (over: Partial<TraceItem>): TraceItem =>
    ({
      scriptName: "fleet",
      eventTimestamp: 100,
      outcome: "ok",
      logs: [],
      exceptions: [],
      ...over,
    }) as TraceItem;

  it("records an exception nobody caught and an invocation that ended badly, and nothing else", () => {
    const rows = tailRecords([
      traced({
        outcome: "exception",
        exceptions: [{ name: "TypeError", message: "x", timestamp: 101 }],
      }),
      traced({ outcome: "exceededCpu" }),
      traced({ outcome: "canceled" }),
      // `console` output is what this throws away, and an `ok` invocation is not news.
      traced({ logs: [{ timestamp: 1, level: "log", message: ["noise"] }] }),
    ]);
    expect(rows.map((one) => [one.level, one.message])).toEqual([
      ["error", "uncaught TypeError: x"],
      ["error", "the invocation ended `exceededCpu`"],
      ["warn", "the invocation ended `canceled`"],
    ]);
  });
});

import { mount } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { consume } from "../index.ts";

/**
 * TASK-48 from the consumer's side: `tasks.list` and `tasks.page` spell each fixed dimension as a
 * parameter of its own name, beside `type`, against a Worker on `mount()`. Nothing crosses a socket.
 */

const ESCALATE = "tech.rowing.test.escalate-store";
const CONFIRM = "tech.rowing.test.confirm-arrival";
const SINCE = new Date("2026-10-26T08:00:00Z");

const app = mount({
  id: "tech.rowing.worker-protocol.dimensions",
  authenticate: () => "accepted",
  tasks: {
    raises: { [ESCALATE]: { payload: z.object({}) }, [CONFIRM]: { payload: z.object({}) } },
    dimensions: ["base"],
    current: () => [
      { id: "t-1", type: ESCALATE, payload: {}, since: SINCE, dimensions: { base: "MTY" } },
      { id: "t-2", type: ESCALATE, payload: {}, since: SINCE, dimensions: { base: "GDL" } },
      { id: "t-3", type: CONFIRM, payload: {}, since: SINCE, dimensions: { base: "MTY" } },
    ],
    pageSize: 1,
  },
});

const consumer = () =>
  consume("https://worker.example.com", {
    credential: "c",
    fetch: ((url: string, init?: RequestInit) =>
      app.fetch(new Request(url, init))) as unknown as typeof globalThis.fetch,
  });

describe("reading Tasks by dimension with consume()", () => {
  it("lists every page of the Tasks carrying a fixed value, and a bare string is still the type", async () => {
    const tasks = (await consumer()).tasks;
    expect((await tasks?.list({ fixed: { base: "MTY" } }))?.map((one) => one.id)).toEqual([
      "t-1",
      "t-3",
    ]);
    expect(
      (await tasks?.list({ type: CONFIRM, fixed: { base: "MTY" } }))?.map((one) => one.id),
    ).toEqual(["t-3"]);
    expect((await tasks?.list(ESCALATE))?.map((one) => one.id)).toEqual(["t-1", "t-2"]);
  });

  it("keeps the fixed values across the pages a caller walks itself", async () => {
    const tasks = (await consumer()).tasks;
    const first = await tasks?.page({ fixed: { base: "MTY" } });
    expect(first?.items.map((one) => one.dimensions)).toEqual([{ base: "MTY" }]);
    const second = await tasks?.page({ fixed: { base: "MTY" }, cursor: first?.nextCursor });
    expect(second?.items.map((one) => one.id)).toEqual(["t-3"]);
    expect(second?.nextCursor).toBeUndefined();
  });
});

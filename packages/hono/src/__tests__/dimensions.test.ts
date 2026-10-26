import { describe, expect, it } from "vitest";
import * as z from "zod";
import { mount } from "../mount.ts";
import type { OpenTask, TaskQuery } from "../tasks.ts";

/**
 * TASK-45 to TASK-50 as `mount()` serves them: a dimension declared by name, carried by a Task,
 * fixed on a read — once through `current()`, paged here, and once through a Worker's own `read`.
 */

const ESCALATE = "tech.rowing.test.escalate-store";
const CONFIRM = "tech.rowing.test.confirm-arrival";
const SINCE = new Date("2026-10-26T08:00:00Z");

const OPEN: OpenTask[] = [
  { id: "t-1", type: ESCALATE, payload: {}, since: SINCE, dimensions: { base: "MTY" } },
  {
    id: "t-2",
    type: ESCALATE,
    payload: {},
    since: SINCE,
    dimensions: { base: "GDL", store: "S001" },
  },
  { id: "t-3", type: CONFIRM, payload: {}, since: SINCE, dimensions: { base: "MTY" } },
  // About no base at all, so no read that fixes one answers it.
  { id: "t-4", type: CONFIRM, payload: {}, since: SINCE },
];

const RAISES = {
  [ESCALATE]: { payload: z.object({}) },
  [CONFIRM]: { payload: z.object({}) },
};

const ids = async (response: Response) =>
  ((await response.json()) as { items: { id: string }[] }).items.map((one) => one.id);

describe("mount(), Tasks read by dimension through `current()`", () => {
  const app = mount({
    id: "tech.rowing.worker-protocol.test",
    authenticate: () => "accepted",
    tasks: { raises: RAISES, dimensions: ["base", "store"], current: () => OPEN },
  });
  const get = (path: string) => app.fetch(new Request(`http://worker.invalid${path}`));

  it("declares each dimension by name, and nothing about its values (TASK-45)", async () => {
    const document = (await (await get("/.well-known/worker-protocol")).json()) as {
      capabilities: { tasks: { dimensions?: unknown } };
    };
    expect(document.capabilities.tasks.dimensions).toEqual({ base: {}, store: {} });
  });

  it("carries each Task's values on the wire (TASK-47)", async () => {
    const page = (await (await get("/tasks")).json()) as {
      items: { id: string; dimensions?: Record<string, string> }[];
    };
    expect(page.items.find((one) => one.id === "t-2")?.dimensions).toEqual({
      base: "GDL",
      store: "S001",
    });
    expect(page.items.find((one) => one.id === "t-4")).not.toHaveProperty("dimensions");
  });

  it("answers only the Tasks carrying a fixed value, of any type (TASK-48)", async () => {
    expect(await ids(await get("/tasks?base=MTY"))).toEqual(["t-1", "t-3"]);
  });

  it("holds every fixed parameter at once, `type` among them (TASK-48)", async () => {
    expect(await ids(await get(`/tasks?type=${CONFIRM}&base=MTY`))).toEqual(["t-3"]);
    expect(await ids(await get("/tasks?base=GDL&store=S001"))).toEqual(["t-2"]);
    expect(await ids(await get("/tasks?base=MTY&store=S001"))).toEqual([]);
  });

  it("answers a value nothing carries with an empty page (TASK-49)", async () => {
    const response = await get("/tasks?base=XYZ");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it("refuses a dimension fixed twice (TASK-50)", async () => {
    const response = await get("/tasks?base=MTY&base=GDL");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_parameter" });
  });

  it("refuses a dimension the entry does not declare (ENDP-24)", async () => {
    const response = await get("/tasks?region=north");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "unknown_filter" });
  });
});

describe("mount(), Tasks read by dimension through the Worker's own `read`", () => {
  const asked: TaskQuery[] = [];
  /** A store keyed by id, paged by the position past the last id answered. */
  const app = mount({
    id: "tech.rowing.worker-protocol.test",
    authenticate: () => "accepted",
    tasks: {
      raises: RAISES,
      dimensions: ["base", "store"],
      current: () => OPEN,
      // TASK-6: the credential `narrow` reads every Task but t-3.
      covers: ({ token }) => (token === "narrow" ? ["t-1", "t-2", "t-4"] : undefined),
      pageSize: 1,
      read: (query) => {
        asked.push(query);
        const rest = OPEN.filter(
          (task) =>
            (query.type === undefined || task.type === query.type) &&
            Object.entries(query.dimensions).every(([k, v]) => task.dimensions?.[k] === v) &&
            (query.cursor === undefined || task.id > query.cursor),
        );
        const page = rest.slice(0, query.limit);
        const last = page.at(-1);
        return rest.length > query.limit && last !== undefined
          ? { tasks: page, nextCursor: last.id }
          : { tasks: page };
      },
    },
  });
  const get = (path: string, token = "wide") =>
    app.fetch(
      new Request(`http://worker.invalid${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

  it("hands the Worker a decoded query and pages with its own cursor, wrapped", async () => {
    const first = (await (await get("/tasks?base=MTY")).json()) as {
      items: { id: string }[];
      nextCursor?: string;
    };
    expect(first.items.map((one) => one.id)).toEqual(["t-1"]);
    expect(asked.at(-1)).toEqual({ dimensions: { base: "MTY" }, limit: 1 });
    // ENDP-21: what travels is not the Worker's own string, and it comes back to it unwrapped.
    expect(first.nextCursor).toBeDefined();
    expect(first.nextCursor).not.toBe("t-1");

    const second = await get(`/tasks?base=MTY&cursor=${first.nextCursor}`);
    expect(await ids(second)).toEqual(["t-3"]);
    expect(asked.at(-1)).toEqual({ dimensions: { base: "MTY" }, cursor: "t-1", limit: 1 });
  });

  it("refuses a cursor the Worker never produced, without asking it (ENDP-21)", async () => {
    const before = asked.length;
    const response = await get("/tasks?cursor=t-1");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_parameter" });
    expect(asked.length).toBe(before);
  });

  it("leaves out a Task the credential does not read, whatever the Worker answered (TASK-6)", async () => {
    const response = await get(`/tasks?type=${CONFIRM}&base=MTY`, "narrow");
    expect(await ids(response)).toEqual([]);
  });

  it("refuses before the Worker is asked, as the in-memory read does (TASK-50, ENDP-24)", async () => {
    const before = asked.length;
    expect((await get("/tasks?base=MTY&base=GDL")).status).toBe(400);
    expect((await get("/tasks?region=north")).status).toBe(400);
    expect(asked.length).toBe(before);
  });
});

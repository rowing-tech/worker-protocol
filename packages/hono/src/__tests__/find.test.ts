import { describe, expect, it } from "vitest";
import * as z from "zod";
import { action } from "../actions.ts";
import { mount } from "../mount.ts";
import type { OpenTask } from "../tasks.ts";
import type { Worker } from "../worker.ts";

/**
 * TASK-39 through `find`: the Task a call names, looked up by id from the Worker's own index rather
 * than out of every open Task. Everything after the lookup — TASK-6, `since`, TASK-40, TASK-41 —
 * is `mount()`'s, exactly as it is without `find`.
 */

const CHECK = "tech.rowing.test.check-vehicle";
const SINCE = new Date("2026-10-26T08:00:00Z");

/** Ten thousand open Tasks, which no capped `current()` would hold, keyed as a store would. */
const OPEN = new Map<string, OpenTask>(
  Array.from({ length: 10_000 }, (_, i) => {
    const id = `t-${i}`;
    return [id, { id, type: CHECK, payload: {}, since: SINCE, inputs: { check: { n: i } } }];
  }),
);

const worker = (over: { covers?: string[]; refused?: boolean } = {}) => {
  const asked = { find: [] as string[], current: 0 };
  const declared = {
    id: "tech.rowing.worker-protocol.find",
    authenticate: () => "accepted" as const,
    actions: {
      accepts: {
        check: action({
          input: z.object({ n: z.number() }),
          result: z.object({ n: z.number(), task: z.string().optional() }),
          refuses: () => (over.refused === true ? "not now" : undefined),
          run: (input, call) => ({ n: input.n, task: call.task?.id }),
        }),
        other: action({ input: z.object({}), run: () => null }),
      },
    },
    tasks: {
      raises: { [CHECK]: { payload: z.object({}), answeredBy: ["check"] } },
      // `current` is the scan that must not happen; it is here to prove that it does not.
      current: () => {
        asked.current += 1;
        return [...OPEN.values()];
      },
      find: (id: string) => {
        asked.find.push(id);
        return OPEN.get(id);
      },
      ...(over.covers === undefined ? {} : { covers: () => over.covers }),
    },
  } satisfies Worker;
  return { app: mount(declared), asked };
};

const answer = (
  app: ReturnType<typeof mount>,
  task: string,
  body: unknown = { n: 9_999 },
  action = "check",
) =>
  app.fetch(
    new Request(`http://worker.invalid/actions?action=${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "worker-protocol-task": task },
      body: JSON.stringify(body),
    }),
  );

describe("mount(), the Task a call names, through `find` (TASK-39)", () => {
  it("looks up one id and never derives every open Task, past any cap a `current()` would hold", async () => {
    const { app, asked } = worker();
    const answered = await answer(app, "t-9999");
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ n: 9_999, task: "t-9999" });
    expect(asked.find).toEqual(["t-9999"]);
    expect(asked.current).toBe(0);
  });

  it("is `404` for an id `find` answers nothing for, and for one the credential does not cover (TASK-6)", async () => {
    expect((await answer(worker().app, "t-gone")).status).toBe(404);
    const narrowed = worker({ covers: ["t-1"] });
    expect((await answer(narrowed.app, "t-2")).status).toBe(404);
    expect((await answer(narrowed.app, "t-1", { n: 1 })).status).toBe(200);
  });

  it("is `404` where `since` names another occurrence, and `200` where it names this one", async () => {
    const { app } = worker();
    expect((await answer(app, "t-5; since=2026-10-26T09:00:00Z")).status).toBe(404);
    expect((await answer(app, "t-5; since=2026-10-26T08:00:00Z")).status).toBe(200);
  });

  it("still refuses an Action the type does not list (TASK-40) and one it does not offer now (TASK-41)", async () => {
    expect((await answer(worker().app, "t-5", {}, "other")).status).toBe(400);
    expect((await answer(worker({ refused: true }).app, "t-5")).status).toBe(409);
  });
});

describe("mount(), a `tasks` entry with no way to find its Tasks", () => {
  it("is refused at construction without `current`, unless `read` and `find` are both given", () => {
    const tasks = { raises: { [CHECK]: { payload: z.object({}) } } };
    const base = {
      id: "tech.rowing.worker-protocol.find",
      authenticate: () => "accepted" as const,
    };
    // Built without types — or through a builder that answers `Worker` — the union cannot help.
    expect(() =>
      mount({ ...base, tasks: { ...tasks, read: () => ({ tasks: [] }) } } as unknown as Worker),
    ).toThrow(/TASK-39.*`find`/);
    expect(() =>
      mount({ ...base, tasks: { ...tasks, find: () => undefined } } as unknown as Worker),
    ).toThrow(/TASK-39.*`read`/);
    expect(() =>
      mount({
        ...base,
        tasks: { ...tasks, read: () => ({ tasks: [] }), find: () => undefined },
      }),
    ).not.toThrow();
  });
});

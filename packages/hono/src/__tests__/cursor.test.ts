import { describe, expect, it } from "vitest";
import * as z from "zod";
import { encodeCursor } from "../collection.ts";
import { mount } from "../mount.ts";

const since = new Date("2026-01-01T00:00:00Z");
const app = mount({
  id: "tech.rowing.test.paging",
  alerts: () =>
    Array.from({ length: 3 }, (_, i) => ({
      id: `a-${i}`,
      severity: "warning" as const,
      since,
      summary: "x",
      actions: [],
    })),
  activity: () =>
    Array.from({ length: 3 }, (_, i) => ({
      id: `v-${i}`,
      state: "running" as const,
      since,
      summary: "x",
    })),
});

describe("the cursor openapi/ publishes", () => {
  it.each([
    ["alerts", "a-0"],
    ["activity", "v-0"],
  ])("is a call /%s takes", async (surface, first) => {
    expect((await app.request(`http://x.invalid/${surface}`)).status).toBe(200);

    // ENDP-33: a cursor names a POSITION, so the page after it holds what is beyond that id and
    // never the item the cursor itself named. Under the offset this replaced, `cursor=0` meant
    // `start again`, which is a count into a list that may not be the list any more.
    const response = await app.request(`http://x.invalid/${surface}?cursor=${encodeCursor(first)}`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: { id: string }[] };
    expect(page.items.map((one) => one.id)).not.toContain(first);
    expect(page.items).toHaveLength(2);
  });

  it.each(["alerts", "activity"])("refuses a parameter /%s does not define", async (surface) => {
    // ENDP-24, which reading a cursor must not cost: a filter dropped in silence answers with
    // MORE than the caller asked for, in a shape it will happily parse.
    const response = await app.request(`http://x.invalid/${surface}?assignee=me`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("unknown_filter");
  });

  // `0` was a valid cursor under the offset and `nonsense` decodes as base64 without meaning
  // anything — ENDP-21 has a Worker produce every cursor it accepts, so both are refused.
  it.each([
    ["alerts", "0"],
    ["alerts", "nonsense"],
    ["activity", "0"],
    ["activity", "nonsense"],
  ])("refuses a cursor /%s never minted: %s", async (surface, cursor) => {
    const response = await app.request(`http://x.invalid/${surface}?cursor=${cursor}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("invalid_parameter");
  });
});

/**
 * ENDP-33, which is why the cursor is a position and not a count.
 *
 * Every collection in this protocol is derived on each read, so the list a caller is paging is not
 * the list its cursor came from. Under an offset an item appearing above the cursor pushes one the
 * caller already saw into the next page, and nothing in the answer says it happened.
 */
describe("paging a collection that changes underneath", () => {
  it("carries no Task the page before it already carried", async () => {
    // Four to begin with, `m` through `p`, read two at a time.
    const held = ["m", "n", "o", "p"];
    const paging = mount({
      id: "tech.rowing.test.growing",
      tasks: {
        raises: { "tech.rowing.test.thing": { payload: z.object({}), answeredBy: "do-it" } },
        pageSize: 2,
        current: () =>
          held.map((id) => ({
            id,
            type: "tech.rowing.test.thing",
            payload: {},
            since: new Date("2026-01-01T00:00:00Z"),
          })),
      },
    });

    const read = async (cursor?: string) => {
      const at = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      const response = await paging.request(`http://x.invalid/tasks${at}`);
      expect(response.status).toBe(200);
      return (await response.json()) as { items: { id: string }[]; nextCursor?: string };
    };

    const first = await read();
    expect(first.items.map((one) => one.id)).toEqual(["m", "n"]);
    expect(first.nextCursor).toBeTruthy();

    // A condition starts holding between the two reads, and its id sorts FIRST. This is the case
    // an offset gets wrong: `slice(2, 4)` of `a, m, n, o, p` is `n, o`, and the caller is handed
    // `n` a second time while believing it has moved on.
    held.unshift("a");

    const second = await read(first.nextCursor);
    expect(second.items.map((one) => one.id)).toEqual(["o", "p"]);
  });
});

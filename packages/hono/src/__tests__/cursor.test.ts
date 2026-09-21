import { describe, expect, it } from "vitest";
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
  it.each(["alerts", "activity"])("is a call /%s takes", async (surface) => {
    const first = await app.request(`http://x.invalid/${surface}`);
    expect(first.status).toBe(200);
    const withCursor = await app.request(`http://x.invalid/${surface}?cursor=0`);
    expect(withCursor.status).toBe(200);
    expect(await withCursor.text()).toBe(await first.text());
  });

  it.each(["alerts", "activity"])("refuses a parameter /%s does not define", async (surface) => {
    // ENDP-24, which reading a cursor must not cost: a filter dropped in silence answers with
    // MORE than the caller asked for, in a shape it will happily parse.
    const response = await app.request(`http://x.invalid/${surface}?assignee=me`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("unknown_filter");
  });

  it.each(["alerts", "activity"])("refuses a cursor /%s never minted", async (surface) => {
    const response = await app.request(`http://x.invalid/${surface}?cursor=nonsense`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("invalid_parameter");
  });
});

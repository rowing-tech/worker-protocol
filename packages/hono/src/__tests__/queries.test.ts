import { describe, expect, it } from "vitest";
import * as z from "zod";
import { mount, type Query, query } from "../index.ts";

/**
 * What `mount()` answers on the `queries` address that no client would send, and the Queries it
 * refuses to mount at all. The call as a consumer makes it is `packages/client`'s
 * `querying.test.ts`, against this same code.
 */

const worker = mount({
  id: "tech.rowing.fleet.tracker",
  queries: {
    answers: {
      position: query({
        parameters: z.object({ vehicle: z.string() }),
        result: z.object({ vehicle: z.string() }),
        read: ({ vehicle }) => ({ vehicle }),
      }),
      positions: query({
        items: z.object({ vehicle: z.string() }),
        read: () => ({ items: [{ vehicle: "mty-411" }] }),
      }),
    },
  },
});

const get = async (search: string) => {
  const answered = await worker.request(`/queries${search}`);
  return { status: answered.status, body: (await answered.json()) as Record<string, unknown> };
};

describe("the `queries` address", () => {
  it("refuses a request that names no Query (QRY-7)", async () => {
    expect(await get("")).toMatchObject({ status: 400, body: { code: "invalid_parameter" } });
    expect(await get("?query=")).toMatchObject({
      status: 400,
      body: { code: "invalid_parameter" },
    });
  });

  it("refuses a parameter sent twice (QRY-8)", async () => {
    expect(await get("?query=position&vehicle=a&vehicle=b")).toMatchObject({
      status: 400,
      body: { code: "invalid_parameter" },
    });
    expect(await get("?query=position&query=positions&vehicle=a")).toMatchObject({
      status: 400,
      body: { code: "invalid_parameter" },
    });
  });

  it("answers a collection in the page envelope, with no cursor at its end (QRY-9, ENDP-20)", async () => {
    expect(await get("?query=positions")).toEqual({
      status: 200,
      body: { items: [{ vehicle: "mty-411" }] },
    });
  });

  it("states the Capability's version, as every declared address does (ENDP-37)", async () => {
    const answered = await worker.request("/queries?query=positions");
    expect(answered.headers.get("worker-protocol-capability-version")).toBe("1");
  });
});

describe("a Query `mount()` will not serve", () => {
  const mounting = (declared: Query) => () =>
    mount({ id: "tech.rowing.fleet.tracker", queries: { answers: { broken: declared } } });

  it("declares a parameter that is not a string (QRY-2)", () => {
    expect(
      mounting(
        query({
          parameters: z.object({ limit: z.number() }),
          result: z.object({}),
          read: () => ({}),
        }),
      ),
    ).toThrow(/QRY-2/);
  });

  it("declares a parameter this read defines itself (QRY-3)", () => {
    expect(
      mounting(
        query({
          parameters: z.object({ cursor: z.string() }),
          result: z.object({}),
          read: () => ({}),
        }),
      ),
    ).toThrow(/QRY-3/);
  });

  it("declares both a document and a collection, or neither (QRY-4)", () => {
    const both = { result: z.object({}), items: z.object({}), read: () => ({}) };
    expect(mounting(both as unknown as Query)).toThrow(/QRY-4/);
    expect(mounting({ read: () => ({}) } as unknown as Query)).toThrow(/QRY-4/);
  });
});

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
        parameters: z.object({ vehicle: z.array(z.string()).optional() }),
        items: z.object({ vehicle: z.string() }),
        read: ({ vehicle }) => ({
          items: ["mty-411", "mty-534", "tij-002"]
            .filter((one) => vehicle === undefined || vehicle.includes(one))
            .map((one) => ({ vehicle: one })),
        }),
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

  it("refuses a parameter sent twice (QRY-14)", async () => {
    expect(await get("?query=position&vehicle=a&vehicle=b")).toMatchObject({
      status: 400,
      body: { code: "invalid_parameter" },
    });
    expect(await get("?query=position&query=positions&vehicle=a")).toMatchObject({
      status: 400,
      body: { code: "invalid_parameter" },
    });
  });

  it("reads a list parameter sent as the key repeated, in order (QRY-12, QRY-13)", async () => {
    expect(await get("?query=positions&vehicle=tij-002&vehicle=mty-411")).toEqual({
      status: 200,
      body: { items: [{ vehicle: "mty-411" }, { vehicle: "tij-002" }] },
    });
    expect(await get("?query=positions&vehicle=mty-534")).toEqual({
      status: 200,
      body: { items: [{ vehicle: "mty-534" }] },
    });
  });

  it("never hands `read` an empty list: required and absent is refused, optional is undefined", async () => {
    const seen: unknown[] = [];
    const app = mount({
      id: "tech.rowing.fleet.tracker",
      queries: {
        answers: {
          chosen: query({
            parameters: z.object({ vehicle: z.array(z.string()) }),
            items: z.object({ vehicle: z.string() }),
            read: ({ vehicle }) => ({ items: vehicle.map((one) => ({ vehicle: one })) }),
          }),
          any: query({
            parameters: z.object({ vehicle: z.array(z.string()).optional() }),
            result: z.object({}),
            read: ({ vehicle }) => {
              seen.push(vehicle);
              return {};
            },
          }),
        },
      },
    });
    const required = await app.request("/queries?query=chosen");
    expect(required.status).toBe(400);
    expect(await required.json()).toMatchObject({ code: "invalid_parameter" });
    expect((await app.request("/queries?query=any")).status).toBe(200);
    expect(seen).toEqual([undefined]);
  });

  it("answers a collection in the page envelope, with no cursor at its end (QRY-9, ENDP-20)", async () => {
    expect(await get("?query=positions")).toEqual({
      status: 200,
      body: { items: [{ vehicle: "mty-411" }, { vehicle: "mty-534" }, { vehicle: "tij-002" }] },
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

  it("declares a parameter that is not a string (QRY-12)", () => {
    expect(
      mounting(
        query({
          parameters: z.object({ limit: z.number() }),
          result: z.object({}),
          read: () => ({}),
        }),
      ),
    ).toThrow(/QRY-12/);
  });

  it("declares a list of anything but strings (QRY-12)", () => {
    expect(
      mounting(
        query({
          parameters: z.object({ ids: z.array(z.number()) }),
          result: z.object({}),
          read: () => ({}),
        }),
      ),
    ).toThrow(/QRY-12/);
  });

  it("declares a list that is empty when it is not sent", () => {
    const defaulted = (vehicle: z.ZodType) =>
      mounting(
        query({ parameters: z.object({ vehicle }), result: z.object({}), read: () => ({}) }),
      );
    expect(defaulted(z.array(z.string()).default([]))).toThrow(/QRY-13.*empty list/);
    expect(defaulted(z.array(z.string()).catch([]))).toThrow(/QRY-13.*empty list/);
    // A default that holds something is the Query's to choose, and so is no default at all.
    expect(defaulted(z.array(z.string()).default(["mty-411"]))).not.toThrow();
    expect(defaulted(z.array(z.string()).optional())).not.toThrow();
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

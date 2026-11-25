import { mount, query } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { Refused } from "../call.ts";
import { consume } from "../index.ts";

/**
 * Reading what a Worker defines — both sides of the call, over one `fetch`.
 *
 * The Worker here is a real `mount()`, as in `nudging.test.ts`, because what is checked is that
 * the two halves of `queries` agree about a call the Descriptor declares and neither hard-codes:
 * which Query, which parameters, and whether the answer is one document or a collection.
 */

const FLEET = [
  { vehicle: "mty-411", lat: 25.68, lng: -100.31, moving: true },
  { vehicle: "mty-534", lat: 19.43, lng: -99.13, moving: false },
  { vehicle: "tij-002", lat: 32.51, lng: -117.03, moving: true },
];

const reads: string[] = [];

const tracker = mount({
  id: "tech.rowing.fleet.tracker",
  authenticate: (token) => (token === undefined ? "unauthenticated" : "accepted"),
  queries: {
    pageSize: 2,
    covers: ({ token }) => (token === "narrow" ? ["position"] : undefined),
    answers: {
      position: query({
        parameters: z.object({ vehicle: z.string(), units: z.enum(["deg", "rad"]).optional() }),
        result: z.object({ vehicle: z.string(), lat: z.number(), lng: z.number() }),
        read: ({ vehicle }, { name }) => {
          reads.push(name);
          const found = FLEET.find((one) => one.vehicle === vehicle);
          return { vehicle, lat: found?.lat ?? 0, lng: found?.lng ?? 0 };
        },
      }),
      positions: query({
        parameters: z.object({
          moving: z.enum(["true", "false"]).optional(),
          vehicle: z.array(z.string()).optional(),
        }),
        items: z.object({ vehicle: z.string(), lat: z.number(), lng: z.number() }),
        read: ({ moving, vehicle }, { cursor, limit }) => {
          const matching = FLEET.filter(
            (one) => moving === undefined || String(one.moving) === moving,
          )
            .filter((one) => vehicle === undefined || vehicle.includes(one.vehicle))
            .filter((one) => cursor === undefined || one.vehicle > cursor);
          const items = matching.slice(0, limit);
          const last = items.at(-1);
          return matching.length > limit && last !== undefined
            ? { items, nextCursor: last.vehicle }
            : { items };
        },
      }),
    },
  },
});

const reader = (credential = "enrolled") =>
  consume("https://tracker.invalid", {
    credential,
    retries: 0,
    fetch: ((url: string, init?: RequestInit) =>
      tracker.fetch(new Request(url, init))) as typeof fetch,
  });

const refusal = async (attempt: Promise<unknown> | undefined): Promise<Refused> => {
  const answered = await attempt?.catch((e: unknown) => e);
  expect(answered).toBeInstanceOf(Refused);
  return answered as Refused;
};

describe("reading a Query a Worker defines", () => {
  it("is declared with the schema of its parameters and of what it answers (QRY-1, QRY-12, QRY-4)", async () => {
    const { descriptor } = await reader();
    expect(descriptor.capabilities.queries).toMatchObject({
      version: 1,
      answers: {
        position: {
          parameters: {
            type: "object",
            properties: { vehicle: { type: "string" }, units: { type: "string" } },
            required: ["vehicle"],
          },
          result: { type: "object" },
        },
        positions: { items: { type: "object" } },
      },
    });
    const declared = descriptor.capabilities.queries as unknown as {
      answers: Record<string, Record<string, unknown>>;
    };
    expect(declared.answers.position).not.toHaveProperty("items");
    expect(declared.answers.positions).not.toHaveProperty("result");
  });

  it("answers the one document a Query declares under `result` (QRY-13, QRY-9)", async () => {
    const { queries } = await reader();
    await expect(queries?.read("position", { vehicle: "mty-411" })).resolves.toEqual({
      vehicle: "mty-411",
      lat: 25.68,
      lng: -100.31,
    });
    expect(reads).toContain("position");
  });

  it("pages through the collection a Query declares under `items` (QRY-9, ENDP-20)", async () => {
    const { queries } = await reader();
    const all = (await queries?.list("positions")) as { vehicle: string }[];
    expect(all.map((one) => one.vehicle)).toEqual(["mty-411", "mty-534", "tij-002"]);

    const first = await queries?.page("positions");
    expect(first?.items).toHaveLength(2);
    expect(first?.nextCursor).toBeTypeOf("string");
    const second = await queries?.page("positions", {}, { cursor: first?.nextCursor });
    expect(second?.items).toHaveLength(1);
    expect(second).not.toHaveProperty("nextCursor");

    const moving = (await queries?.list("positions", { moving: "true" })) as { vehicle: string }[];
    expect(moving.map((one) => one.vehicle)).toEqual(["mty-411", "tij-002"]);
  });

  it("sends a list parameter as the key repeated, and reads only those (QRY-12, QRY-13)", async () => {
    const { queries } = await reader();
    const chosen = (await queries?.list("positions", { vehicle: ["tij-002", "mty-411"] })) as {
      vehicle: string;
    }[];
    expect(chosen.map((one) => one.vehicle)).toEqual(["mty-411", "tij-002"]);
  });

  it("refuses an empty list before sending it, rather than read it as no filter", async () => {
    const { queries } = await reader();
    await expect(queries?.list("positions", { vehicle: [] })).rejects.toThrow(/empty list/);
    // Left out, as `undefined`, is how an optional list says no filter: every vehicle.
    const all = await queries?.list("positions", { vehicle: undefined });
    expect(all).toHaveLength(3);
  });

  it("refuses the other call before sending anything (QRY-4)", async () => {
    const { queries } = await reader();
    await expect(queries?.read("positions")).rejects.toThrow(/answers a collection/);
    await expect(queries?.list("position")).rejects.toThrow(/answers one document/);
  });

  it("is refused for a Query the Worker does not declare (QRY-6)", async () => {
    const { queries } = await reader();
    expect(await refusal(queries?.read("odometer"))).toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("is refused for parameters the declared schema refuses (QRY-14)", async () => {
    const { queries } = await reader();
    // One it requires, absent; one whose value it refuses.
    expect(await refusal(queries?.read("position"))).toMatchObject({ code: "invalid_parameter" });
    expect(
      await refusal(queries?.read("position", { vehicle: "mty-411", units: "miles" })),
    ).toMatchObject({ code: "invalid_parameter" });
  });

  it("is refused for a parameter the Query does not declare (ENDP-24)", async () => {
    const { queries } = await reader();
    expect(
      await refusal(queries?.read("position", { vehicle: "mty-411", fleet: "north" })),
    ).toMatchObject({ code: "unknown_filter" });
    // A Query that answers one document takes no cursor.
    expect(
      await refusal(queries?.read("position", { vehicle: "mty-411", cursor: "x" })),
    ).toMatchObject({ code: "unknown_filter" });
  });

  it("is refused for a credential that does not cover it, before its parameters are judged (QRY-10)", async () => {
    const { queries } = await reader("narrow");
    await expect(queries?.read("position", { vehicle: "mty-534" })).resolves.toMatchObject({
      vehicle: "mty-534",
    });
    // `moving: "maybe"` would be QRY-14's `400` for a credential that covers the Query.
    expect(await refusal(queries?.page("positions", { moving: "maybe" }))).toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  it("is absent from a Worker that declares no `queries`", async () => {
    const quiet = mount({ id: "tech.rowing.fleet.quiet" });
    const consumed = await consume("https://quiet.invalid", {
      fetch: ((url: string, init?: RequestInit) =>
        quiet.fetch(new Request(url, init))) as typeof fetch,
    });
    expect(consumed.queries).toBeUndefined();
  });
});

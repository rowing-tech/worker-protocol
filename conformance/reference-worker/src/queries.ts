import { type QueryDeclarations, query } from "@worker-protocol/hono";
import * as z from "zod";

/**
 * The `queries` Capability, arranged to be checked.
 *
 * Two Queries, because QRY-4 draws one line and a verifier that read only one side of it would have
 * nothing to say about the other: `fleet-summary` answers one document and takes one optional
 * parameter, so it can be read with no arrangement (QRY-13, QRY-9); `vehicles` answers a collection,
 * a page of two at a time, so the envelope and its cursor are something a check sees work.
 *
 * `vehicle` requires a parameter, which is what QRY-14 needs to be asked: a verifier cannot invent a
 * plate that exists, and can always leave one out. A plate it does not hold is `found: false` and
 * never `404`, which on this address means the Query itself is not declared (QRY-6).
 *
 * What these vehicles are is arranged, like everything else here. What is real is that reading
 * them changes nothing (ENDP-2): each answer is derived from the same constant, every time.
 */

const VEHICLES = [
  { plate: "ABC-123", status: "verified", lat: 25.68, lng: -100.31 },
  { plate: "DEF-456", status: "pending", lat: 19.43, lng: -99.13 },
  { plate: "GHI-789", status: "verified", lat: 32.51, lng: -117.03 },
] as const;

const STATUS = z.enum(["verified", "pending"]);

const vehicle = z.object({
  plate: z.string(),
  status: STATUS,
  lat: z.number(),
  lng: z.number(),
});

export const QUERIES: QueryDeclarations = {
  // QRY-4: one document. Its one parameter is optional, so a verifier can read it as it stands.
  "fleet-summary": query({
    parameters: z.object({ status: STATUS.optional() }),
    result: z.object({ vehicles: z.number().int(), verified: z.number().int() }),
    read: ({ status }) => {
      const counted = VEHICLES.filter((one) => status === undefined || one.status === status);
      return {
        vehicles: counted.length,
        verified: counted.filter((one) => one.status === "verified").length,
      };
    },
  }),

  // QRY-14: `plate` is required, so a read without it is refused before anything is looked up.
  vehicle: query({
    parameters: z.object({ plate: z.string().min(1) }),
    result: z.object({ found: z.boolean(), vehicle: vehicle.optional() }),
    read: ({ plate }) => {
      const found = VEHICLES.find((one) => one.plate === plate);
      return found === undefined ? { found: false } : { found: true, vehicle: { ...found } };
    },
  }),

  // QRY-9, ENDP-23, ENDP-33: ordered by plate, and the cursor names the last plate a page carried,
  // so the page after it holds only what is beyond that position. QRY-12, QRY-13: `plate` is a list,
  // sent as the key repeated, and selects the vehicles whose plate is any of them.
  vehicles: query({
    parameters: z.object({ status: STATUS.optional(), plate: z.array(z.string()).optional() }),
    items: vehicle,
    read: ({ status, plate }, { cursor, limit }) => {
      const beyond = VEHICLES.filter((one) => status === undefined || one.status === status)
        .filter((one) => plate === undefined || plate.includes(one.plate))
        .filter((one) => cursor === undefined || one.plate > cursor)
        .map((one) => ({ ...one }));
      const items = beyond.slice(0, limit);
      const last = items.at(-1);
      return beyond.length > limit && last !== undefined
        ? { items, nextCursor: last.plate }
        : { items };
    },
  }),
};

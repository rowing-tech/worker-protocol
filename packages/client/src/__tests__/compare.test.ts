import { describe, expect, it } from "vitest";
import * as z from "zod";
import { compare } from "../compare.ts";

/**
 * REG-36: what changed under a kept name, between two copies of one Descriptor.
 *
 * The schemas here are written in Zod and converted the way `mount()` converts them, because what a
 * Tower compares is what a Worker built on this repository actually serves — and a comparator
 * tested only against hand-written JSON Schema would be tested against shapes nobody publishes.
 *
 * **Every case is stated in both directions where the direction is the point.** NAME-6 gives one
 * edit opposite verdicts depending on which way the document travels, and a comparison that
 * reported the same edit the same way on an input and on an event would be wrong half the time.
 */

const schema = (type: z.ZodType) =>
  z.toJSONSchema(type, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;

type Declarations = {
  actions?: Record<string, { input: z.ZodType; result?: z.ZodType; supersededBy?: string }>;
  raises?: Record<string, z.ZodType>;
  publishes?: Record<string, z.ZodType>;
};

/** A Descriptor carrying the declarations given, and nothing a comparison would not read. */
function descriptor({ actions, raises, publishes }: Declarations) {
  const capabilities: Record<string, unknown> = {};
  if (actions !== undefined) {
    capabilities.actions = {
      version: 1,
      address: "../actions",
      accepts: Object.fromEntries(
        Object.entries(actions).map(([name, { input, result, supersededBy }]) => [
          name,
          {
            input: schema(input),
            ...(result === undefined ? {} : { result: schema(result) }),
            completesWithinCall: true,
            ...(supersededBy === undefined ? {} : { supersededBy }),
          },
        ]),
      ),
    };
  }
  if (raises !== undefined) {
    capabilities.tasks = {
      version: 1,
      address: "../tasks",
      raises: Object.fromEntries(
        Object.entries(raises).map(([name, payload]) => [name, { payload: schema(payload) }]),
      ),
    };
  }
  if (publishes !== undefined) {
    capabilities.events = {
      version: 1,
      publishes: Object.fromEntries(
        Object.entries(publishes).map(([name, data]) => [name, { data: schema(data) }]),
      ),
      republishWindowSeconds: 3600,
    };
  }
  const document = { id: "tech.rowing.fleet.billing", edition: "0.4", capabilities };
  return document as Parameters<typeof compare>[0]["before"];
}

const ACTION = "create-invoice";
const TYPE = "tech.rowing.fleet.invoice-overdue";
const EVENT = "tech.rowing.fleet.invoice-created";

const invoice = z.object({ customer: z.string(), amount: z.number() });

describe("compare, under a name the Worker kept", () => {
  it("finds nothing between two identical copies", () => {
    const copy = descriptor({ actions: { [ACTION]: { input: invoice } } });
    expect(compare({ before: copy, after: copy })).toEqual([]);
  });

  it("finds nothing where only a description changed, because no validator reads one", () => {
    const before = descriptor({ actions: { [ACTION]: { input: invoice } } });
    const after = descriptor({
      actions: { [ACTION]: { input: invoice.meta({ description: "Raise one invoice." }) } },
    });
    expect(compare({ before, after })).toEqual([]);
  });

  it("does not report a name that left, or one that arrived — the first is NAME-2's announcement", () => {
    const before = descriptor({ actions: { [ACTION]: { input: invoice } } });
    const after = descriptor({
      actions: { "create-invoice-v2": { input: invoice.extend({ currency: z.string() }) } },
    });
    expect(compare({ before, after })).toEqual([]);
  });

  it("does not report the old name beside its replacement, which is the shape NAME-10 names", () => {
    const before = descriptor({ actions: { [ACTION]: { input: invoice } } });
    const after = descriptor({
      actions: {
        [ACTION]: { input: invoice, supersededBy: "create-invoice-v2" },
        "create-invoice-v2": { input: invoice.extend({ currency: z.string() }) },
      },
    });
    expect(compare({ before, after })).toEqual([]);
  });
});

describe("compare, on what a Worker receives (NAME-6: against every sender built on the old)", () => {
  const changed = (input: z.ZodType) =>
    compare({
      before: descriptor({ actions: { [ACTION]: { input: invoice } } }),
      after: descriptor({ actions: { [ACTION]: { input } } }),
    });

  it("reports a member made required, at the member", () => {
    expect(changed(invoice.extend({ currency: z.string() }))).toEqual([
      {
        carried: "action input",
        name: ACTION,
        at: "currency",
        verdict: "breaking",
        why: "required by the new schema and not by the old",
      },
    ]);
  });

  it("does not report a member added as optional: every old document still validates", () => {
    expect(changed(invoice.extend({ currency: z.string().optional() }))).toEqual([]);
  });

  it("reports a member whose type changed", () => {
    expect(changed(z.object({ customer: z.string(), amount: z.string() }))).toMatchObject([
      {
        at: "amount",
        verdict: "breaking",
        why: "typed string by the new schema and number by the old",
      },
    ]);
  });

  it("reports a value an enum no longer admits, and not one it newly admits", () => {
    const tier = (values: [string, ...string[]]) => z.object({ tier: z.enum(values) });
    const narrowed = compare({
      before: descriptor({ actions: { [ACTION]: { input: tier(["basic", "pro"]) } } }),
      after: descriptor({ actions: { [ACTION]: { input: tier(["pro"]) } } }),
    });
    expect(narrowed).toMatchObject([
      { at: "tier", why: 'the new schema no longer admits "basic"' },
    ]);

    const widened = compare({
      before: descriptor({ actions: { [ACTION]: { input: tier(["pro"]) } } }),
      after: descriptor({ actions: { [ACTION]: { input: tier(["basic", "pro"]) } } }),
    });
    expect(widened).toEqual([]);
  });

  it("reports a change deep inside the input, at its path", () => {
    const addressed = (city: z.ZodType) => z.object({ address: z.object({ city }) });
    const found = compare({
      before: descriptor({ actions: { [ACTION]: { input: addressed(z.string()) } } }),
      after: descriptor({ actions: { [ACTION]: { input: addressed(z.number()) } } }),
    });
    expect(found).toMatchObject([{ at: "address.city", verdict: "breaking" }]);
  });

  it("reports a bound that tightened, and not one that loosened", () => {
    const named = (min: number) => z.object({ customer: z.string().min(min) });
    const tightened = compare({
      before: descriptor({ actions: { [ACTION]: { input: named(1) } } }),
      after: descriptor({ actions: { [ACTION]: { input: named(3) } } }),
    });
    expect(tightened).toMatchObject([
      { at: "customer", why: "`minLength` is 3 in the new schema and 1 in the old" },
    ]);
    const loosened = compare({
      before: descriptor({ actions: { [ACTION]: { input: named(3) } } }),
      after: descriptor({ actions: { [ACTION]: { input: named(1) } } }),
    });
    expect(loosened).toEqual([]);
  });

  it("reads a discriminated union ending by ending, and reports the one that changed", () => {
    const answer = (found: z.ZodObject) =>
      z.discriminatedUnion("outcome", [
        found,
        z.object({ outcome: z.literal("missing"), vehicle: z.string() }),
      ]);
    const before = descriptor({
      actions: {
        [ACTION]: {
          input: answer(z.object({ outcome: z.literal("found"), vehicle: z.string() })),
        },
      },
    });
    const after = descriptor({
      actions: {
        [ACTION]: {
          input: answer(
            z.object({ outcome: z.literal("found"), vehicle: z.string(), reachable: z.boolean() }),
          ),
        },
      },
    });
    expect(compare({ before, after })).toMatchObject([{ at: "reachable", verdict: "breaking" }]);
  });
});

describe("compare, on what a Worker sends (NAME-6: against every reader built on the old)", () => {
  it("does not report a required member added to an event: a reader built on the old ignores it", () => {
    const found = compare({
      before: descriptor({ publishes: { [EVENT]: invoice } }),
      after: descriptor({ publishes: { [EVENT]: invoice.extend({ currency: z.string() }) } }),
    });
    expect(found).toEqual([]);
  });

  it("reports a member an event no longer always carries — the same edit, the other way round", () => {
    const found = compare({
      before: descriptor({ publishes: { [EVENT]: invoice } }),
      after: descriptor({ publishes: { [EVENT]: invoice.partial({ amount: true }) } }),
    });
    expect(found).toEqual([
      {
        carried: "event data",
        name: EVENT,
        at: "amount",
        verdict: "breaking",
        why: "required by the old schema and not by the new",
      },
    ]);
  });

  it("reports a value a Task payload newly sends, which a reader built on the old refuses", () => {
    const found = compare({
      before: descriptor({ raises: { [TYPE]: z.object({ days: z.number() }) } }),
      after: descriptor({ raises: { [TYPE]: z.object({ days: z.number().nullable() }) } }),
    });
    expect(found).toMatchObject([
      { carried: "task payload", name: TYPE, at: "days", verdict: "breaking" },
    ]);
  });

  it("reports an Action that stopped answering a result", () => {
    const found = compare({
      before: descriptor({
        actions: { [ACTION]: { input: invoice, result: z.object({ id: z.string() }) } },
      }),
      after: descriptor({ actions: { [ACTION]: { input: invoice } } }),
    });
    expect(found).toMatchObject([{ carried: "action result", at: "", verdict: "breaking" }]);
  });
});

describe("compare, where it cannot tell", () => {
  it("says a keyword it does not read changed, rather than passing it", () => {
    const counted = (step: number) => z.object({ amount: z.number().multipleOf(step) });
    const found = compare({
      before: descriptor({ actions: { [ACTION]: { input: counted(1) } } }),
      after: descriptor({ actions: { [ACTION]: { input: counted(5) } } }),
    });
    expect(found).toMatchObject([
      {
        at: "amount",
        verdict: "unjudged",
        why: "`multipleOf` differs, and this comparison does not read it",
      },
    ]);
  });

  it("finds nothing where only the meaning moved — which is why an empty answer certifies nothing", () => {
    const seconds = z.object({ after: z.number().meta({ description: "Seconds." }) });
    const milliseconds = z.object({ after: z.number().meta({ description: "Milliseconds." }) });
    const found = compare({
      before: descriptor({ publishes: { [EVENT]: seconds } }),
      after: descriptor({ publishes: { [EVENT]: milliseconds } }),
    });
    expect(found).toEqual([]);
  });
});

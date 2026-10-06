import { describe, expect, it } from "vitest";
import { readDescriptor } from "../checks/descriptor.ts";
import { universe } from "../index.ts";
import { transcript } from "../transcript.ts";

/**
 * NAME-10 against Descriptors that get it wrong in the two ways a reference can be wrong.
 *
 * The reference Worker exercises the rule and passes it, which proves the check can say yes. These
 * prove it can say no: a replacement the map does not hold, and a chain that comes back to where it
 * started. Both are a reader following the Worker's own word onto nothing.
 */

const action = (supersededBy?: string) => ({
  input: { type: "object" },
  completesWithinCall: true,
  ...(supersededBy === undefined ? {} : { supersededBy }),
});

const raised = (supersededBy?: string) => ({
  payload: { type: "object" },
  ...(supersededBy === undefined ? {} : { supersededBy }),
});

/** A Descriptor with the given Actions and Task types, served at the route DESC-35 fixes. */
const serving =
  (accepts: Record<string, unknown>, raises: Record<string, unknown> = {}) =>
  async (): Promise<Response> =>
    Response.json({
      id: "tech.rowing.fleet.billing",
      edition: "0.4",
      capabilities: {
        actions: { version: 1, address: "../actions", accepts },
        tasks: { version: 1, address: "../tasks", raises },
      },
    });

const name10 = async (fetch: typeof globalThis.fetch) => {
  const { rules, attribution } = await universe();
  const { results } = await readDescriptor(
    "https://worker.invalid/",
    new Map(rules.map((rule) => [rule.id, rule])),
    attribution,
    transcript(fetch),
  );
  return results.find((result) => result.rule.id === "NAME-10");
};

describe("NAME-10, read off the Descriptor alone", () => {
  it("is not exercised where no declaration names a replacement", async () => {
    const result = await name10(serving({ "create-invoice": action() }));
    expect(result?.verdict).toBe("notExercised");
  });

  it("passes a chain that ends, across more than one replacement", async () => {
    const result = await name10(
      serving({
        "create-invoice": action("create-invoice-v2"),
        "create-invoice-v2": action("create-invoice-v3"),
        "create-invoice-v3": action(),
      }),
    );
    expect(result?.verdict).toBe("passes");
  });

  it("fails a replacement the map does not hold, naming the declaration that carries it", async () => {
    const result = await name10(serving({ "create-invoice": action("create-invoice-v2") }));
    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toBe(
      "actions.accepts.create-invoice names `create-invoice-v2`, which actions.accepts does not hold",
    );
  });

  it("fails a name another map holds: a replacement is of the same kind", async () => {
    // `raises` holds the name and `accepts` does not, so a reader that resolves it in the map it
    // was reading — the only one NAME-10 points it at — finds nothing.
    const type = "tech.rowing.fleet.invoice-overdue";
    const result = await name10(serving({ "create-invoice": action(type) }, { [type]: raised() }));
    expect(result?.verdict).toBe("fails");
  });

  it("fails a chain that returns to where it started, from every member of the loop", async () => {
    const a = "tech.rowing.fleet.invoice-overdue";
    const b = "tech.rowing.fleet.invoice-late";
    const result = await name10(serving({}, { [a]: raised(b), [b]: raised(a) }));
    expect(result?.verdict).toBe("fails");
    expect(result?.detail).toBe(
      `tasks.raises.${a} is replaced by a chain that returns to it; ` +
        `tasks.raises.${b} is replaced by a chain that returns to it`,
    );
  });

  it("fails a declaration that names itself, which is the shortest loop", async () => {
    const result = await name10(serving({ "create-invoice": action("create-invoice") }));
    expect(result?.verdict).toBe("fails");
  });
});

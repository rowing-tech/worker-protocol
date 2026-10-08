import { describe, expect, it } from "vitest";
import { canAnswer } from "../skills.ts";

/**
 * Whether one Worker can answer another's Tasks, decided from two Descriptors and nothing else.
 *
 * Two documents travel, one each way, so there are two halves. The Task goes from the owner to the
 * answerer, and what the answerer requires must be covered by what the owner sends. The answer goes
 * back, and for at least one Action the owner names, what that Action takes must be covered by what
 * the answerer produces under the same name.
 *
 * **A Task type has several answers, and an answerer that gives one of them is a fit.** TASK-35 has
 * the owner name every Action that answers it; TASK-36 has the answerer say what it produces for
 * each it can perform, by that name. The name is matched only inside the one Task type both sides
 * already share, so an answer the owner calls something else is not an answer here.
 *
 * **Inside one Action, a union is still a union.** An Action's input may tell its variants apart by
 * a member the OWNER mints — `outcome: "found"` — and an answerer that produces one variant without
 * repeating that word is producing a subtype, which is assignable. Charging the word against it
 * would refuse an answerer for not knowing a constant its shape already implies.
 */

const TYPE = "tech.rowing.fleet.check-silent-vehicle";

const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
});

const VEHICLE = { vehicle: { type: "string" } };

/** The owner: three answers, the last one a union told apart by a word of its own. */
const owner = (answeredBy: string[] = ["record-check", "report-missing", "answer-check"]) =>
  ({
    id: "tech.rowing.fleet.watcher",
    edition: "0.5",
    capabilities: {
      tasks: {
        version: 1,
        address: "../tasks",
        raises: { [TYPE]: { payload: object(VEHICLE, ["vehicle"]), answeredBy } },
      },
      actions: {
        version: 1,
        address: "../actions",
        accepts: {
          "record-check": {
            input: object({ ...VEHICLE, reachable: { type: "boolean" } }, ["vehicle", "reachable"]),
          },
          "report-missing": {
            input: object({ ...VEHICLE, lastSeen: { type: "string" } }, ["vehicle", "lastSeen"]),
          },
          "answer-check": {
            input: {
              anyOf: [
                object(
                  { outcome: { const: "found" }, ...VEHICLE, reachable: { type: "boolean" } },
                  ["outcome", "vehicle", "reachable"],
                ),
                object(
                  { outcome: { const: "missing" }, ...VEHICLE, lastSeen: { type: "string" } },
                  ["outcome", "vehicle", "lastSeen"],
                ),
              ],
            },
          },
        },
      },
    },
  }) as never;

/** The answerer: it declares what it needs and what it can produce, naming no owner. */
const answerer = (produces?: Record<string, unknown>) =>
  ({
    id: "tech.rowing.field.crew",
    edition: "0.5",
    capabilities: {},
    skills: {
      [TYPE]: {
        payload: object(VEHICLE, ["vehicle"]),
        ...(produces === undefined ? {} : { produces }),
      },
    },
  }) as never;

const found = object({ ...VEHICLE, reachable: { type: "boolean" } }, ["vehicle", "reachable"]);

describe("the answering half, where a Task type has several answers", () => {
  it("accepts an answerer that gives one of them, and says which", async () => {
    expect(canAnswer(owner(), answerer({ "record-check": found }), TYPE)).toEqual({
      verdict: "compatible",
      why: "it can read what the owner sends and produce what it takes",
      through: ["record-check"],
    });
  });

  it("names every answer that fits, in the owner's order", async () => {
    const both = answerer({
      "report-missing": object({ ...VEHICLE, lastSeen: { type: "string" } }, [
        "vehicle",
        "lastSeen",
      ]),
      "record-check": found,
    });
    expect(canAnswer(owner(), both, TYPE).through).toEqual(["record-check", "report-missing"]);
  });

  it("is a fit where one answer fits and another does not", async () => {
    const one = answerer({ "record-check": found, "report-missing": object(VEHICLE, ["vehicle"]) });
    expect(canAnswer(owner(), one, TYPE)).toMatchObject({
      verdict: "compatible",
      through: ["record-check"],
    });
  });

  it("refuses where the only answer it names needs more than it has", async () => {
    const partial = answerer({ "report-missing": object(VEHICLE, ["vehicle"]) });
    expect(canAnswer(owner(), partial, TYPE)).toEqual({
      verdict: "incompatible",
      why: "`report-missing` requires what it does not produce: lastSeen",
    });
  });

  it("refuses where it produces only for answers this owner does not name", async () => {
    // Another owner of the type may call it `log-check`. This one does not, so it is no answer here.
    const elsewhere = answerer({ "log-check": found });
    expect(canAnswer(owner(["record-check", "report-missing"]), elsewhere, TYPE)).toEqual({
      verdict: "incompatible",
      why: "it produces for none of the owner's answers: record-check, report-missing",
    });
  });

  it("says `unknown` where the owner names no Action that answers the type", async () => {
    // Work done elsewhere, whose condition clears on a Fact the owner observes (TASK-35).
    expect(canAnswer(owner([]), answerer({ "record-check": found }), TYPE).verdict).toBe("unknown");
  });

  it("says `unknown` where it claims the Skill and declares neither half", async () => {
    // TASK-36 admits it, and a Tower reporting that as a refusal would invent an obligation.
    const silent = {
      id: "tech.rowing.field.crew",
      edition: "0.5",
      capabilities: {},
      skills: { [TYPE]: {} },
    } as never;
    expect(canAnswer(owner(), silent, TYPE).verdict).toBe("unknown");
  });
});

describe("one answer whose input is a union", () => {
  it("accepts an answerer that produces one variant without naming it", async () => {
    // It has the facts `found` needs and never heard the word `outcome`.
    expect(
      canAnswer(owner(["answer-check"]), answerer({ "answer-check": found }), TYPE).verdict,
    ).toBe("compatible");
  });

  it("accepts an answerer that does name the variant", async () => {
    // Naming it is allowed and is what a consumer written against one owner would do. The
    // discriminator then picks the variant rather than being charged against the answerer.
    const named = answerer({
      "answer-check": object(
        { outcome: { const: "found" }, ...VEHICLE, reachable: { type: "boolean" } },
        ["outcome", "vehicle", "reachable"],
      ),
    });
    expect(canAnswer(owner(["answer-check"]), named, TYPE).verdict).toBe("compatible");
  });

  it("refuses where the variant it names needs more than it has", async () => {
    // It says `missing` and does not carry `lastSeen`, so the variant it chose is the one judged.
    const partial = answerer({
      "answer-check": object({ outcome: { const: "missing" }, ...VEHICLE }, ["outcome", "vehicle"]),
    });
    expect(canAnswer(owner(["answer-check"]), partial, TYPE)).toEqual({
      verdict: "incompatible",
      why: "`answer-check` requires what it does not produce: lastSeen",
    });
  });

  it("refuses where it satisfies no variant at all", async () => {
    const bare = answerer({ "answer-check": object(VEHICLE, ["vehicle"]) });
    expect(canAnswer(owner(["answer-check"]), bare, TYPE).verdict).toBe("incompatible");
  });
});

describe("the receiving half", () => {
  it("refuses where it requires what the owner does not send", async () => {
    const demanding = {
      id: "tech.rowing.field.crew",
      edition: "0.5",
      capabilities: {},
      skills: {
        [TYPE]: {
          payload: object({ vehicle: { type: "string" }, plate: { type: "string" } }, [
            "vehicle",
            "plate",
          ]),
        },
      },
    } as never;
    expect(canAnswer(owner(), demanding, TYPE)).toMatchObject({
      verdict: "incompatible",
      why: "it requires what the owner does not send: plate",
    });
  });

  it("refuses a type the answerer declares no Skill for", async () => {
    expect(canAnswer(owner(), answerer(), "tech.rowing.somebody.else").verdict).toBe(
      "incompatible",
    );
  });
});

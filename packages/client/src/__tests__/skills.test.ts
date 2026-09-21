import { describe, expect, it } from "vitest";
import { canAnswer } from "../skills.ts";

/**
 * Whether one Worker can answer another's Tasks, decided from two Descriptors and nothing else.
 *
 * Two documents travel, one each way, so there are two halves. The Task goes from the owner to the
 * answerer, and what the answerer requires must be covered by what the owner sends. The answer goes
 * back, and what the owner's Action takes must be covered by what the answerer produces.
 *
 * **The sending half is where the design was nearly wrong, and the cases below are why.** TASK-32
 * puts a Task's several endings in one Action's input as a union, told apart by a member the OWNER
 * mints — `outcome: "found"`. An answerer writes its `produces` from its own side, for owners it has
 * never read, so it cannot know that word. Charging it as coverage the answerer owes refused every
 * honest answerer and put the per-owner mapping back exactly where withdrawing TASK-2's list of
 * Actions had taken it from.
 */

const TYPE = "tech.rowing.fleet.check-silent-vehicle";

const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
});

/** The owner: one Action, two endings, discriminated by a word of its own. */
const owner = {
  id: "tech.rowing.fleet.watcher",
  edition: "0.1",
  capabilities: {
    tasks: {
      version: 1,
      address: "../tasks",
      raises: {
        [TYPE]: {
          payload: object({ vehicle: { type: "string" } }, ["vehicle"]),
          answeredBy: "answer-check",
        },
      },
    },
    actions: {
      version: 1,
      address: "../actions",
      accepts: {
        "answer-check": {
          input: {
            anyOf: [
              object(
                {
                  outcome: { const: "found" },
                  vehicle: { type: "string" },
                  reachable: { type: "boolean" },
                },
                ["outcome", "vehicle", "reachable"],
              ),
              object(
                {
                  outcome: { const: "missing" },
                  vehicle: { type: "string" },
                  lastSeen: { type: "string" },
                },
                ["outcome", "vehicle", "lastSeen"],
              ),
            ],
          },
        },
      },
    },
  },
} as never;

/** The answerer: it declares what it needs and what it can produce, naming no owner. */
const answerer = (skill: Record<string, unknown>) =>
  ({
    id: "tech.rowing.field.crew",
    edition: "0.1",
    capabilities: {},
    skills: { [TYPE]: { payload: object({ vehicle: { type: "string" } }, ["vehicle"]), ...skill } },
  }) as never;

describe("the sending half, where a Task has several endings", () => {
  it("accepts an answerer that produces one ending without naming it", async () => {
    // The case that matters: it has the facts `found` needs and never heard the word `outcome`.
    const found = answerer({
      produces: object({ vehicle: { type: "string" }, reachable: { type: "boolean" } }, [
        "vehicle",
        "reachable",
      ]),
    });
    expect(canAnswer(owner, found, TYPE).verdict).toBe("compatible");
  });

  it("accepts an answerer that does name the ending", async () => {
    // Naming it is allowed and is what a consumer written against one owner would do. The
    // discriminator then picks the variant rather than being charged against the answerer.
    const found = answerer({
      produces: object(
        {
          outcome: { const: "found" },
          vehicle: { type: "string" },
          reachable: { type: "boolean" },
        },
        ["outcome", "vehicle", "reachable"],
      ),
    });
    expect(canAnswer(owner, found, TYPE).verdict).toBe("compatible");
  });

  it("refuses where the ending it names needs more than it has", async () => {
    // It says `missing` and does not carry `lastSeen`, so the variant it chose is the one judged.
    const partial = answerer({
      produces: object({ outcome: { const: "missing" }, vehicle: { type: "string" } }, [
        "outcome",
        "vehicle",
      ]),
    });
    expect(canAnswer(owner, partial, TYPE)).toEqual({
      verdict: "incompatible",
      why: "the owner's Action requires what it does not produce: lastSeen",
    });
  });

  it("refuses where it satisfies no ending at all", async () => {
    const bare = answerer({ produces: object({ vehicle: { type: "string" } }, ["vehicle"]) });
    expect(canAnswer(owner, bare, TYPE).verdict).toBe("incompatible");
  });

  it("says `unknown` where it claims the Skill and declares neither half", async () => {
    // TASK-31 admits it, and a Tower reporting that as a refusal would invent an obligation.
    const silent = {
      id: "tech.rowing.field.crew",
      edition: "0.1",
      capabilities: {},
      skills: { [TYPE]: {} },
    } as never;
    expect(canAnswer(owner, silent, TYPE).verdict).toBe("unknown");
  });
});

describe("the receiving half", () => {
  it("refuses where it requires what the owner does not send", async () => {
    const demanding = {
      id: "tech.rowing.field.crew",
      edition: "0.1",
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
    expect(canAnswer(owner, demanding, TYPE)).toMatchObject({
      verdict: "incompatible",
      why: "it requires what the owner does not send: plate",
    });
  });

  it("refuses a type the answerer declares no Skill for", async () => {
    expect(canAnswer(owner, answerer({}), "tech.rowing.somebody.else").verdict).toBe(
      "incompatible",
    );
  });
});

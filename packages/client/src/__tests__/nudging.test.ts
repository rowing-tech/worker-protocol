import { mount } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { Refused } from "../call.ts";
import { consume } from "../index.ts";

/**
 * Telling a Worker there is work of a type it answers — both sides of the call, over one `fetch`.
 *
 * The other tests in this package stub the Worker, because what they are about is the consumer
 * behaving correctly against a Worker made to misbehave. This one is about the opposite: the
 * receiver here is a real `mount()`, so what is checked is that the two halves of `nudges` agree
 * about a call neither of them declares. Nothing in either Descriptor says what a nudge carries —
 * the protocol does — which is exactly the property that stopped it being an Action.
 */

const LOCATE = "tech.rowing.dispatch.locate-vehicle";

const told: string[] = [];

const answerer = mount({
  id: "tech.rowing.field.crew",
  skills: { [LOCATE]: { payload: z.object({ vehicle: z.string() }) } },
  nudges: (type) => {
    told.push(type);
  },
});

/** The owner's side: `consume()` over the answerer, with no network anywhere. */
const owner = () =>
  consume("https://crew.invalid", {
    fetch: ((url: string, init?: RequestInit) =>
      answerer.fetch(new Request(url, init))) as typeof fetch,
  });

describe("nudging a Worker that can answer", () => {
  it("is offered only where the Worker declares the address", async () => {
    const consumed = await owner();
    expect(consumed.nudges).toBeTypeOf("function");
  });

  it("carries the type and nothing else, and answers nothing", async () => {
    const consumed = await owner();
    await expect(consumed.nudges?.(LOCATE)).resolves.toBeUndefined();
    expect(told).toEqual([LOCATE]);
  });

  it("is refused for a type the Worker declares no Skill for (NDG-3)", async () => {
    // The owner asked the wrong Worker. A `404` here says *not me*, so the owner goes and finds
    // somebody who can — which is the whole reason accepting one would have been worse than silence.
    const consumed = await owner();
    const refusal = await consumed.nudges?.("tech.rowing.somebody.else-entirely").catch((e) => e);
    expect(refusal).toBeInstanceOf(Refused);
    expect((refusal as Refused).code).toBe("not_found");
  });

  it("is absent from a Worker that declares no `nudges`", async () => {
    const quiet = mount({ id: "tech.rowing.field.quiet" });
    const consumed = await consume("https://quiet.invalid", {
      fetch: ((url: string, init?: RequestInit) =>
        quiet.fetch(new Request(url, init))) as typeof fetch,
    });
    expect(consumed.nudges).toBeUndefined();
  });
});

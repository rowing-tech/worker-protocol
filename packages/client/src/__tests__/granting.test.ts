import { action, memoryGrants, mount } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { consume, Refused } from "../index.ts";

/**
 * `grants` from the applicant's side: `consume()` applying a grant to a Worker on `mount()`, and
 * the consumer it was for reading with the credential that came back. Nothing crosses a socket.
 */

const ID = "tech.rowing.worker-protocol.granting";
const REVIEW = "tech.rowing.test.review";

const app = mount({
  id: ID,
  authenticate: (token) =>
    token === "tower" ? { verdict: "accepted", caller: "tower" } : "unauthenticated",
  actions: { accepts: { approve: action({ input: z.object({}), run: () => undefined }) } },
  tasks: {
    raises: { [REVIEW]: { payload: z.object({}), answeredBy: ["approve"] } },
    current: () => [{ id: "D-1", type: REVIEW, payload: {}, since: new Date() }],
  },
  grants: { store: memoryGrants(), applicants: (caller) => caller === "tower" },
});

const as = (credential: string) =>
  consume("https://worker.example.com", {
    credential,
    fetch: ((url: string, init?: RequestInit) =>
      app.fetch(new Request(url, init))) as unknown as typeof globalThis.fetch,
  });

const REVIEWER = { id: "c-42", tasks: [REVIEW], actions: ["approve"], events: [] };

describe("granting with consume()", () => {
  it("applies a grant, and the credential it answers reads what the grant covers (GRANT-4, GRANT-8)", async () => {
    const grants = (await as("tower")).grants;
    const applied = await grants?.apply(REVIEWER);
    expect(applied).toMatchObject({ ...REVIEWER, created: true, credential: expect.any(String) });

    const consumer = await as(applied?.credential ?? "");
    expect((await consumer.tasks?.list())?.map((one) => one.id)).toEqual(["D-1"]);
  });

  it("replaces without a credential, lists, and revokes (GRANT-5, GRANT-6, GRANT-7)", async () => {
    const grants = (await as("tower")).grants;
    await grants?.apply({ ...REVIEWER, id: "c-43" });
    const replaced = await grants?.apply({ ...REVIEWER, id: "c-43", tasks: "all" });
    expect(replaced).toEqual({ ...REVIEWER, id: "c-43", tasks: "all", created: false });
    expect((await grants?.list())?.map((one) => one.id)).toContain("c-43");

    await grants?.revoke("c-43");
    expect((await grants?.list())?.map((one) => one.id)).not.toContain("c-43");
    await expect(grants?.revoke("c-43")).rejects.toBeInstanceOf(Refused);
  });
});

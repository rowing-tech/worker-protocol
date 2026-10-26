import type { StoredGrant } from "@worker-protocol/hono";
import { describe, expect, it } from "vitest";
import { durableGrants } from "../src/index.ts";
import { whole } from "./outbound.ts";

/** The grant store, over a Durable Object of the test's own. */
const store = () => durableGrants(whole());

const grant = (over: Partial<StoredGrant> = {}): StoredGrant => ({
  applicant: "tower",
  id: "contract-1",
  serial: 1,
  digest: "digest-1",
  tasks: "all",
  actions: ["record-inspection"],
  events: [],
  ...over,
});

describe("withGrants", () => {
  it("writes a grant nobody holds, and finds it by its applicant and id, and by its digest (GRANT-4)", async () => {
    const grants = store();
    expect(await grants.put(grant(), null)).toBe(true);
    expect(await grants.get("tower", "contract-1")).toEqual(grant());
    expect(await grants.byDigest("digest-1")).toEqual(grant());
    expect(await grants.get("tower", "nothing")).toBeUndefined();
    expect(await grants.byDigest("nothing")).toBeUndefined();
  });

  it("compares and sets: a write that expected another serial writes nothing (GRANT-5)", async () => {
    const grants = store();
    await grants.put(grant({ id: "raced" }), null);
    // Two applications read the grant absent and both try to create it: the second loses.
    expect(await grants.put(grant({ id: "raced", digest: "digest-2" }), null)).toBe(false);
    expect(await grants.byDigest("digest-2")).toBeUndefined();
    // A rotation expects the serial it read, and advances it.
    expect(await grants.put(grant({ id: "raced", serial: 2, digest: "digest-2" }), 1)).toBe(true);
    expect((await grants.get("tower", "raced"))?.serial).toBe(2);
  });

  it("forgets the digest a rotation replaced, so the credential before it is found by nothing (GRANT-9)", async () => {
    const grants = store();
    await grants.put(grant({ id: "rotated", digest: "before" }), null);
    await grants.put(grant({ id: "rotated", serial: 2, digest: "after" }), 1);
    expect(await grants.byDigest("before")).toBeUndefined();
    expect((await grants.byDigest("after"))?.serial).toBe(2);
  });

  it("lists one applicant's grants and nobody else's, and says whether a revocation found one (GRANT-6, GRANT-7)", async () => {
    const grants = store();
    await grants.put(grant({ applicant: "tower", id: "b", digest: "d-b" }), null);
    await grants.put(grant({ applicant: "tower", id: "a", digest: "d-a" }), null);
    await grants.put(grant({ applicant: "other", id: "a", digest: "d-other" }), null);
    expect((await grants.list("tower")).map((one) => one.id)).toEqual(["a", "b"]);
    expect((await grants.list("other")).map((one) => one.id)).toEqual(["a"]);

    expect(await grants.remove("tower", "a")).toBe(true);
    expect(await grants.remove("tower", "a")).toBe(false);
    expect(await grants.byDigest("d-a")).toBeUndefined();
    // The other applicant's grant under the same id is untouched: a grant is identified by both.
    expect(await grants.get("other", "a")).toBeDefined();
  });
});

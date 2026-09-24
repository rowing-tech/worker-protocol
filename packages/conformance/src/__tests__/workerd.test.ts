import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, unstable_readConfig } from "wrangler";
import type { Report } from "../index.ts";

/**
 * The verifier running on workerd, rather than a Worker on workerd being verified from Node.
 *
 * `fleet-worker.test.ts` puts the SUBJECT on another runtime. This puts the TOOL there, which is
 * the claim a Control Tower depends on: it enrolls Workers from inside its own runtime — a
 * Cloudflare Worker, a Vercel or Deno edge function, a Convex action — and has to verify them from
 * there, where no `node:fs` resolves and a bundler has left `rules.json` behind.
 *
 * **No `nodejs_compat`, and that is the test.** The loader this package shipped up to 0.3.0, which
 * read `rules.json` through `node:fs` beside `import.meta.dirname`, answers a 500 here on the first
 * call, which is the failure a Tower would meet. What this cannot see is an import nothing calls,
 * since the bundler drops it and the run goes on passing; `portable.test.ts` reads the published
 * `dist/` for exactly that, without starting anything.
 */

const ENTRY = join(import.meta.dirname, "workerd-entry.ts");
const FLEET = join(import.meta.dirname, "..", "..", "..", "..", "examples", "fleet-worker");

/**
 * The date `examples/fleet-worker/wrangler.jsonc` pins, which is the newest the bundled workerd
 * starts on. Read from there rather than written again, so the two move together.
 */
const { compatibility_date: compatibilityDate } = unstable_readConfig({
  config: join(FLEET, "wrangler.jsonc"),
});

describe("the verifier inside a Worker runtime, with no Node in it", () => {
  let report: Report;
  let worker: Awaited<ReturnType<typeof unstable_dev>>;

  beforeAll(async () => {
    worker = await unstable_dev(ENTRY, {
      compatibilityDate,
      compatibilityFlags: [],
      experimental: { disableExperimentalWarning: true },
    });
    const response = await worker.fetch();
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`verify() did not run on workerd: ${response.status} ${body}`);
    }
    report = (await response.json()) as Report;
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
  });

  it("fails nothing, reaching the minimal Worker over https through the fetch it was handed", () => {
    // No DESC-3 exemption: an in-process `fetch` needs no socket, so the base URL is `https`, and
    // this is the one suite in this package where every rule the Worker can satisfy, it does.
    const failing = report.results.filter((one) => one.verdict === "fails").map((r) => r.rule.id);
    expect(failing).toEqual([]);
  });

  it("reports on the whole universe, from the module rather than from a file", () => {
    // Every rule has a verdict, so the universe arrived intact. And most of the `W` rules were
    // judged, so the run was a run rather than a Descriptor that never loaded.
    expect(new Set(report.results.map((one) => one.rule.id)).size).toBe(164);
    const judged = report.results.filter(
      (one) => one.rule.reach === "W" && (one.verdict === "passes" || one.verdict === "fails"),
    );
    expect(judged.length).toBeGreaterThan(60);
  });
});

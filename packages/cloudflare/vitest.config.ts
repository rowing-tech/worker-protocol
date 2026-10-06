import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * On workerd, as `examples/fleet-worker` is: real Durable Objects, real SQLite, a real alarm. The
 * pool pins its own vitest major, which is why this package's `vitest` is a version behind the
 * packages that run on Node.
 */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/**/*.test.ts"] },
});

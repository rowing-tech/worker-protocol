import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * The one suite in this repository that does not run on Node.
 *
 * It runs on workerd, which is what makes `examples/fleet-worker` evidence about the platform the
 * architecture names first rather than about something shaped like it: real durable objects, real
 * input gates, real isolate boundaries. Everything else here is plain vitest on Node, and the
 * difference is deliberate — this is the one place where the runtime is the thing under test.
 *
 * The pool pins its own vitest major, which is why this package's `vitest` is a version behind the
 * rest of the workspace. Each package runs its own, so the two never meet.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      // The bindings, the migrations and the class names all come from the deployed config, so a
      // test cannot pass against a shape the Worker is not actually deployed with.
      wrangler: { configPath: "./wrangler.jsonc" },
      // REG-3's token, which `wrangler.jsonc` does not carry because a secret does not belong in a
      // committed file. `test/protocol.test.ts` presents this one and one other, and expects `401`.
      miniflare: { bindings: { CREDENTIAL: "a-token" } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});

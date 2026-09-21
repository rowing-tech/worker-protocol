/**
 * The minimal Worker on a socket. `node examples/minimal-worker/src/server.ts`, or `PORT=… node …`.
 *
 * This file is not counted by `pnpm dx:check`: serving an app is a platform's business and not the
 * protocol's, and a Worker on Cloudflare or Convex exports `app.fetch` instead of any of this.
 */

import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { app, type Env } from "./worker.ts";

export { app, type Env, fleetWorker } from "./worker.ts";

/**
 * On Node the environment is ambient, so it is handed in here rather than by the runtime.
 *
 * On Cloudflare, Vercel edge or Deno Deploy this file does not exist: the platform passes `env` to
 * `fetch` itself and the whole entry point is `export default { fetch: app.fetch }`.
 */
export const server = (env: Env = process.env) =>
  createServer(getRequestListener((request) => app.fetch(request, env)));

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 8788);
  server().listen(port, () => {
    console.log(`minimal worker on http://localhost:${port}/.well-known/worker-protocol`);
  });
}

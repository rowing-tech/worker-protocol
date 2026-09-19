/**
 * The minimal Worker on a socket. `node examples/minimal-worker/src/server.ts`, or `PORT=… node …`.
 *
 * This file is not counted by `pnpm dx:check`: serving an app is a platform's business and not the
 * protocol's, and a Worker on Cloudflare or Convex exports `app.fetch` instead of any of this.
 */

import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { app } from "./worker.ts";

export { app, fleetWorker } from "./worker.ts";

export const server = () => createServer(getRequestListener(app.fetch));

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 8788);
  server().listen(port, () => {
    console.log(`minimal worker on http://localhost:${port}/.well-known/worker-protocol`);
  });
}

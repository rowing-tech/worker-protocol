import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SinkExchange } from "./checks/subscriptions.ts";

/**
 * A sink for the arrangement `subscriptions` is judged by, on a socket of this machine's own.
 *
 * `verify()` starts no server, so that it runs in any runtime, and `Arrangement.sink` is the
 * caller's to bring. A caller in TypeScript brings whatever its runtime serves with; the command
 * line has no such caller, so this is the sink it brings for one. It is Node's, which is why it is
 * here and imported only by `cli.ts` — never by `index.ts`, whose promise is that the library
 * imports no Node built-in.
 *
 * It records every request it receives, oldest first, which is what the checks read. It allows
 * whatever origin the handshake names (SUB-10), because it lives for one run and has one visitor,
 * and it answers every delivery `200`.
 */
export type ListeningSink = {
  /** Where the Worker is told to deliver: `publicUrl` where one was given, the socket otherwise. */
  url: string;
  /** The socket's own origin, which a Worker in development exempts from SUB-5 and SUB-6. */
  origin: string;
  received: () => SinkExchange[];
  close: () => Promise<void>;
};

export function listenAsSink(options: {
  /** The port on `127.0.0.1`; `0` takes whichever is free. */
  port: number;
  /**
   * The address the Worker can reach, where it is not this socket: a tunnel's public `https` URL
   * forwarding to `port`. A deployed Worker refuses a plaintext or loopback sink (SUB-5, SUB-6),
   * so only a Worker in development exempting this origin is reached without one.
   */
  publicUrl?: string;
}): Promise<ListeningSink> {
  return new Promise((resolve, reject) => {
    const received: SinkExchange[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const headers = Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
        );
        received.push({ method: request.method ?? "GET", headers, body });
        if (request.method === "OPTIONS") {
          response.writeHead(200, {
            "webhook-allowed-origin": String(request.headers["webhook-request-origin"] ?? "*"),
          });
        } else {
          response.writeHead(200);
        }
        response.end();
      });
    });
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;
      resolve({
        url: options.publicUrl ?? `${origin}/events`,
        origin,
        received: () => [...received],
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

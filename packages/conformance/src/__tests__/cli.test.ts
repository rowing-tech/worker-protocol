import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "../../../../conformance/reference-worker/src/server.ts";
import type { Report } from "../report.ts";

/**
 * The command line, run as a process, against the reference Worker over a real socket.
 *
 * `verify()` is exercised everywhere else; what only this file reaches is what the CLI adds to it —
 * an arrangement read from a file, refused when it is not one, and a sink of its own on a port. The
 * process is the unit, because the exit code is the CLI's whole contract and a test that imported
 * the module could not see one.
 */

const CLI = join(import.meta.dirname, "..", "cli.ts");

type Run = { code: number; stdout: string; stderr: string };

const run = (args: string[]) =>
  new Promise<Run>((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, WORKER_PROTOCOL_CREDENTIAL: "a-token" } },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : Number(error.code), stdout, stderr });
      },
    );
  });

/** A port nothing holds, for a sink whose origin the Worker has to be told before it starts. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

const arrangementAt = async (contents: unknown) => {
  const path = join(await mkdtemp(join(tmpdir(), "conformance-")), "arrangement.json");
  await writeFile(path, JSON.stringify(contents));
  return path;
};

/** The Action whose performance publishes, as the reference Worker's operators would name it. */
const PUBLISHING = {
  publishingAction: {
    name: "record-verification",
    input: { vehicle: "DEF-456", verified: true },
    publishes: "tech.rowing.worker-protocol.task-ended",
  },
  otherCallerCredential: "d-token",
};

describe("the command line", () => {
  let port: number;
  let worker: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    port = await freePort();
    // The sink's origin exempted by name, as a Worker in development exempts a local backend: the
    // one way a socket on this machine is reached without a tunnel in front of it.
    const server = createWorker({
      credential: "a-token",
      consumerCredential: "d-token",
      insecureSinkOrigins: [`http://127.0.0.1:${port}`],
    });
    worker = await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const at = typeof address === "object" && address !== null ? address.port : 0;
        resolve({
          url: `http://127.0.0.1:${at}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      });
    });
  });

  afterEach(async () => {
    await worker.close();
  });

  it("judges `subscriptions` at a sink of its own, from an arrangement in a file", async () => {
    const arrangement = await arrangementAt(PUBLISHING);
    const { stdout } = await run([
      worker.url,
      "--may-perform",
      "--arrangement",
      arrangement,
      "--sink-port",
      String(port),
      "--json",
    ]);
    const report = JSON.parse(stdout) as Report;
    const verdict = (id: string) => report.results.find((one) => one.rule.id === id)?.verdict;
    // SUB-10 is the handshake reaching the sink, SUB-11 a delivery with its credential, EVT-15 the
    // lifecycle event the arranged Action published — none of them observable without the sink.
    for (const id of ["SUB-2", "SUB-10", "SUB-11", "SUB-13", "EVT-15"]) {
      expect(verdict(id), id).toBe("passes");
    }
  }, 30_000);

  it("refuses an arrangement with a key it does not know, rather than ignoring it", async () => {
    const arrangement = await arrangementAt({ ...PUBLISHING, safeActon: { name: "x", input: {} } });
    const { code, stderr } = await run([worker.url, "--arrangement", arrangement]);
    // Exit 2: nothing was judged. A key ignored would have reported its rules `notExercised`, which
    // reads as *nobody arranged that* to somebody who believes they did.
    expect(code).toBe(2);
    expect(stderr).toContain("safeActon");
  });

  it("refuses a sink in the file, and a sink nothing publishes to", async () => {
    const withSink = await arrangementAt({ ...PUBLISHING, sink: { url: "https://x.invalid" } });
    const inFile = await run([worker.url, "--arrangement", withSink]);
    expect(inFile.code).toBe(2);
    expect(inFile.stderr).toContain("--sink-port");

    const silent = await run([worker.url, "--sink-port", String(port)]);
    expect(silent.code).toBe(2);
    expect(silent.stderr).toContain("publishingAction");
  });
});

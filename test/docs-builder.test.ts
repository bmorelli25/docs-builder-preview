import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureDocsBuilder, type DocsBuilderHandle } from "../src/docs-builder.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((action) => action()));
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

describe("ensureDocsBuilder", () => {
  it("reuses a ready localhost server and never owns it", async () => {
    const server = createServer((_request, response) => response.end("ready"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");

    const handle = await ensureDocsBuilder({
      repositoryPath: process.cwd(),
      port: address.port,
      command: "/does/not/exist",
    });

    expect(handle.owned).toBe(false);
    expect(handle.url).toBe(`http://127.0.0.1:${address.port}`);
    await handle.stop();
    expect(server.listening).toBe(true);
  });

  it("starts with an argument array, waits for readiness, and stops its child", async () => {
    const directory = await mkdtemp(join(tmpdir(), "docs-builder-command-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const executable = join(directory, "fake builder ;$().cjs");
    const argsFile = join(directory, "args.json");
    const repositoryPath = join(directory, "repo ; touch nope");
    await mkdir(repositoryPath);
    const script = `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
fs.writeFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)));
const index = process.argv.indexOf("--port");
const port = Number(process.argv[index + 1]);
http.createServer((req, res) => {
  if (req.url === "/ready") res.end("ready");
  else res.end("<html><body>docs</body></html>");
}).listen(port, "127.0.0.1");
`;
    await writeFile(executable, script);
    const port = await availablePort();

    const handle: DocsBuilderHandle = await ensureDocsBuilder({
      repositoryPath,
      port,
      command: process.execPath,
      args: [executable, "serve", "--repository", repositoryPath],
      readinessPath: "/ready",
      timeoutMs: 4_000,
      env: { ARGS_FILE: argsFile },
    });
    cleanup.push(handle.stop);

    expect(handle.owned).toBe(true);
    expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual([
      "serve",
      "--repository",
      repositoryPath,
      "--port",
      String(port),
    ]);
    expect(await (await fetch(`${handle.url}/ready`)).text()).toBe("ready");

    await handle.stop();
    await expect(fetch(`${handle.url}/ready`)).rejects.toThrow();
  });

  it("fails cleanly when a child exits before becoming ready", async () => {
    const directory = await mkdtemp(join(tmpdir(), "docs-builder-exit-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const executable = join(directory, "exit-now");
    await writeFile(executable, "#!/usr/bin/env node\nprocess.exit(7)\n");
    await chmod(executable, 0o755);

    await expect(
      ensureDocsBuilder({
        repositoryPath: process.cwd(),
        port: await availablePort(),
        command: executable,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/exited.*7/i);
  });
});

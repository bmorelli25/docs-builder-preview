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
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<html><script src=\"/__livereloadscript\"></script></html>");
    });
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

  it("rejects an explicit existing server without the docs-builder marker", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<html><body>unrelated service</body></html>");
    });
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

    await expect(
      ensureDocsBuilder({
        repositoryPath: process.cwd(),
        port: address.port,
        existingOnly: true,
      }),
    ).rejects.toThrow(/not a compatible docs-builder/i);
  });

  it("does not reuse an arbitrary server returning a 404", async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 404;
      response.end("not docs-builder");
    });
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

    await expect(
      ensureDocsBuilder({
        repositoryPath: process.cwd(),
        port: address.port,
        command: "/does/not/exist",
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/failed to start/i);
  });

  it("launches on a free port when the default port is occupied by an incompatible service", async () => {
    const occupied = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end("<html>other app</html>");
    });
    await new Promise<void>((resolve) =>
      occupied.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          occupied.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const directory = await mkdtemp(join(tmpdir(), "docs-builder-fallback-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const script = join(directory, "builder.cjs");
    await writeFile(
      script,
      `const http = require("node:http");
const index = process.argv.indexOf("--port");
const port = Number(process.argv[index + 1]);
http.createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end("<script src='/__livereloadscript'></script>");
}).listen(port, "127.0.0.1");`,
    );

    const handle = await ensureDocsBuilder({
      repositoryPath: process.cwd(),
      port: address.port,
      command: process.execPath,
      args: [script],
      timeoutMs: 4_000,
    });
    cleanup.push(handle.stop);

    expect(handle.owned).toBe(true);
    expect(handle.port).not.toBe(address.port);
    expect(occupied.listening).toBe(true);
  });

  it("fails instead of launching when an existing server is required", async () => {
    await expect(
      ensureDocsBuilder({
        repositoryPath: process.cwd(),
        port: await availablePort(),
        command: "/does/not/exist",
        existingOnly: true,
      }),
    ).rejects.toThrow(/not a compatible docs-builder/i);
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
process.stdout.write("building docs\\n");
process.stderr.write("warning from builder\\n");
const index = process.argv.indexOf("--port");
const port = Number(process.argv[index + 1]);
http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url === "/ready") res.end("<html><script src='/__livereloadscript'></script></html>");
  else res.end("<html><body>docs<script src='/__livereloadscript'></script></body></html>");
}).listen(port, "127.0.0.1");
`;
    await writeFile(executable, script);
    const port = await availablePort();

    const logs: string[] = [];
    const handle: DocsBuilderHandle = await ensureDocsBuilder({
      repositoryPath,
      port,
      command: process.execPath,
      args: [executable, "serve", "--repository", repositoryPath],
      readinessPath: "/ready",
      timeoutMs: 4_000,
      env: { ARGS_FILE: argsFile },
      onLog: (stream, text) => logs.push(`${stream}:${text}`),
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
    expect(await (await fetch(`${handle.url}/ready`)).text()).toContain(
      "__livereloadscript",
    );
    expect(logs.join("")).toContain("stdout:building docs");
    expect(logs.join("")).toContain("stderr:warning from builder");

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

  it("reports a child signal exit before the readiness timeout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "docs-builder-signal-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const script = join(directory, "signal.cjs");
    await writeFile(
      script,
      'process.kill(process.pid, "SIGTERM");\n',
    );

    await expect(
      ensureDocsBuilder({
        repositoryPath: process.cwd(),
        port: await availablePort(),
        command: process.execPath,
        args: [script],
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/signal SIGTERM/i);
  });

  it("stops an owned child when startup is aborted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "docs-builder-abort-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const script = join(directory, "wait.cjs");
    const stoppedFile = join(directory, "stopped");
    await writeFile(
      script,
      `const fs = require("node:fs");
process.on("SIGTERM", () => {
  fs.writeFileSync(process.env.STOPPED_FILE, "stopped");
  process.exit(0);
});
process.stdout.write("started\\n");
setInterval(() => {}, 1000);`,
    );
    const controller = new AbortController();

    await expect(
      ensureDocsBuilder({
        repositoryPath: process.cwd(),
        port: await availablePort(),
        command: process.execPath,
        args: [script],
        timeoutMs: 4_000,
        env: { STOPPED_FILE: stoppedFile },
        signal: controller.signal,
        onLog: (_stream, text) => {
          if (text.includes("started")) controller.abort();
        },
      }),
    ).rejects.toThrow(/aborted/i);

    expect(await readFile(stoppedFile, "utf8")).toBe("stopped");
  });
});

import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCleanupCoordinator,
  runCli,
  watchRepository,
  type CliRuntime,
  type RecursiveWatchFactory,
} from "../src/cli.js";
import {
  ensureDocsBuilder,
  type DocsBuilderHandle,
  type DocsBuilderOptions,
} from "../src/docs-builder.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const runtimes: CliRuntime[] = [];
const servers: Server[] = [];

class FakeRecursiveWatcher extends EventEmitter {
  closeCalls = 0;

  close() {
    this.closeCalls++;
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function git(repositoryPath: string, ...args: string[]) {
  await execFileAsync("git", args, { cwd: repositoryPath });
}

async function write(repositoryPath: string, path: string, contents: string) {
  const fullPath = join(repositoryPath, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
}

async function createFixtureRepository(): Promise<string> {
  const temporaryRoot = join(process.cwd(), ".test-tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const repositoryPath = await mkdtemp(join(temporaryRoot, "preview-cli-"));
  temporaryDirectories.push(repositoryPath);
  await git(repositoryPath, "init", "-b", "main");
  await git(repositoryPath, "config", "user.name", "CLI Test");
  await git(repositoryPath, "config", "user.email", "cli@example.test");
  await write(repositoryPath, "docs/_snippets/shared.md", "Original text.\n");
  await write(
    repositoryPath,
    "docs/page.md",
    "```{include} _snippets/shared.md\n```\n",
  );
  await git(repositoryPath, "add", ".");
  await git(repositoryPath, "commit", "-m", "fixture");
  await git(repositoryPath, "switch", "-c", "feature");
  await write(repositoryPath, "docs/_snippets/shared.md", "First change.\n");
  return repositoryPath;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  servers.push(server);
  return address.port;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  servers.pop();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
): Promise<string> {
  let received = "";
  const deadline = Date.now() + 5_000;
  while (!received.includes(expected) && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out waiting for ${expected}`)), 5_000),
      ),
    ]);
    if (chunk.done) break;
    received += new TextDecoder().decode(chunk.value);
  }
  return received;
}

describe("runCli", () => {
  it("serves the dashboard before waiting for docs-builder", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end("<script src='/__livereloadscript'></script>");
      }),
    );
    const port = await unusedPort();
    let dashboardStatusDuringBuilder: number | undefined;
    const signalListeners = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };
    let receivedSignal: AbortSignal | undefined;
    const ensure = async (
      options: DocsBuilderOptions,
    ): Promise<DocsBuilderHandle> => {
      receivedSignal = options.signal;
      expect(process.listenerCount("SIGINT")).toBe(
        signalListeners.SIGINT + 1,
      );
      expect(process.listenerCount("SIGTERM")).toBe(
        signalListeners.SIGTERM + 1,
      );
      dashboardStatusDuringBuilder = (
        await fetch(`http://127.0.0.1:${port}`)
      ).status;
      return {
        url: `http://127.0.0.1:${docsPort}`,
        port: docsPort,
        owned: false,
        stop: async () => {},
      };
    };

    const runtime = await runCli(
      {
        repositoryPath,
        base: "main",
        docsPort,
        port,
        fetch: false,
        open: false,
      },
      { ensureDocsBuilder: ensure },
    );
    runtimes.push(runtime);

    expect(dashboardStatusDuringBuilder).toBe(200);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
    expect(await fetch(runtime.url).then((response) => response.text())).toContain(
      "docs-builder ready",
    );
    await runtime.stop();
    runtimes.pop();
    expect(receivedSignal?.aborted).toBe(true);
    expect(process.listenerCount("SIGINT")).toBe(signalListeners.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(signalListeners.SIGTERM);
  });

  it("keeps watching and serves failure logs when docs-builder startup fails", async () => {
    const repositoryPath = await createFixtureRepository();
    const port = await unusedPort();
    const ensure = async (options: DocsBuilderOptions) => {
      options.onLog?.("stdout", "Preparing content\n");
      options.onLog?.("stderr", "Build exploded\n");
      throw new Error("docs-builder exited with code 2");
    };

    const runtime = await runCli(
      {
        repositoryPath,
        base: "main",
        port,
        fetch: false,
        open: false,
      },
      { ensureDocsBuilder: ensure },
    );
    runtimes.push(runtime);

    const dashboard = await fetch(runtime.url).then((response) => response.text());
    expect(dashboard).toContain("Failed");
    expect(dashboard).toContain("docs-builder exited with code 2");
    expect(dashboard).toContain("Build exploded");
    const preview = await fetch(`${runtime.url}/docs/page`);
    expect(preview.status).toBe(503);
    expect(await preview.text()).toContain("Build exploded");

    const events = await fetch(`${runtime.url}/api/events`);
    const reader = events.body!.getReader();
    await readUntil(reader, "event: connected");
    await write(
      repositoryPath,
      "docs/page.md",
      "```{include} _snippets/shared.md\n```\n\nStill watching.\n",
    );
    await readUntil(reader, "event: refresh");
    await reader.cancel();
    const refreshed = await fetch(`${runtime.url}/api/review`).then(
      (response) => response.json(),
    );
    expect(
      refreshed.files.find(
        (file: { path: string }) => file.path === "docs/page.md",
      ).blocks.at(-1).source,
    ).toContain("Still watching.");
  });

  it("stops an owned docs-builder exactly once through CLI cleanup", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end("<script src='/__livereloadscript'></script>");
      }),
    );
    let stops = 0;
    const ensure = async (): Promise<DocsBuilderHandle> => ({
      url: `http://127.0.0.1:${docsPort}`,
      port: docsPort,
      owned: true,
      stop: async () => {
        stops++;
      },
    });

    const runtime = await runCli(
      {
        repositoryPath,
        base: "main",
        port: await unusedPort(),
        fetch: false,
        open: false,
      },
      { ensureDocsBuilder: ensure },
    );

    await runtime.stop();
    await runtime.stop();
    expect(stops).toBe(1);
  });

  it("marks an unexpected owned docs-builder exit failed and disables proxying", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => {
        response.statusCode = 502;
        response.end("stale upstream");
      }),
    );
    let resolveExit:
      | ((result: {
          code: number | null;
          signal: NodeJS.Signals | null;
          intentional: boolean;
        }) => void)
      | undefined;
    const exit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      intentional: boolean;
    }>((resolve) => {
      resolveExit = resolve;
    });
    let stops = 0;
    const ensure = async (
      options: DocsBuilderOptions,
    ): Promise<DocsBuilderHandle> => {
      options.onLog?.("stderr", "last builder output\n");
      return {
        url: `http://127.0.0.1:${docsPort}`,
        port: docsPort,
        owned: true,
        exit,
        stop: async () => {
          stops++;
        },
      };
    };
    const runtime = await runCli(
      {
        repositoryPath,
        base: "main",
        port: await unusedPort(),
        fetch: false,
        open: false,
      },
      { ensureDocsBuilder: ensure },
    );
    runtimes.push(runtime);
    const events = await fetch(`${runtime.url}/api/events`);
    const reader = events.body!.getReader();
    await readUntil(reader, "event: connected");

    resolveExit!({ code: 9, signal: null, intentional: false });
    await readUntil(reader, "event: refresh");
    await reader.cancel();

    const status = await fetch(`${runtime.url}/api/docs-builder`).then(
      (response) => response.json(),
    );
    expect(status).toMatchObject({
      state: "failed",
      error: "docs-builder exited unexpectedly with code 9",
    });
    expect(status.logs).toContain("stderr: last builder output");
    const preview = await fetch(`${runtime.url}/docs/page`);
    expect(preview.status).toBe(503);
    expect(await preview.text()).not.toContain("stale upstream");
    expect((await fetch(runtime.url)).status).toBe(200);

    await runtime.stop();
    runtimes.pop();
    expect(stops).toBe(1);
  });

  it("reports an unexpected owned docs-builder signal exit", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => response.end("builder")),
    );
    let resolveExit:
      | ((result: {
          code: number | null;
          signal: NodeJS.Signals | null;
          intentional: boolean;
        }) => void)
      | undefined;
    const exit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      intentional: boolean;
    }>((resolve) => {
      resolveExit = resolve;
    });
    const runtime = await runCli(
      {
        repositoryPath,
        base: "main",
        port: await unusedPort(),
        fetch: false,
        open: false,
      },
      {
        ensureDocsBuilder: async () => ({
          url: `http://127.0.0.1:${docsPort}`,
          port: docsPort,
          owned: true,
          exit,
          stop: async () => {},
        }),
      },
    );
    runtimes.push(runtime);
    const events = await fetch(`${runtime.url}/api/events`);
    const reader = events.body!.getReader();
    await readUntil(reader, "event: connected");

    resolveExit!({ code: null, signal: "SIGKILL", intentional: false });
    await readUntil(reader, "event: refresh");
    await reader.cancel();

    const status = await fetch(`${runtime.url}/api/docs-builder`).then(
      (response) => response.json(),
    );
    expect(status.error).toBe(
      "docs-builder exited unexpectedly with signal SIGKILL",
    );
  });

  it("includes final drained stderr in the first failed builder status", async () => {
    const repositoryPath = await createFixtureRepository();
    const script = join(repositoryPath, "runtime-builder.cjs");
    await writeFile(
      script,
      `const http = require("node:http");
const { spawn } = require("node:child_process");
const index = process.argv.indexOf("--port");
const port = Number(process.argv[index + 1]);
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url === "/exit") {
    res.end("exiting");
    server.close(() => {
      spawn(
        process.execPath,
        ["-e", "setTimeout(() => { process.stderr.write('final stderr before close\\\\n'); }, 100)"],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
      process.exit(13);
    });
    return;
  }
  res.end("<script src='/__livereloadscript'></script>");
});
server.listen(port, "127.0.0.1");`,
    );
    const builderPort = await unusedPort();
    const runtime = await runCli(
      {
        repositoryPath,
        base: "main",
        port: await unusedPort(),
        fetch: false,
        open: false,
      },
      {
        ensureDocsBuilder: (options) =>
          ensureDocsBuilder({
            ...options,
            port: builderPort,
            existingOnly: false,
            command: process.execPath,
            args: [script],
            timeoutMs: 4_000,
          }),
      },
    );
    runtimes.push(runtime);
    const events = await fetch(`${runtime.url}/api/events`);
    const reader = events.body!.getReader();
    await readUntil(reader, "event: connected");

    await fetch(`http://127.0.0.1:${builderPort}/exit`);
    await readUntil(reader, "event: refresh");
    await reader.cancel();

    const status = await fetch(`${runtime.url}/api/docs-builder`).then(
      (response) => response.json(),
    );
    expect(status.error).toBe(
      "docs-builder exited unexpectedly with code 13",
    );
    expect(status.logs).toContain("stderr: final stderr before close");
  });

  it("serves a fixture review, attaches snippet consumers, and refreshes after edits", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end(
          "<html><body>fixture docs<script src='/__livereloadscript'></script></body></html>",
        );
      }),
    );
    const port = await unusedPort();
    const signalListeners = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };

    const runtime = await runCli({
      repositoryPath,
      base: "main",
      docsPort,
      port,
      fetch: false,
      open: false,
    });
    runtimes.push(runtime);

    const dashboard = await fetch(runtime.url);
    expect(dashboard.status).toBe(200);
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain("docs/_snippets/shared.md");
    expect(dashboardHtml).toContain(
      'href="/docs/page?review-source=docs%2F_snippets%2Fshared.md"',
    );
    expect(dashboardHtml).toContain(
      'data-source-file="docs/_snippets/shared.md"',
    );
    expect(dashboardHtml).toContain("First change.");
    const consumerPreview = await fetch(
      `${runtime.url}/docs/page?review-source=docs%2F_snippets%2Fshared.md`,
    ).then((response) => response.text());
    expect(consumerPreview).toContain("fixture docs");

    const initialReview = await fetch(`${runtime.url}/api/review`).then(
      (response) => response.json(),
    );
    expect(initialReview.files).toContainEqual(
      expect.objectContaining({
        path: "docs/_snippets/shared.md",
        consumers: ["docs/page.md"],
        blocks: [
          expect.objectContaining({
            source: "First change.",
          }),
        ],
      }),
    );

    const events = await fetch(`${runtime.url}/api/events`);
    const reader = events.body!.getReader();
    await readUntil(reader, "event: connected");
    await write(
      repositoryPath,
      "docs/page.md",
      "```{include} _snippets/shared.md\n```\n\nSecond live change.\n",
    );
    expect(await readUntil(reader, "event: refresh")).toContain(
      "event: refresh",
    );

    const refreshedReview = await fetch(`${runtime.url}/api/review`).then(
      (response) => response.json(),
    );
    expect(
      refreshedReview.files.find(
        (file: { path: string }) => file.path === "docs/page.md",
      ).blocks.at(-1).source,
    ).toContain("Second live change.");

    await reader.cancel();
    await runtime.stop();
    runtimes.pop();
    expect(process.listenerCount("SIGINT")).toBe(signalListeners.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(signalListeners.SIGTERM);

    expect(await fetch(`http://127.0.0.1:${docsPort}`)).toHaveProperty(
      "status",
      200,
    );
  });

  it("keeps the dashboard available when explicit --docs-port is incompatible", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await unusedPort();
    const port = await unusedPort();
    const signalListeners = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };

    const runtime = await runCli({
        repositoryPath,
        base: "main",
        docsPort,
        port,
        fetch: false,
        open: false,
      });
    runtimes.push(runtime);

    const dashboard = await fetch(runtime.url).then((response) => response.text());
    expect(dashboard).toContain("Failed");
    expect(dashboard).toContain("compatible docs-builder");
    const preview = await fetch(`${runtime.url}/docs/page`);
    expect(preview.status).toBe(503);

    await runtime.stop();
    runtimes.pop();
    expect(process.listenerCount("SIGINT")).toBe(signalListeners.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(signalListeners.SIGTERM);
  });

  it("rejects watcher startup errors and cleans up the review server", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end("<script src='/__livereloadscript'></script>");
      }),
    );
    const port = await unusedPort();
    const nativeWatcher = new FakeRecursiveWatcher();
    const watchFactory: RecursiveWatchFactory = () => {
      queueMicrotask(() =>
        nativeWatcher.emit(
          "error",
          Object.assign(new Error("too many open files"), { code: "EMFILE" }),
        ),
      );
      return nativeWatcher;
    };
    const signalListeners = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };

    await expect(
      runCli(
        {
          repositoryPath,
          base: "main",
          docsPort,
          port,
          fetch: false,
          open: false,
        },
        { watchFactory },
      ),
    ).rejects.toThrow(/too many open files/);

    expect(nativeWatcher.closeCalls).toBe(1);
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
    expect(process.listenerCount("SIGINT")).toBe(signalListeners.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(signalListeners.SIGTERM);
    expect(await fetch(`http://127.0.0.1:${docsPort}`)).toHaveProperty(
      "status",
      200,
    );
  });

  it("treats runtime watcher errors as fatal and cleans up runtime resources", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end("<script src='/__livereloadscript'></script>");
      }),
    );
    const port = await unusedPort();
    const nativeWatcher = new FakeRecursiveWatcher();
    const watchFactory: RecursiveWatchFactory = () => nativeWatcher;
    const exitCodes: number[] = [];
    const fatalErrors: unknown[] = [];
    let resolveFatal: (() => void) | undefined;
    const fatalHandled = new Promise<void>((resolve) => {
      resolveFatal = resolve;
    });
    const signalListeners = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await runCli(
      {
        repositoryPath,
        base: "main",
        docsPort,
        port,
        fetch: false,
        open: false,
      },
      {
        watchFactory,
        setExitCode: (code) => exitCodes.push(code),
        onFatal: (error) => {
          fatalErrors.push(error);
          resolveFatal!();
        },
      },
    );

    nativeWatcher.emit("error", new Error("native watch failed"));
    await Promise.race([
      fatalHandled,
      delay(1_000).then(() => {
        throw new Error("fatal watcher handling timed out");
      }),
    ]);

    expect(fatalErrors).toEqual([
      expect.objectContaining({ message: "native watch failed" }),
    ]);
    expect(stderr).toHaveBeenCalledWith(
      "File watcher error: native watch failed\n",
    );
    expect(exitCodes).toEqual([1]);
    expect(nativeWatcher.closeCalls).toBe(1);
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
    expect(process.listenerCount("SIGINT")).toBe(signalListeners.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(signalListeners.SIGTERM);
    expect(await fetch(`http://127.0.0.1:${docsPort}`)).toHaveProperty(
      "status",
      200,
    );
  });
});

describe("watchRepository", () => {
  it("uses one recursive watcher, filters ignored trees, debounces, and serializes rebuilds", async () => {
    const nativeWatcher = new FakeRecursiveWatcher();
    let listener:
      | ((eventType: string, filename: string | Buffer | null) => void)
      | undefined;
    const calls: Array<{ path: string; recursive: boolean }> = [];
    const watchFactory: RecursiveWatchFactory = (path, options, onChange) => {
      calls.push({ path, recursive: options.recursive });
      listener = onChange;
      return nativeWatcher;
    };
    let rebuilds = 0;
    let active = 0;
    let maxActive = 0;
    let releaseFirst: (() => void) | undefined;
    const firstRebuild = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const warnings: string[] = [];
    const fatalErrors: Error[] = [];
    const watcher = await watchRepository(
      "/large/repository",
      async () => {
        rebuilds++;
        active++;
        maxActive = Math.max(maxActive, active);
        if (rebuilds === 1) await firstRebuild;
        active--;
      },
      (warning) => warnings.push(warning),
      watchFactory,
      async (error) => {
        fatalErrors.push(error);
        throw new Error("fatal callback failed");
      },
    );

    expect(calls).toEqual([
      { path: "/large/repository", recursive: true },
    ]);
    listener!("change", ".git/index");
    listener!("rename", "packages/node_modules/pkg/index.js");
    await delay(100);
    expect(rebuilds).toBe(0);

    listener!("change", "docs/one.md");
    listener!("change", "docs/two.md");
    listener!("rename", "docs/three.md");
    await delay(150);
    expect(rebuilds).toBe(1);

    listener!("change", "docs/four.md");
    listener!("change", "docs/five.md");
    await delay(150);
    expect(rebuilds).toBe(1);
    releaseFirst!();
    await delay(20);
    expect(rebuilds).toBe(2);
    expect(maxActive).toBe(1);
    nativeWatcher.emit("error", new Error("watch stream failed"));
    await delay(0);
    expect(warnings).toEqual([
      "File watcher error: watch stream failed",
      "Fatal watcher cleanup failed: fatal callback failed",
    ]);
    expect(fatalErrors).toEqual([
      expect.objectContaining({ message: "watch stream failed" }),
    ]);

    await watcher.close();
    expect(nativeWatcher.closeCalls).toBe(1);
  });
});

describe("cleanup coordination", () => {
  it("attempts every cleanup and retries only failed resources", async () => {
    const attempts = { watcher: 0, server: 0, docsBuilder: 0 };
    const cleanup = createCleanupCoordinator();
    cleanup.register("watcher", async () => {
      attempts.watcher++;
      if (attempts.watcher === 1) throw new Error("watcher close failed");
    });
    cleanup.register("server", async () => {
      attempts.server++;
      if (attempts.server === 1) throw new Error("server close failed");
    });
    cleanup.register("docs-builder", async () => {
      attempts.docsBuilder++;
    });

    await expect(cleanup.stop()).rejects.toThrow(/watcher.*server/i);
    expect(attempts).toEqual({ watcher: 1, server: 1, docsBuilder: 1 });

    await cleanup.stop();
    expect(attempts).toEqual({ watcher: 2, server: 2, docsBuilder: 1 });

    await cleanup.stop();
    expect(attempts).toEqual({ watcher: 2, server: 2, docsBuilder: 1 });
  });
});

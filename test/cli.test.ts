import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCleanupCoordinator,
  runCli,
  watchRepository,
  type CliRuntime,
  type RecursiveWatchFactory,
} from "../src/cli.js";

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
  it("serves a fixture review, attaches snippet consumers, and refreshes after edits", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end("<html><body>fixture docs</body></html>");
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
    const consumerPreview = await fetch(
      `${runtime.url}/docs/page?review-source=docs%2F_snippets%2Fshared.md`,
    ).then((response) => response.text());
    expect(consumerPreview).toContain("First change.");

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

  it("requires --docs-port to identify a healthy existing server", async () => {
    const repositoryPath = await createFixtureRepository();
    const signalListeners = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };

    await expect(
      runCli({
        repositoryPath,
        base: "main",
        docsPort: await unusedPort(),
        port: await unusedPort(),
        fetch: false,
        open: false,
      }),
    ).rejects.toThrow(/no healthy docs-builder server.*listening/i);

    expect(process.listenerCount("SIGINT")).toBe(signalListeners.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(signalListeners.SIGTERM);
  });

  it("rejects watcher startup errors and cleans up the review server", async () => {
    const repositoryPath = await createFixtureRepository();
    const docsPort = await listen(
      createServer((_request, response) => response.end("ready")),
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
    expect(warnings).toEqual(["File watcher error: watch stream failed"]);

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

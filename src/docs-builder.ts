import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface DocsBuilderOptions {
  repositoryPath: string;
  port: number;
  command?: string;
  args?: string[];
  readinessPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  existingOnly?: boolean;
  signal?: AbortSignal;
  onLog?: (stream: "stdout" | "stderr", text: string) => void;
}

export interface DocsBuilderHandle {
  url: string;
  port: number;
  owned: boolean;
  exit?: Promise<DocsBuilderExit>;
  stop(): Promise<void>;
}

export interface DocsBuilderExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  intentional: boolean;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(300),
      redirect: "manual",
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !contentType.includes("text/html")
    ) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body?.getReader();
    if (!reader) return false;
    let body = "";
    while (body.length < 64 * 1024) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += new TextDecoder().decode(chunk.value);
      if (body.includes("__livereloadscript")) {
        await reader.cancel();
        return true;
      }
    }
    await reader.cancel();
    return false;
  } catch {
    return false;
  }
}

async function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a docs-builder port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", (code) => resolve(code));
  });
}

export async function ensureDocsBuilder(
  options: DocsBuilderOptions,
): Promise<DocsBuilderHandle> {
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  ) {
    throw new Error(`Invalid docs-builder port: ${options.port}`);
  }
  if (options.signal?.aborted) {
    throw new Error("docs-builder startup aborted");
  }

  const requestedUrl = `http://127.0.0.1:${options.port}`;
  const requestedReadyUrl = new URL(
    options.readinessPath ?? "/",
    requestedUrl,
  ).href;
  if (await isReady(requestedReadyUrl)) {
    return {
      url: requestedUrl,
      port: options.port,
      owned: false,
      stop: async () => {},
    };
  }
  if (options.existingOnly) {
    throw new Error(
      `The service at ${requestedReadyUrl} is not a compatible docs-builder server`,
    );
  }

  const port = (await canListen(options.port))
    ? options.port
    : await freePort();
  const url = `http://127.0.0.1:${port}`;
  const readyUrl = new URL(options.readinessPath ?? "/", url).href;
  const args = [...(options.args ?? ["serve"])];
  const portIndex = args.indexOf("--port");
  if (portIndex === -1) args.push("--port", String(port));
  else args[portIndex + 1] = String(port);
  const child = spawn(options.command ?? "docs-builder", args, {
    cwd: options.repositoryPath,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    options.onLog?.("stdout", chunk.toString("utf8"));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    options.onLog?.("stderr", chunk.toString("utf8"));
  });
  let intentionalStop = false;
  const exit = new Promise<DocsBuilderExit>((resolve) => {
    child.once("close", (code, signal) => {
      resolve({ code, signal, intentional: intentionalStop });
    });
  });
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });

  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      intentionalStop = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const exited = await Promise.race([
        waitForExit(child).then(() => true),
        delay(1_000).then(() => false),
      ]);
      if (!exited && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child);
      }
    })();
    return stopPromise;
  };
  const abort = () => void stop();
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        await stop();
        throw new Error("docs-builder startup aborted");
      }
      if (spawnError) {
        await stop();
        throw new Error(
          `Failed to start docs-builder: ${spawnError.message}`,
          { cause: spawnError },
        );
      }
      if (child.exitCode !== null) {
        throw new Error(
          `docs-builder exited with code ${child.exitCode} before becoming ready`,
        );
      }
      if (child.signalCode !== null) {
        throw new Error(
          `docs-builder exited with signal ${child.signalCode} before becoming ready`,
        );
      }
      if (await isReady(readyUrl)) {
        if (options.signal?.aborted) {
          await stop();
          throw new Error("docs-builder startup aborted");
        }
        return { url, port, owned: true, exit, stop };
      }
      await delay(50);
    }

    await stop();
    throw new Error(
      `docs-builder did not become ready at ${readyUrl} within ${options.timeoutMs ?? 15_000}ms`,
    );
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

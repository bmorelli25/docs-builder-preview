import { spawn, type ChildProcess } from "node:child_process";

export interface DocsBuilderOptions {
  repositoryPath: string;
  port: number;
  command?: string;
  args?: string[];
  readinessPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface DocsBuilderHandle {
  url: string;
  port: number;
  owned: boolean;
  stop(): Promise<void>;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(300),
      redirect: "manual",
    });
    await response.body?.cancel();
    return response.status < 500;
  } catch {
    return false;
  }
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

  const url = `http://127.0.0.1:${options.port}`;
  const readyUrl = new URL(options.readinessPath ?? "/", url).href;
  if (await isReady(readyUrl)) {
    return {
      url,
      port: options.port,
      owned: false,
      stop: async () => {},
    };
  }

  const args = [...(options.args ?? ["serve"])];
  if (!args.includes("--port")) args.push("--port", String(options.port));
  const child = spawn(options.command ?? "docs-builder", args, {
    cwd: options.repositoryPath,
    env: { ...process.env, ...options.env },
    stdio: "ignore",
    shell: false,
  });
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
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
  };

  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
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
    if (await isReady(readyUrl)) {
      return { url, port: options.port, owned: true, stop };
    }
    await delay(50);
  }

  await stop();
  throw new Error(
    `docs-builder did not become ready at ${readyUrl} within ${options.timeoutMs ?? 15_000}ms`,
  );
}

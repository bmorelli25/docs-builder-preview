#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  watch as fsWatch,
  type FSWatcher,
  type WatchEventType,
} from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDocsBuilder } from "./docs-builder.js";
import { buildReview } from "./git.js";
import type { ReviewModel } from "./model.js";
import { type CliOptions, parseOptions } from "./options.js";
import { startReviewServer, type RunningServer } from "./server.js";
import { findSnippetConsumers } from "./snippets.js";

export interface CliRuntime {
  url: string;
  stop(): Promise<void>;
}

export interface CliDependencies {
  watchFactory?: RecursiveWatchFactory;
  onFatal?: (error: unknown) => void | Promise<void>;
  setExitCode?: (code: number) => void;
}

interface CleanupCoordinator {
  register(name: string, cleanup: () => Promise<void>): void;
  stop(): Promise<void>;
}

export function createCleanupCoordinator(): CleanupCoordinator {
  const resources = new Map<
    string,
    { cleanup: () => Promise<void>; complete: boolean }
  >();
  let activeStop: Promise<void> | undefined;

  return {
    register: (name, cleanup) => {
      resources.set(name, { cleanup, complete: false });
    },
    stop: () => {
      if (activeStop) return activeStop;
      activeStop = (async () => {
        const attempted = new Set<string>();
        const failures: unknown[] = [];
        const failedNames: string[] = [];
        while (true) {
          const pending = [...resources].filter(
            ([name, resource]) => !resource.complete && !attempted.has(name),
          );
          if (pending.length === 0) break;
          pending.forEach(([name]) => attempted.add(name));
          const results = await Promise.allSettled(
            pending.map(([, resource]) => resource.cleanup()),
          );
          results.forEach((result, index) => {
            const [name, resource] = pending[index];
            if (result.status === "fulfilled") {
              resource.complete = true;
            } else {
              failures.push(result.reason);
              failedNames.push(name);
            }
          });
        }
        if (failures.length > 0) {
          throw new AggregateError(
            failures,
            `Failed to clean up ${failedNames.join(", ")}`,
          );
        }
      })().finally(() => {
        activeStop = undefined;
      });
      return activeStop;
    },
  };
}

async function buildReviewWithConsumers(
  options: CliOptions,
): Promise<ReviewModel> {
  const review = await buildReview(
    options.repositoryPath,
    options.base,
    options.fetch,
  );
  const consumers = await findSnippetConsumers(
    review.repositoryPath,
    review.files.map(({ path }) => path),
  );
  return {
    ...review,
    files: review.files.map((file) => ({
      ...file,
      consumers: consumers.get(file.path) ?? [],
    })),
  };
}

function openBrowser(url: string, warn: (message: string) => void): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.once("error", (error) => {
    warn(`Could not open the browser: ${error.message}`);
  });
  child.unref();
}

interface RepositoryWatcher {
  close(): Promise<void>;
}

export type RecursiveWatchFactory = (
  path: string,
  options: { recursive: true },
  listener: (
    eventType: WatchEventType | string,
    filename: string | Buffer | null,
  ) => void,
) => Pick<FSWatcher, "on" | "close">;

const defaultWatchFactory: RecursiveWatchFactory = (
  path,
  options,
  listener,
) => fsWatch(path, options, listener);

function ignoredWatchPath(filename: string | Buffer | null): boolean {
  if (filename === null) return false;
  return filename
    .toString()
    .split(/[\\/]+/)
    .some((segment) => segment === ".git" || segment === "node_modules");
}

export async function watchRepository(
  repositoryPath: string,
  rebuild: () => Promise<void>,
  warn: (message: string) => void,
  watchFactory: RecursiveWatchFactory | undefined,
  onFatal: (error: Error) => void | Promise<void>,
): Promise<RepositoryWatcher> {
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  let fatalTriggered = false;
  let rebuildQueue = Promise.resolve();

  const enqueueRebuild = () => {
    rebuildQueue = rebuildQueue.then(async () => {
      if (closed) return;
      try {
        await rebuild();
      } catch (error) {
        warn(
          `Could not refresh review data: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  };

  const watcher = (watchFactory ?? defaultWatchFactory)(
    repositoryPath,
    { recursive: true },
    (_eventType, filename) => {
      if (ignoredWatchPath(filename)) return;
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(enqueueRebuild, 75);
    },
  );
  let starting = true;
  let startupError: Error | undefined;
  watcher.on("error", (error) => {
    if (starting) {
      startupError = error;
      return;
    }
    if (closed) return;
    warn(
      `File watcher error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    if (fatalTriggered) return;
    fatalTriggered = true;
    void Promise.resolve()
      .then(() => onFatal(error))
      .catch((fatalError) => {
        warn(
          `Fatal watcher cleanup failed: ${
            fatalError instanceof Error ? fatalError.message : String(fatalError)
          }`,
        );
      });
  });
  await new Promise<void>((resolveReady) => setImmediate(resolveReady));
  starting = false;
  if (startupError) {
    closed = true;
    try {
      watcher.close();
    } catch (closeError) {
      throw new AggregateError(
        [startupError, closeError],
        `File watcher startup failed: ${startupError.message}`,
      );
    }
    throw startupError;
  }
  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      const results = await Promise.allSettled([
        Promise.resolve().then(() => watcher.close()),
        rebuildQueue,
      ]);
      const failures = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, "Failed to close file watcher");
      }
    },
  };
}

export async function runCli(
  options: CliOptions,
  dependencies: CliDependencies = {},
): Promise<CliRuntime> {
  const info = (message: string) => process.stdout.write(`${message}\n`);
  const warn = (message: string) => process.stderr.write(`${message}\n`);
  const setExitCode =
    dependencies.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });
  const initialReview = await buildReviewWithConsumers(options);
  const docsBuilder = await ensureDocsBuilder({
    repositoryPath: initialReview.repositoryPath,
    port: options.docsPort ?? 3000,
    existingOnly: options.docsPort !== undefined,
  });
  const cleanup = createCleanupCoordinator();
  if (docsBuilder.owned) {
    cleanup.register("docs-builder", docsBuilder.stop);
  }
  let shutdownRequested = false;
  const stop = async () => {
    shutdownRequested = true;
    try {
      await cleanup.stop();
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  };
  const onSignal = () => {
    void stop().catch((error) => {
      warn(
        `Shutdown failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let server!: RunningServer;
  try {
    server = await startReviewServer({
      review: initialReview,
      port: options.port,
      docsBuilder,
    });
    cleanup.register("server", server.close);
    if (shutdownRequested) {
      await stop();
      throw new Error("Startup interrupted by shutdown signal");
    }
    const watcher = await watchRepository(
      initialReview.repositoryPath,
      async () => {
        const review = await buildReviewWithConsumers({
          ...options,
          repositoryPath: initialReview.repositoryPath,
          fetch: false,
        });
        server.setReview(review);
        server.refresh();
        info("Review data refreshed");
      },
      warn,
      dependencies.watchFactory,
      async (error) => {
        setExitCode(1);
        let fatalError: unknown = error;
        try {
          await stop();
        } catch (cleanupError) {
          fatalError = new AggregateError(
            [error, cleanupError],
            "Runtime watcher failed and cleanup was incomplete",
          );
          warn(
            `Runtime watcher cleanup failed: ${
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            }`,
          );
        }
        await dependencies.onFatal?.(fatalError);
      },
    );
    cleanup.register("watcher", watcher.close);
    if (shutdownRequested) {
      await stop();
      throw new Error("Startup interrupted by shutdown signal");
    }
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "CLI startup failed and cleanup was incomplete",
      );
    }
    throw error;
  }

  info(`Review: ${server.url}`);
  info(
    `${docsBuilder.owned ? "Started" : "Using"} docs-builder at ${docsBuilder.url}`,
  );
  if (options.open) openBrowser(server.url, warn);

  return { url: server.url, stop };
}

async function main(): Promise<void> {
  await runCli(parseOptions(process.argv.slice(2)));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (
  invokedPath === fileURLToPath(import.meta.url) ||
  (invokedPath && basename(invokedPath) === "docs-builder-preview")
) {
  main().catch((error) => {
    process.stderr.write(
      `docs-builder-preview: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  });
}

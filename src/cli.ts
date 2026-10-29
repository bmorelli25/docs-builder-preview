#!/usr/bin/env node

import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import chokidar from "chokidar";

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

async function watchRepository(
  repositoryPath: string,
  rebuild: () => Promise<void>,
  warn: (message: string) => void,
): Promise<RepositoryWatcher> {
  const watcher = chokidar.watch(repositoryPath, {
    ignored: /(^|[/\\])(?:\.git|node_modules)([/\\]|$)/,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 75,
      pollInterval: 10,
    },
  });
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
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

  watcher.on("all", () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(enqueueRebuild, 75);
  });
  watcher.on("error", (error) => {
    warn(
      `File watcher error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  try {
    await new Promise<void>((resolveReady, rejectReady) => {
      watcher.once("ready", resolveReady);
      watcher.once("error", rejectReady);
    });
  } catch (error) {
    await watcher.close();
    throw error;
  }
  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
      await rebuildQueue;
    },
  };
}

export async function runCli(options: CliOptions): Promise<CliRuntime> {
  const info = (message: string) => process.stdout.write(`${message}\n`);
  const warn = (message: string) => process.stderr.write(`${message}\n`);
  const initialReview = await buildReviewWithConsumers(options);
  const docsBuilder = await ensureDocsBuilder({
    repositoryPath: initialReview.repositoryPath,
    port: options.docsPort ?? 3000,
  });
  let server: RunningServer;
  try {
    server = await startReviewServer({
      review: initialReview,
      port: options.port,
      docsBuilder,
    });
  } catch (error) {
    if (docsBuilder.owned) await docsBuilder.stop();
    throw error;
  }

  let watcher: RepositoryWatcher;
  try {
    watcher = await watchRepository(
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
    );
  } catch (error) {
    await server.close();
    throw error;
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await watcher.close();
    await server.close();
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

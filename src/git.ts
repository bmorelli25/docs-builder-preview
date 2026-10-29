import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

import type {
  ChangedBlock,
  ChangedFile,
  DeletedHunk,
  FileStatus,
  ReviewModel,
} from "./model.js";
import { sourcePathToRoute } from "./routes.js";

const execFileAsync = promisify(execFile);

async function run(
  repositoryPath: string,
  executable: string,
  args: string[],
): Promise<string> {
  const result = await execFileAsync(executable, args, {
    cwd: repositoryPath,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.stdout;
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
  return run(repositoryPath, "git", args);
}

async function refExists(repositoryPath: string, ref: string): Promise<boolean> {
  try {
    await git(repositoryPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function pullRequestBase(
  repositoryPath: string,
): Promise<string | undefined> {
  try {
    const branch = (
      await run(repositoryPath, "gh", [
        "pr",
        "view",
        "--json",
        "baseRefName",
        "--jq",
        ".baseRefName",
      ])
    ).trim();
    return branch || undefined;
  } catch {
    // A missing gh executable or a branch without a PR is expected.
  }
  return undefined;
}

async function selectBase(
  repositoryPath: string,
  baseOverride?: string,
  fetch = true,
  warnings: string[] = [],
): Promise<string> {
  if (baseOverride) {
    if (fetch && baseOverride.startsWith("origin/")) {
      await refreshRemoteBranch(
        repositoryPath,
        baseOverride.slice("origin/".length),
        warnings,
      );
    }
    if (!(await refExists(repositoryPath, baseOverride))) {
      throw new Error(`Git base ref does not exist: ${baseOverride}`);
    }
    return baseOverride;
  }

  const prBase = await pullRequestBase(repositoryPath);
  if (prBase) {
    const remoteRef = `origin/${prBase}`;
    if (fetch) {
      await refreshRemoteBranch(repositoryPath, prBase, warnings);
    }
    if (await refExists(repositoryPath, remoteRef)) return remoteRef;
    if (await refExists(repositoryPath, prBase)) return prBase;
    throw new Error(
      fetch
        ? `GitHub PR base could not be resolved after fetch: ${remoteRef}`
        : `GitHub PR base is not available locally and fetch is disabled: ${remoteRef}`,
    );
  }

  for (const candidate of ["origin/main", "main"]) {
    if (await refExists(repositoryPath, candidate)) {
      if (fetch && candidate === "origin/main") {
        await refreshRemoteBranch(repositoryPath, "main", warnings);
      }
      return candidate;
    }
  }

  throw new Error(
    "Could not select a Git base ref (tried pull request base, origin/main, and main)",
  );
}

async function refreshRemoteBranch(
  repositoryPath: string,
  branch: string,
  warnings: string[],
): Promise<void> {
  try {
    await git(repositoryPath, [
      "fetch",
      "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
  } catch {
    warnings.push(
      `Could not refresh origin/${branch}; using a local reference if available`,
    );
  }
}

function statusFromCode(code: string): FileStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "C":
      return "copied";
    case "D":
      return "deleted";
    case "M":
    case "T":
      return "modified";
    case "R":
      return "renamed";
    default:
      throw new Error(`Unsupported Git file status: ${code}`);
  }
}

interface NameStatus {
  path: string;
  previousPath?: string;
  status: FileStatus;
}

function parseNameStatus(output: string): NameStatus[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();

  const files: NameStatus[] = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index++];
    if (!code) break;
    const status = statusFromCode(code);

    if (status === "renamed" || status === "copied") {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (previousPath === undefined || path === undefined) {
        throw new Error("Malformed Git name-status output");
      }
      files.push({ path, previousPath, status });
    } else {
      const path = fields[index++];
      if (path === undefined) throw new Error("Malformed Git name-status output");
      files.push({ path, status });
    }
  }
  return files;
}

interface ParsedDiff {
  addedLines: number;
  deletedLines: number;
  blocks: ChangedBlock[];
  deletedHunks: DeletedHunk[];
}

function parseZeroContextDiff(output: string): ParsedDiff {
  const blocks: ChangedBlock[] = [];
  const deletedHunks: DeletedHunk[] = [];
  let addedLines = 0;
  let deletedLines = 0;
  let current:
    | {
        oldStart: number;
        newStart: number;
        added: string[];
        deleted: string[];
      }
    | undefined;

  const finishHunk = () => {
    if (!current) return;
    if (current.added.length > 0) {
      blocks.push({
        kind: current.deleted.length > 0 ? "modified" : "added",
        startLine: current.newStart,
        endLine: current.newStart + current.added.length - 1,
        source: current.added.join("\n"),
      });
    }
    if (current.deleted.length > 0) {
      deletedHunks.push({
        oldStartLine: current.oldStart,
        oldEndLine: current.oldStart + current.deleted.length - 1,
        source: current.deleted.join("\n"),
      });
    }
  };

  for (const line of output.split("\n")) {
    const header = line.match(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
    );
    if (header) {
      finishHunk();
      current = {
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        added: [],
        deleted: [],
      };
    } else if (current && line.startsWith("+")) {
      current.added.push(line.slice(1));
      addedLines++;
    } else if (current && line.startsWith("-")) {
      current.deleted.push(line.slice(1));
      deletedLines++;
    }
  }
  finishHunk();

  return { addedLines, deletedLines, blocks, deletedHunks };
}

async function untrackedDiff(
  repositoryPath: string,
  path: string,
  isMarkdown: boolean,
): Promise<ParsedDiff> {
  const fullPath = join(repositoryPath, path);
  const fileStatus = await lstat(fullPath);
  if (fileStatus.isSymbolicLink()) {
    throw new Error(`Untracked symlink is not supported: ${path}`);
  }

  const resolvedPath = await realpath(fullPath);
  const relativePath = relative(repositoryPath, resolvedPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Untracked path resolves outside the repository: ${path}`);
  }

  if (!fileStatus.isFile() || !isMarkdown) {
    return {
      addedLines: 0,
      deletedLines: 0,
      blocks: [],
      deletedHunks: [],
    };
  }

  const contents = await readFile(resolvedPath);
  if (contents.includes(0)) {
    return {
      addedLines: 0,
      deletedLines: 0,
      blocks: [],
      deletedHunks: [],
    };
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return {
      addedLines: 0,
      deletedLines: 0,
      blocks: [],
      deletedHunks: [],
    };
  }
  const lines = source.endsWith("\n")
    ? source.slice(0, -1).split("\n")
    : source.split("\n");
  const nonemptyFileLines = source.length === 0 ? [] : lines;
  return {
    addedLines: nonemptyFileLines.length,
    deletedLines: 0,
    blocks:
      nonemptyFileLines.length === 0
        ? []
        : [
            {
              kind: "added",
              startLine: 1,
              endLine: nonemptyFileLines.length,
              source: nonemptyFileLines.join("\n"),
            },
          ],
    deletedHunks: [],
  };
}

export async function buildReview(
  repositoryPath: string,
  baseOverride?: string,
  fetch = true,
): Promise<ReviewModel> {
  const gitRoot = (
    await git(repositoryPath, ["rev-parse", "--show-toplevel"])
  ).trim();
  const warnings: string[] = [];
  const baseRef = await selectBase(gitRoot, baseOverride, fetch, warnings);

  const mergeBase = (
    await git(gitRoot, ["merge-base", "HEAD", baseRef])
  ).trim();
  const tracked = parseNameStatus(
    await git(gitRoot, [
      "diff",
      "--find-renames",
      "--find-copies",
      "--find-copies-harder",
      "--name-status",
      "-z",
      mergeBase,
      "--",
    ]),
  );
  const trackedPaths = new Set(tracked.map(({ path }) => path));
  const untracked: NameStatus[] = (
    await git(gitRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])
  )
    .split("\0")
    .filter((path) => path && !trackedPaths.has(path))
    .map((path) => ({ path, status: "added" }));

  const files = await Promise.all(
    [...tracked, ...untracked].map(async (file): Promise<ChangedFile> => {
      const isUntracked = untracked.some(({ path }) => path === file.path);
      const route = sourcePathToRoute(file.path);
      const parsedDiff = isUntracked
        ? await untrackedDiff(gitRoot, file.path, route !== null)
        : parseZeroContextDiff(
            await git(gitRoot, [
              "diff",
              "--find-renames",
              "--find-copies",
              "--find-copies-harder",
              "--unified=0",
              "--no-ext-diff",
              "--no-color",
              mergeBase,
              "--",
              ...(file.previousPath ? [file.previousPath] : []),
              file.path,
            ]),
          );
      const diff =
        route === null ? { ...parsedDiff, blocks: [] } : parsedDiff;

      return {
        ...file,
        route,
        ...diff,
      };
    }),
  );
  files.sort((left, right) => left.path.localeCompare(right.path));

  return {
    repositoryPath: gitRoot,
    baseRef,
    mergeBase,
    files,
    warnings,
  };
}

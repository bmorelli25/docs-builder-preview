import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

import type {
  ChangedBlock,
  ChangedFile,
  DeletedHunk,
  FileStatus,
  FrontmatterChange,
  ReviewModel,
} from "./model.js";
import { loadDocsetSubstitutions } from "./docset.js";
import { frontmatterEndLine, segmentMarkdown } from "./markdown.js";
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

  if (fetch && (await remoteExists(repositoryPath, "origin"))) {
    await refreshRemoteBranch(repositoryPath, "main", warnings);
  }
  if (await refExists(repositoryPath, "origin/main")) return "origin/main";
  if (await refExists(repositoryPath, "main")) return "main";

  throw new Error(
    "Could not select a Git base ref (tried pull request base, origin/main, and main)",
  );
}

async function remoteExists(
  repositoryPath: string,
  remote: string,
): Promise<boolean> {
  try {
    await git(repositoryPath, ["remote", "get-url", remote]);
    return true;
  } catch {
    return false;
  }
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
    if (code[0] === "U") {
      const path = fields[index++];
      if (path === undefined) {
        throw new Error("Malformed Git name-status output");
      }
      throw new Error(
        `Git conflict in "${path}". Resolve Git conflicts before previewing.`,
      );
    }
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
  deletionAnchors: number[];
}

function parseZeroContextDiff(output: string): ParsedDiff {
  const blocks: ChangedBlock[] = [];
  const deletedHunks: DeletedHunk[] = [];
  const deletionAnchors: number[] = [];
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
        newAnchorLine: current.newStart,
        source: current.deleted.join("\n"),
      });
      if (current.added.length === 0) {
        deletionAnchors.push(current.newStart);
      }
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

  return {
    addedLines,
    deletedLines,
    blocks,
    deletedHunks,
    deletionAnchors,
  };
}

async function safeCurrentSource(
  repositoryPath: string,
  path: string,
  isUntracked: boolean,
  isMarkdown: boolean,
): Promise<string | undefined> {
  const fullPath = join(repositoryPath, path);
  const fileStatus = await lstat(fullPath);
  if (fileStatus.isSymbolicLink()) {
    throw new Error(
      `${isUntracked ? "Untracked" : "Markdown"} symlink is not supported: ${path}`,
    );
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
    return undefined;
  }

  const contents = await readFile(resolvedPath);
  if (contents.includes(0)) {
    return undefined;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return undefined;
  }
}

function untrackedDiff(source?: string): ParsedDiff {
  if (source === undefined) {
    return {
      addedLines: 0,
      deletedLines: 0,
      blocks: [],
      deletedHunks: [],
      deletionAnchors: [],
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
    deletionAnchors: [],
  };
}

function overlaps(
  left: Pick<ChangedBlock, "startLine" | "endLine">,
  right: Pick<ChangedBlock, "startLine" | "endLine">,
): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

async function includedSource(
  gitRoot: string,
  filePath: string,
  target: string,
): Promise<string | undefined> {
  const fullPath = target.startsWith("/")
    ? join(gitRoot, target)
    : join(gitRoot, dirname(filePath), target);
  try {
    const resolvedPath = await realpath(fullPath);
    const relativePath = relative(await realpath(gitRoot), resolvedPath);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      return undefined;
    }
    return await readFile(resolvedPath, "utf8");
  } catch {
    return undefined;
  }
}

async function expandIncludes(
  gitRoot: string,
  filePath: string,
  blocks: ChangedBlock[],
): Promise<ChangedBlock[]> {
  const expanded = await Promise.all(
    blocks.map(async (block) => {
      const target = block.source.match(
        /^\s*(?::{3,}|`{3,})\{include\}\s+(\S+)/m,
      )?.[1];
      if (!target) return [block];
      const source = await includedSource(gitRoot, filePath, target);
      const included = source === undefined ? [] : segmentMarkdown(source);
      if (included.length === 0) return [block];
      return included.map((includedBlock) => ({
        kind: block.kind,
        startLine: block.startLine,
        endLine: block.endLine,
        source: includedBlock.source,
      }));
    }),
  );
  return expanded.flat();
}

function splitFrontmatterChanges(
  source: string,
  diff: Omit<ParsedDiff, "addedLines" | "deletedLines">,
  fileIsAdded: boolean,
): Omit<ParsedDiff, "addedLines" | "deletedLines"> & {
  frontmatter?: FrontmatterChange;
} {
  const end = frontmatterEndLine(source);
  if (end === 0) return diff;

  const lines = source.split(/\r?\n/);
  const frontmatterBlocks: ChangedBlock[] = [];
  const bodyBlocks: ChangedBlock[] = [];
  for (const range of diff.blocks) {
    const startLine = Math.max(range.startLine, 2);
    const endLine = Math.min(range.endLine, end - 1);
    if (startLine <= endLine) {
      frontmatterBlocks.push({
        kind: range.kind,
        startLine,
        endLine,
        source: lines.slice(startLine - 1, endLine).join("\n"),
      });
    }
    if (range.endLine > end) {
      bodyBlocks.push({ ...range, startLine: Math.max(range.startLine, end + 1) });
    }
  }
  const frontmatterDeleted = diff.deletedHunks.filter(
    (hunk) => hunk.newAnchorLine < end,
  );
  const result = {
    blocks: bodyBlocks,
    deletedHunks: diff.deletedHunks.filter((hunk) => hunk.newAnchorLine >= end),
    deletionAnchors: diff.deletionAnchors.filter((anchor) => anchor >= end),
  };
  if (frontmatterBlocks.length === 0 && frontmatterDeleted.length === 0) {
    return result;
  }
  const kind =
    fileIsAdded ||
    (frontmatterDeleted.length === 0 &&
      frontmatterBlocks.every((block) => block.kind === "added"))
      ? "added"
      : "modified";
  return {
    ...result,
    frontmatter: {
      kind,
      blocks: frontmatterBlocks,
      deletedHunks: frontmatterDeleted,
    },
  };
}

function semanticChangedBlocks(
  source: string,
  changedRanges: ChangedBlock[],
  deletionAnchors: number[],
  fileIsAdded: boolean,
): ChangedBlock[] {
  const semanticBlocks = segmentMarkdown(source);
  const anchoredBlockIndexes = new Set<number>();
  for (const anchor of deletionAnchors) {
    let nearestIndex: number | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    semanticBlocks.forEach((block, index) => {
      const distance =
        anchor < block.startLine
          ? block.startLine - anchor
          : anchor > block.endLine
            ? anchor - block.endLine
            : 0;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (nearestIndex !== undefined) anchoredBlockIndexes.add(nearestIndex);
  }

  const blocks: ChangedBlock[] = semanticBlocks.flatMap((block, index) => {
    const overlappingRanges = changedRanges.filter((range) =>
      overlaps(block, range),
    );
    const containsDeletion = anchoredBlockIndexes.has(index);
    if (overlappingRanges.length === 0 && !containsDeletion) return [];

    const fullyCoveredByAdditions = Array.from(
      { length: block.endLine - block.startLine + 1 },
      (_, index) => block.startLine + index,
    ).every((line) =>
      overlappingRanges.some(
        (range) =>
          range.kind === "added" &&
          range.startLine <= line &&
          line <= range.endLine,
      ),
    );
    const hasReplacement = overlappingRanges.some(
      ({ kind }) => kind === "modified",
    );
    const kind =
      !containsDeletion &&
      (fileIsAdded || (!hasReplacement && fullyCoveredByAdditions))
        ? "added"
        : "modified";

    const twins = semanticBlocks.filter(({ text }) => text === block.text);
    return [
      {
        kind,
        startLine: block.startLine,
        endLine: block.endLine,
        source: block.source,
        ...(twins.length > 1 && {
          occurrence: twins.indexOf(block),
          occurrences: twins.length,
        }),
      },
    ];
  });

  const sourceLines = source.split(/\r?\n/);
  for (const range of changedRanges) {
    let fallbackStart: number | undefined;
    const finishFallback = (endLine: number) => {
      if (fallbackStart === undefined) return;
      let startLine = fallbackStart;
      while (startLine <= endLine && !sourceLines[startLine - 1]?.trim()) {
        startLine++;
      }
      while (endLine >= startLine && !sourceLines[endLine - 1]?.trim()) {
        endLine--;
      }
      if (startLine <= endLine) {
        blocks.push({
          kind: range.kind,
          startLine,
          endLine,
          source: sourceLines.slice(startLine - 1, endLine).join("\n"),
        });
      }
      fallbackStart = undefined;
    };

    for (let line = range.startLine; line <= range.endLine + 1; line++) {
      const covered =
        line <= range.endLine &&
        semanticBlocks.some(
          (block) => block.startLine <= line && line <= block.endLine,
        );
      if (line <= range.endLine && !covered) {
        fallbackStart ??= line;
      } else {
        finishFallback(line - 1);
      }
    }
  }

  return blocks.sort(
    (left, right) =>
      left.startLine - right.startLine || left.endLine - right.endLine,
  );
}

export async function buildReview(
  repositoryPath: string,
  baseOverride?: string,
  fetch = true,
): Promise<ReviewModel> {
  const gitRoot = (
    await git(repositoryPath, ["rev-parse", "--show-toplevel"])
  ).trim();
  const substitutions = await loadDocsetSubstitutions(gitRoot);
  const warnings: string[] = [];
  const baseRef = await selectBase(gitRoot, baseOverride, fetch, warnings);

  const mergeBase = (
    await git(gitRoot, ["merge-base", "HEAD", baseRef])
  ).trim();
  parseNameStatus(
    await git(gitRoot, [
      "diff",
      "--name-status",
      "--diff-filter=U",
      "-z",
      "--",
    ]),
  );
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
      const isMarkdown = /\.(?:md|mdx)$/i.test(file.path);
      const currentSource =
        file.status === "deleted" || (!isUntracked && !isMarkdown)
          ? undefined
          : await safeCurrentSource(
              gitRoot,
              file.path,
              isUntracked,
              isMarkdown,
            );
      const parsedDiff = isUntracked
        ? untrackedDiff(currentSource)
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
      const { deletionAnchors, ...publicDiff } = parsedDiff;
      let diff: Omit<ParsedDiff, "deletionAnchors"> & {
        frontmatter?: FrontmatterChange;
      };
      if (isMarkdown && currentSource !== undefined) {
        const split = splitFrontmatterChanges(
          currentSource,
          parsedDiff,
          file.status === "added",
        );
        diff = {
          addedLines: parsedDiff.addedLines,
          deletedLines: parsedDiff.deletedLines,
          deletedHunks: split.deletedHunks,
          blocks: await expandIncludes(
            gitRoot,
            file.path,
            semanticChangedBlocks(
              currentSource,
              split.blocks,
              split.deletionAnchors,
              file.status === "added",
            ),
          ),
          ...(split.frontmatter && { frontmatter: split.frontmatter }),
        };
      } else {
        diff = { ...publicDiff, blocks: [] };
      }

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
    substitutions,
    files,
    warnings,
  };
}

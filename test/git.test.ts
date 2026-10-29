import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { buildReview } from "../src/git.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function git(repositoryPath: string, ...args: string[]) {
  return execFileAsync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
  });
}

async function write(repositoryPath: string, path: string, contents: string) {
  const fullPath = join(repositoryPath, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
}

async function createRepository() {
  const parent = await mkdtemp(join(tmpdir(), "docs-review-test-"));
  temporaryDirectories.push(parent);
  const repositoryPath = join(parent, "repo ; $() with spaces");
  await mkdir(repositoryPath);
  await git(repositoryPath, "init", "-b", "main");
  await git(repositoryPath, "config", "user.name", "Test User");
  await git(repositoryPath, "config", "user.email", "test@example.com");
  return repositoryPath;
}

async function commitAll(repositoryPath: string, message: string) {
  await git(repositoryPath, "add", "-A");
  await git(repositoryPath, "commit", "-m", message);
}

describe("buildReview", () => {
  it("combines committed, staged, and unstaged Markdown changes from the merge base", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "docs/modified.md", "old paragraph\n");
    await write(repositoryPath, "docs/deleted.md", "deleted paragraph\n");
    await write(repositoryPath, "docs/old-name.md", "renamed paragraph\n");
    await write(repositoryPath, "docs/staged.md", "before staged\n");
    await write(repositoryPath, "docs/unstaged.md", "before unstaged\n");
    await commitAll(repositoryPath, "base");

    await git(repositoryPath, "switch", "-c", "feature");
    await write(repositoryPath, "docs/modified.md", "new paragraph\n");
    await rm(join(repositoryPath, "docs/deleted.md"));
    await git(
      repositoryPath,
      "mv",
      "docs/old-name.md",
      "docs/new-name.md",
    );
    await write(repositoryPath, "docs/added.md", "added paragraph\n");
    await commitAll(repositoryPath, "committed docs changes");

    await write(repositoryPath, "docs/staged.md", "after staged\n");
    await git(repositoryPath, "add", "docs/staged.md");
    await write(repositoryPath, "docs/unstaged.md", "after unstaged\n");

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.baseRef).toBe("main");
    expect(review.mergeBase).toMatch(/^[0-9a-f]{40}$/);
    expect(review.files.map(({ path, status }) => [path, status])).toEqual([
      ["docs/added.md", "added"],
      ["docs/deleted.md", "deleted"],
      ["docs/modified.md", "modified"],
      ["docs/new-name.md", "renamed"],
      ["docs/staged.md", "modified"],
      ["docs/unstaged.md", "modified"],
    ]);

    const renamed = review.files.find(
      ({ path }) => path === "docs/new-name.md",
    );
    expect(renamed).toMatchObject({
      previousPath: "docs/old-name.md",
      route: "/docs/new-name",
    });

    const modified = review.files.find(
      ({ path }) => path === "docs/modified.md",
    );
    expect(modified).toMatchObject({
      addedLines: 1,
      deletedLines: 1,
      blocks: [
        {
          kind: "modified",
          startLine: 1,
          endLine: 1,
          source: "new paragraph",
        },
      ],
      deletedHunks: [
        {
          oldStartLine: 1,
          oldEndLine: 1,
          source: "old paragraph",
        },
      ],
    });

    expect(
      review.files.find(({ path }) => path === "docs/staged.md")?.blocks,
    ).toEqual([
      {
        kind: "modified",
        startLine: 1,
        endLine: 1,
        source: "after staged",
      },
    ]);
    expect(
      review.files.find(({ path }) => path === "docs/unstaged.md")?.blocks,
    ).toEqual([
      {
        kind: "modified",
        startLine: 1,
        endLine: 1,
        source: "after unstaged",
      },
    ]);
  });

  it("uses the local main branch by default and reports added line ranges", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(repositoryPath, "docs/new.md", "first\nsecond\n");
    await git(repositoryPath, "add", "docs/new.md");

    const review = await buildReview(repositoryPath, undefined, false);

    expect(review.baseRef).toBe("main");
    expect(review.files).toMatchObject([
      {
        path: "docs/new.md",
        status: "added",
        route: "/docs/new",
        addedLines: 2,
        deletedLines: 0,
        blocks: [
          {
            kind: "added",
            startLine: 1,
            endLine: 2,
            source: "first\nsecond",
          },
        ],
        deletedHunks: [],
      },
    ]);
  });

  it("passes repository paths to Git without shell interpolation", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "base.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(repositoryPath, "changed.md", "changed\n");
    await git(repositoryPath, "add", "changed.md");

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.files.map(({ path }) => path)).toEqual(["changed.md"]);
    await expect(
      readFile(join(repositoryPath, "with"), "utf8"),
    ).rejects.toThrow();
  });
});

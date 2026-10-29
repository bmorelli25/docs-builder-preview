import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildReview } from "../src/git.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
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

  it("segments an added Markdown page into semantic blocks", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(
      repositoryPath,
      "docs/new.md",
      [
        "# New page",
        "",
        "A paragraph that spans",
        "two source lines.",
        "",
        "- First item",
        "- Second item",
        "",
      ].join("\n"),
    );

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.files[0].blocks).toEqual([
      {
        kind: "added",
        startLine: 1,
        endLine: 1,
        source: "# New page",
      },
      {
        kind: "added",
        startLine: 3,
        endLine: 4,
        source: "A paragraph that spans\ntwo source lines.",
      },
      {
        kind: "added",
        startLine: 6,
        endLine: 6,
        source: "- First item",
      },
      {
        kind: "added",
        startLine: 7,
        endLine: 7,
        source: "- Second item",
      },
    ]);
  });

  it("selects the full semantic paragraph when one line changes", async () => {
    const repositoryPath = await createRepository();
    await write(
      repositoryPath,
      "docs/page.md",
      "Before.\n\nA paragraph spans\nits second line.\n\nAfter.\n",
    );
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(
      repositoryPath,
      "docs/page.md",
      "Before.\n\nA paragraph spans\nan edited second line.\n\nAfter.\n",
    );

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.files[0].blocks).toEqual([
      {
        kind: "modified",
        startLine: 3,
        endLine: 4,
        source: "A paragraph spans\nan edited second line.",
      },
    ]);
  });

  it("classifies an insertion inside an existing paragraph as modified", async () => {
    const repositoryPath = await createRepository();
    await write(
      repositoryPath,
      "docs/page.md",
      "Existing first line.\nExisting second line.\n",
    );
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(
      repositoryPath,
      "docs/page.md",
      "Existing first line.\nInserted line.\nExisting second line.\n",
    );

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.files[0].blocks).toEqual([
      {
        kind: "modified",
        startLine: 1,
        endLine: 3,
        source:
          "Existing first line.\nInserted line.\nExisting second line.",
      },
    ]);
  });

  it("classifies a wholly inserted paragraph as added", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "docs/page.md", "Existing paragraph.\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(
      repositoryPath,
      "docs/page.md",
      "Existing paragraph.\n\nA wholly new\nparagraph.\n",
    );

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.files[0].blocks).toEqual([
      {
        kind: "added",
        startLine: 3,
        endLine: 4,
        source: "A wholly new\nparagraph.",
      },
    ]);
  });

  it("deduplicates a semantic block touched by adjacent hunks", async () => {
    const repositoryPath = await createRepository();
    await write(
      repositoryPath,
      "docs/page.md",
      "First line.\nUnchanged middle.\nThird line.\n",
    );
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(
      repositoryPath,
      "docs/page.md",
      "Edited first line.\nUnchanged middle.\nEdited third line.\n",
    );

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.files[0].blocks).toEqual([
      {
        kind: "modified",
        startLine: 1,
        endLine: 3,
        source:
          "Edited first line.\nUnchanged middle.\nEdited third line.",
      },
    ]);
  });

  it("retains a raw fallback for an unsupported frontmatter change", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "docs/page.md", "---\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(repositoryPath, "docs/page.md", "***\n");

    const review = await buildReview(repositoryPath, "main", false);

    expect(review.files[0].blocks).toEqual([
      {
        kind: "modified",
        startLine: 1,
        endLine: 1,
        source: "***",
      },
    ]);
  });

  it("keeps deleted and supporting files out of semantic blocks", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "docs/deleted.md", "# Deleted\n");
    await write(repositoryPath, "docs/navigation.yml", "toc: old\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await rm(join(repositoryPath, "docs/deleted.md"));
    await write(repositoryPath, "docs/navigation.yml", "toc: new\n");

    const review = await buildReview(repositoryPath, "main", false);

    expect(
      review.files.find(({ path }) => path === "docs/deleted.md"),
    ).toMatchObject({
      status: "deleted",
      addedLines: 0,
      deletedLines: 1,
      blocks: [],
      deletedHunks: [
        {
          oldStartLine: 1,
          oldEndLine: 1,
          source: "# Deleted",
        },
      ],
    });
    expect(
      review.files.find(({ path }) => path === "docs/navigation.yml"),
    ).toMatchObject({
      status: "modified",
      addedLines: 1,
      deletedLines: 1,
      blocks: [],
    });
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

  it("uses the canonical Git root when invoked from a nested directory", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(repositoryPath, "docs/new.md", "from root\n");
    const nestedPath = join(repositoryPath, "packages", "tool");
    await mkdir(nestedPath, { recursive: true });

    const review = await buildReview(nestedPath, "main", false);
    const canonicalRoot = (
      await git(nestedPath, "rev-parse", "--show-toplevel")
    ).stdout.trim();

    expect(review.repositoryPath).toBe(canonicalRoot);
    expect(review.files).toMatchObject([
      {
        path: "docs/new.md",
        blocks: [{ source: "from root" }],
      },
    ]);
  });

  it("rejects untracked symlinks before reading their targets", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    const outsidePath = join(dirname(repositoryPath), "outside.md");
    await writeFile(outsidePath, "must not be read\n");
    await mkdir(join(repositoryPath, "docs"));
    await symlink(outsidePath, join(repositoryPath, "docs", "linked.md"));

    await expect(
      buildReview(repositoryPath, "main", false),
    ).rejects.toThrow("Untracked symlink is not supported: docs/linked.md");
  });

  it("does not parse untracked supporting or binary files as Markdown blocks", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(repositoryPath, "docs/navigation.yml", "toc: invalid\n");
    await writeFile(
      join(repositoryPath, "docs", "binary.md"),
      Buffer.from([0x00, 0xff, 0x01]),
    );

    const review = await buildReview(repositoryPath, "main", false);

    expect(
      review.files
        .filter(({ path }) =>
          ["docs/binary.md", "docs/navigation.yml"].includes(path),
        )
        .map(({ path, addedLines, blocks }) => ({
          path,
          addedLines,
          blocks,
        })),
    ).toEqual([
      { path: "docs/binary.md", addedLines: 0, blocks: [] },
      { path: "docs/navigation.yml", addedLines: 0, blocks: [] },
    ]);
  });

  it("retains tracked supporting-file status and stats without Markdown blocks", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "docs/navigation.yml", "toc: old\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(
      repositoryPath,
      "docs/navigation.yml",
      "toc: new\nextra: entry\n",
    );

    const review = await buildReview(repositoryPath, "main", false);

    expect(
      review.files.find(({ path }) => path === "docs/navigation.yml"),
    ).toMatchObject({
      status: "modified",
      route: null,
      addedLines: 2,
      deletedLines: 1,
      blocks: [],
    });
  });

  it("fetches origin/main before requiring a local remote-tracking ref", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");

    const remotePath = join(dirname(repositoryPath), "remote.git");
    await mkdir(remotePath);
    await git(remotePath, "init", "--bare");
    await git(repositoryPath, "remote", "add", "origin", remotePath);
    await git(repositoryPath, "push", "origin", "main");
    await git(
      repositoryPath,
      "update-ref",
      "-d",
      "refs/remotes/origin/main",
    );
    await git(repositoryPath, "switch", "-c", "feature");

    const binPath = join(dirname(repositoryPath), "bin");
    await mkdir(binPath);
    const ghPath = join(binPath, "gh");
    await writeFile(ghPath, "#!/bin/sh\nexit 1\n");
    await chmod(ghPath, 0o755);
    vi.stubEnv("PATH", `${binPath}:${process.env.PATH}`);

    const review = await buildReview(repositoryPath);

    expect(review.baseRef).toBe("origin/main");
    expect(
      (
        await git(
          repositoryPath,
          "rev-parse",
          "--verify",
          "refs/remotes/origin/main",
        )
      ).stdout.trim(),
    ).toMatch(/^[0-9a-f]{40}$/);
  });

  it("uses local main when fetching is enabled but no origin exists", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");

    const binPath = join(dirname(repositoryPath), "bin");
    await mkdir(binPath);
    const ghPath = join(binPath, "gh");
    await writeFile(ghPath, "#!/bin/sh\nexit 1\n");
    await chmod(ghPath, 0o755);
    vi.stubEnv("PATH", `${binPath}:${process.env.PATH}`);

    const review = await buildReview(repositoryPath);

    expect(review.baseRef).toBe("main");
    expect(review.warnings).toEqual([]);
  });

  it("does not fetch origin/main when fetching is disabled", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");

    const remotePath = join(dirname(repositoryPath), "remote.git");
    await mkdir(remotePath);
    await git(remotePath, "init", "--bare");
    await git(repositoryPath, "remote", "add", "origin", remotePath);
    await git(repositoryPath, "push", "origin", "main");
    await git(
      repositoryPath,
      "update-ref",
      "-d",
      "refs/remotes/origin/main",
    );
    await git(repositoryPath, "switch", "-c", "feature");

    const review = await buildReview(repositoryPath, undefined, false);

    expect(review.baseRef).toBe("main");
    await expect(
      git(
        repositoryPath,
        "rev-parse",
        "--verify",
        "refs/remotes/origin/main",
      ),
    ).rejects.toThrow();
  });

  it("fetches and honors a GitHub pull request base that is absent locally", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");

    const remotePath = join(dirname(repositoryPath), "remote.git");
    await mkdir(remotePath);
    await git(remotePath, "init", "--bare");
    await git(repositoryPath, "remote", "add", "origin", remotePath);
    await git(repositoryPath, "switch", "-c", "release");
    await write(repositoryPath, "release.md", "release\n");
    await commitAll(repositoryPath, "release");
    await git(repositoryPath, "push", "origin", "release");
    await git(repositoryPath, "switch", "main");
    await git(repositoryPath, "branch", "-D", "release");
    await git(
      repositoryPath,
      "update-ref",
      "-d",
      "refs/remotes/origin/release",
    );
    await git(repositoryPath, "switch", "-c", "feature");

    const binPath = join(dirname(repositoryPath), "bin");
    await mkdir(binPath);
    const ghPath = join(binPath, "gh");
    await writeFile(ghPath, "#!/bin/sh\nprintf 'release\\n'\n");
    await chmod(ghPath, 0o755);
    vi.stubEnv("PATH", `${binPath}:${process.env.PATH}`);

    const review = await buildReview(repositoryPath);

    expect(review.baseRef).toBe("origin/release");
    expect(
      (
        await git(
          repositoryPath,
          "rev-parse",
          "--verify",
          "refs/remotes/origin/release",
        )
      ).stdout.trim(),
    ).toMatch(/^[0-9a-f]{40}$/);
  });

  it("rejects an unresolved GitHub pull request base instead of falling back", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "README.md", "base\n");
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");

    const remotePath = join(dirname(repositoryPath), "remote.git");
    await mkdir(remotePath);
    await git(remotePath, "init", "--bare");
    await git(repositoryPath, "remote", "add", "origin", remotePath);

    const binPath = join(dirname(repositoryPath), "bin");
    await mkdir(binPath);
    const ghPath = join(binPath, "gh");
    await writeFile(ghPath, "#!/bin/sh\nprintf 'missing-release\\n'\n");
    await chmod(ghPath, 0o755);
    vi.stubEnv("PATH", `${binPath}:${process.env.PATH}`);

    await expect(buildReview(repositoryPath)).rejects.toThrow(
      "GitHub PR base could not be resolved after fetch: origin/missing-release",
    );
  });

  it("detects copies from unchanged source files", async () => {
    const repositoryPath = await createRepository();
    await write(
      repositoryPath,
      "docs/source.md",
      "A sufficiently distinctive paragraph for copy detection.\n",
    );
    await commitAll(repositoryPath, "base");
    await git(repositoryPath, "switch", "-c", "feature");
    await write(
      repositoryPath,
      "docs/copied.md",
      "A sufficiently distinctive paragraph for copy detection.\n",
    );
    await git(repositoryPath, "add", "docs/copied.md");

    const review = await buildReview(repositoryPath, "main", false);

    expect(
      review.files.find(({ path }) => path === "docs/copied.md"),
    ).toMatchObject({
      status: "copied",
      previousPath: "docs/source.md",
    });
  });
});

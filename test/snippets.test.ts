import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { findSnippetConsumers } from "../src/snippets.js";

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
  const parent = await mkdtemp(join(tmpdir(), "snippet-consumers-"));
  temporaryDirectories.push(parent);
  const repositoryPath = join(parent, "repo ; $() with spaces");
  await mkdir(repositoryPath);
  await git(repositoryPath, "init", "-b", "main");
  return repositoryPath;
}

describe("findSnippetConsumers", () => {
  it("resolves include paths from each consumer and canonicalizes changed paths", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "docs/_snippets/shared.md", "Shared text.\n");
    await write(repositoryPath, "examples/example.ts", "export {};\n");
    await write(
      repositoryPath,
      "docs/guide/page.md",
      [
        "# Page",
        "",
        "```{include} ../_snippets/shared.md",
        "```",
        "",
        ":::{literalinclude} ../../examples/example.ts",
        ":language: typescript",
        ":::",
      ].join("\n"),
    );
    await write(
      repositoryPath,
      "docs/another.md",
      ":::{include} _snippets/shared.md\n:::\n",
    );
    await write(
      repositoryPath,
      "docs/unrelated.md",
      "```{include} _snippets/other.md\n```\n",
    );
    await write(
      repositoryPath,
      "docs/example.md",
      [
        "````markdown",
        "```{include} _snippets/shared.md",
        "```",
        "````",
      ].join("\n"),
    );
    await git(repositoryPath, "add", ".");

    const nestedPath = join(repositoryPath, "docs", "guide");
    const consumers = await findSnippetConsumers(nestedPath, [
      "docs/_snippets/../_snippets/shared.md",
      join(repositoryPath, "examples", "example.ts"),
      "docs/_snippets/missing.md",
    ]);

    expect([...consumers]).toEqual([
      [
        "docs/_snippets/shared.md",
        ["docs/another.md", "docs/guide/page.md"],
      ],
      ["examples/example.ts", ["docs/guide/page.md"]],
      ["docs/_snippets/missing.md", []],
    ]);
  });

  it("ignores include targets and changed paths outside the Git root", async () => {
    const repositoryPath = await createRepository();
    const outsidePath = join(dirname(repositoryPath), "outside.md");
    await writeFile(outsidePath, "Outside.\n");
    await write(
      repositoryPath,
      "docs/page.md",
      "```{include} ../../outside.md\n```\n",
    );
    await git(repositoryPath, "add", ".");

    const consumers = await findSnippetConsumers(repositoryPath, [
      "../outside.md",
    ]);

    expect([...consumers]).toEqual([]);
  });

  it("does not read Markdown symlinks while scanning consumers", async () => {
    const repositoryPath = await createRepository();
    await write(repositoryPath, "docs/_snippets/shared.md", "Shared.\n");
    const outsideConsumer = join(dirname(repositoryPath), "outside-page.md");
    await writeFile(
      outsideConsumer,
      "```{include} docs/_snippets/shared.md\n```\n",
    );
    await mkdir(join(repositoryPath, "docs"), { recursive: true });
    await symlink(outsideConsumer, join(repositoryPath, "docs", "linked.md"));
    await git(repositoryPath, "add", ".");

    const consumers = await findSnippetConsumers(repositoryPath, [
      "docs/_snippets/shared.md",
    ]);

    expect(consumers.get("docs/_snippets/shared.md")).toEqual([]);
  });
});

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  createSourceLocator,
  locateQuoteInMarkdown,
  suggestionStoreKey,
} from "../src/source-locate.js";

const execFileAsync = promisify(execFile);

async function gitRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "source-locate-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}

describe("locateQuoteInMarkdown", () => {
  it("finds plain paragraph text and the nearest heading", () => {
    const source = [
      "# Switch to Agent Builder",
      "",
      "Kibana might prompt you to switch when your deployment supports it.",
      "",
      "## Next steps",
      "",
      "Keep going.",
    ].join("\n");

    expect(
      locateQuoteInMarkdown("guide.md", source, {
        exact: "Kibana might prompt you to switch when your deployment supports it.",
        prefix: "",
        suffix: "",
      }),
    ).toMatchObject({
      path: "guide.md",
      startLine: 3,
      endLine: 3,
      heading: "Switch to Agent Builder",
      found: true,
    });
  });

  it("expands substitutions when matching rendered text", () => {
    const source = "{{kib}} might prompt you to switch.";
    expect(
      locateQuoteInMarkdown(
        "guide.md",
        source,
        { exact: "Kibana might prompt you to switch.", prefix: "", suffix: "" },
        { kib: "Kibana" },
      ),
    ).toMatchObject({
      startLine: 1,
      source: "{{kib}} might prompt you to switch.",
      found: true,
    });
  });

  it("keeps {{substitutions}} in section headings instead of gap placeholders", () => {
    const source = [
      "## Compare {{ech}} and Serverless",
      "",
      "Choose the deployment type that fits your workload.",
    ].join("\n");

    expect(
      locateQuoteInMarkdown(
        "guide.md",
        source,
        {
          exact: "Choose the deployment type that fits your workload.",
          prefix: "",
          suffix: "",
        },
        { ech: "Elastic Cloud Hosted" },
      ),
    ).toMatchObject({
      heading: "Compare Elastic Cloud Hosted and Serverless",
      found: true,
    });

    expect(
      locateQuoteInMarkdown(
        "guide.md",
        source,
        {
          exact: "Choose the deployment type that fits your workload.",
          prefix: "",
          suffix: "",
        },
        {},
      ),
    ).toMatchObject({
      heading: "Compare {{ech}} and Serverless",
      found: true,
    });
    expect(
      locateQuoteInMarkdown(
        "guide.md",
        source,
        {
          exact: "Choose the deployment type that fits your workload.",
          prefix: "",
          suffix: "",
        },
        {},
      )?.heading,
    ).not.toMatch(/\uFFFC/);
  });

  it("matches link labels without the destination", () => {
    const source = "See [Manage access](../manage.md) for privileges.";
    expect(
      locateQuoteInMarkdown("guide.md", source, {
        exact: "See Manage access for privileges.",
        prefix: "",
        suffix: "",
      }),
    ).toMatchObject({ startLine: 1, found: true });
  });

  it("matches a single table row", () => {
    const source = [
      "| Feature | Status |",
      "| --- | --- |",
      "| Agent Builder | ✅ |",
      "| AI Assistant | deprecated |",
    ].join("\n");

    expect(
      locateQuoteInMarkdown("table.md", source, {
        exact: "AI Assistant deprecated",
        prefix: "Agent Builder",
        suffix: "",
      }),
    ).toMatchObject({ startLine: 4, endLine: 4, found: true });
  });

  it("matches text inside a colon directive", () => {
    const source = [
      "::::{admonition} Requirements",
      "Needs a subscription.",
      "::::",
    ].join("\n");

    expect(
      locateQuoteInMarkdown("note.md", source, {
        exact: "Needs a subscription.",
        prefix: "",
        suffix: "",
      }),
    ).toMatchObject({ startLine: 2, found: true });
  });

  it("returns undefined when the quote is absent", () => {
    expect(
      locateQuoteInMarkdown("guide.md", "Hello world.", {
        exact: "missing text",
        prefix: "",
        suffix: "",
      }),
    ).toBeUndefined();
  });
});

describe("suggestionStoreKey", () => {
  it("hashes the repository path and sanitizes the branch", () => {
    const key = suggestionStoreKey("/tmp/docs-content", "docs/feature!!");
    expect(key).toMatch(/^[a-f0-9]{16}\/docs_feature_+$/);
  });
});

describe("createSourceLocator", () => {
  it("indexes routes and locates quotes, including snippet includes", async () => {
    const root = await gitRepo();
    await mkdir(join(root, "docs/_snippets"), { recursive: true });
    await writeFile(
      join(root, "docs/_snippets/shared.md"),
      "Shared warning about Agent Builder.\n",
    );
    await writeFile(
      join(root, "docs/guide.md"),
      [
        "# Guide",
        "",
        "Intro paragraph about chat.",
        "",
        "```{include} _snippets/shared.md",
        "```",
        "",
      ].join("\n"),
    );
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });

    const locator = await createSourceLocator({
      repositoryPath: root,
      substitutions: () => ({}),
    });

    expect(locator.fileForRoute("/docs/guide")).toBe("docs/guide.md");

    await expect(
      locator.locate("/docs/guide", {
        exact: "Intro paragraph about chat.",
        prefix: "",
        suffix: "",
      }),
    ).resolves.toMatchObject({
      path: "docs/guide.md",
      startLine: 3,
      found: true,
    });

    await expect(
      locator.locate("/docs/guide", {
        exact: "Shared warning about Agent Builder.",
        prefix: "",
        suffix: "",
      }),
    ).resolves.toMatchObject({
      path: "docs/_snippets/shared.md",
      found: true,
    });

    await expect(
      locator.locate("/docs/guide", {
        exact: "text that is gone",
        prefix: "",
        suffix: "",
      }),
    ).resolves.toMatchObject({
      path: "docs/guide.md",
      found: false,
      heading: "Guide",
    });
  });
});

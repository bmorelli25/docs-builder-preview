import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDocsetSubstitutions } from "../src/docset.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function repository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "docs-review-docset-"));
  temporaryDirectories.push(path);
  return path;
}

describe("loadDocsetSubstitutions", () => {
  it("loads scalar substitutions as strings and ignores complex values", async () => {
    const root = await repository();
    await writeFile(
      join(root, "docset.yml"),
      [
        "subs:",
        "  agent-builder: Elastic Agent Builder",
        "  count: 42",
        "  enabled: true",
        "  nested:",
        "    label: ignored",
        "  sequence:",
        "    - ignored",
        "  empty: null",
      ].join("\n"),
    );

    await expect(loadDocsetSubstitutions(root)).resolves.toEqual({
      "agent-builder": "Elastic Agent Builder",
      count: "42",
      enabled: "true",
    });
  });

  it("returns an empty map when docset.yml or subs is absent", async () => {
    const withoutDocset = await repository();
    await expect(loadDocsetSubstitutions(withoutDocset)).resolves.toEqual({});

    const withoutSubs = await repository();
    await mkdir(join(withoutSubs, "docs"));
    await writeFile(join(withoutSubs, "docset.yml"), "toc: docs/index.md\n");
    await expect(loadDocsetSubstitutions(withoutSubs)).resolves.toEqual({});
  });

  it("reports malformed YAML with the repository docset path", async () => {
    const root = await repository();
    await writeFile(join(root, "docset.yml"), "subs:\n  broken: [one\n");

    await expect(loadDocsetSubstitutions(root)).rejects.toThrow(
      /Could not parse .*docset\.yml.*YAML/i,
    );
  });
});

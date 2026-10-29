import { describe, expect, it } from "vitest";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { createDashboard } from "../src/ui/dashboard.js";
import { createHighlighterScript } from "../src/ui/highlighter.js";
import { reviewStyles } from "../src/ui/styles.js";

const rootFile: ChangedFile = {
  path: "index.md",
  status: "modified",
  route: "/",
  addedLines: 1,
  deletedLines: 0,
  blocks: [
    {
      kind: "modified",
      startLine: 1,
      endLine: 1,
      source: "</script><img src=x onerror=alert(1)>",
    },
  ],
  deletedHunks: [],
};

describe("generated browser assets", () => {
  it("links a changed root page without returning to the dashboard", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [rootFile],
      warnings: [],
    };

    expect(createDashboard(review)).toContain('href="/?preview=1"');
  });

  it("emits syntactically valid, injection-safe highlighter JavaScript", () => {
    const script = createHighlighterScript(rootFile);

    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script\\u003e");
    expect(script).toContain("uniqueExact");
    expect(script).toContain("uniqueTokenMatch");
    expect(script).toContain("Unmatched");
    expect(script).toContain("Deleted source");
  });

  it("uses the shared Markdown normalizer for browser matching text", () => {
    const file: ChangedFile = {
      ...rootFile,
      blocks: [
        {
          kind: "added",
          startLine: 1,
          endLine: 1,
          source: "## Read [the guide](https://example.com) ##",
        },
      ],
    };

    expect(createHighlighterScript(file)).toContain(
      '"text":"Read the guide"',
    );
  });

  it("reloads the preview when the app broadcasts a refresh", () => {
    const script = createHighlighterScript(rootFile);

    expect(script).toContain('new EventSource("/api/events")');
    expect(script).toContain('addEventListener("refresh"');
    expect(script).toContain("window.location.reload()");
  });

  it("exports distinct added and modified highlight styles", () => {
    expect(reviewStyles).toContain('[data-docs-review-mark="added"]');
    expect(reviewStyles).toContain('[data-docs-review-mark="modified"]');
    expect(reviewStyles).toContain("#16a34a");
    expect(reviewStyles).toContain("#ca8a04");
  });
});

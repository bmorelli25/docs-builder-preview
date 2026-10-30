import { describe, expect, it } from "vitest";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { createDashboard } from "../src/ui/dashboard.js";
import { suggestionScript } from "../src/ui/suggestions.js";

const page = (path: string, route: string): ChangedFile => ({
  path,
  status: "modified",
  route,
  addedLines: 1,
  deletedLines: 0,
  blocks: [],
  deletedHunks: [],
});

const review: ReviewModel = {
  repositoryPath: "/tmp/docs",
  baseRef: "main",
  mergeBase: "abc",
  warnings: [],
  files: [page("docs/guide.md", "/guide")],
};

describe("suggestions dashboard markup", () => {
  it("includes the suggestions panel, editor, and toggle", () => {
    const dashboard = createDashboard(review);
    expect(dashboard).toContain('id="suggestions-copy-all"');
    expect(dashboard).toContain('id="suggestions-preview"');
    expect(dashboard).toContain('id="suggestions-clear-all"');
    expect(dashboard).toContain('id="suggestions-export-modal"');
    expect(dashboard).toContain('id="suggestion-editor"');
    expect(dashboard).toContain('id="suggest-edits"');
    expect(dashboard).toContain('class="suggestions-slot"');
    expect(dashboard).toContain('id="suggestions-data"');
    expect(dashboard).toContain(suggestionScript);
    expect(dashboard).toContain("Suggest edits");
    expect(dashboard).toContain(">Copy</button>");
    expect(dashboard).toContain(">Preview</button>");
    expect(dashboard).toContain(">Clear</button>");
    expect(dashboard).toMatch(
      /<label class="deleted-control" for="suggest-edits">/,
    );
  });
});

import { describe, expect, it } from "vitest";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { createDashboard } from "../src/ui/dashboard.js";
import { reviewCheckScript } from "../src/ui/review-checks.js";

const file = (path: string, overrides: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  status: "modified",
  route: `/${path.replace(/\.md$/, "")}`,
  addedLines: 1,
  deletedLines: 0,
  blocks: [],
  deletedHunks: [],
  ...overrides,
});

const review: ReviewModel = {
  repositoryPath: "/tmp/repo",
  baseRef: "main",
  mergeBase: "abc",
  warnings: [],
  files: [
    file("docs/guide.md"),
    file("docs/added.md", { status: "added" }),
    file("docs/removed.md", { status: "deleted" }),
    file("docs/_snippets/shared.md", {
      route: null,
      consumers: ["docs/guide.md"],
    }),
    file("images/diagram.svg", { route: null }),
  ],
};

const checkboxes = (html: string) =>
  [...html.matchAll(/<input type="checkbox" data-review-check="([^"]*)"[^>]*>/g)];

describe("review check dashboard markup", () => {
  it("adds a labeled checkbox outside the link of each previewable page card", () => {
    const dashboard = createDashboard(review);

    expect(checkboxes(dashboard).map((match) => match[1]).sort()).toEqual([
      "docs/added.md",
      "docs/guide.md",
    ]);
    expect(dashboard).toContain('aria-label="Mark docs/guide.md as reviewed"');
    const card = dashboard.match(
      /<li [^>]*data-review-check-item[^>]*>([\s\S]*?)<\/li>/,
    )?.[1];
    expect(card).toBeDefined();
    const link = card!.match(/<a [\s\S]*?<\/a>/)?.[0];
    expect(link).toBeDefined();
    expect(link).not.toContain("<input");
    expect(card!.indexOf("</a>")).toBeLessThan(card!.indexOf("<input"));
  });

  it("renders unchecked state with a disabled Clear checks button", () => {
    const dashboard = createDashboard(review);

    expect(dashboard).toContain("0 of 2 reviewed");
    expect(dashboard).toContain(
      '<button type="button" class="review-clear" id="clear-review-checks" disabled>Clear checks</button>',
    );
    expect(dashboard).not.toContain('data-reviewed="true">');
    for (const [input] of checkboxes(dashboard)) {
      expect(input).not.toContain(" checked");
    }
  });

  it("renders reviewed pages as checked and muted with progress", () => {
    const dashboard = createDashboard(
      review,
      undefined,
      new Set(["docs/added.md", "docs/removed.md", "docs/stale.md"]),
    );

    expect(dashboard).toContain("1 of 2 reviewed");
    expect(dashboard).toContain(
      '<button type="button" class="review-clear" id="clear-review-checks">Clear checks</button>',
    );
    const inputs = Object.fromEntries(
      checkboxes(dashboard).map(([input, path]) => [path, input]),
    );
    expect(inputs["docs/added.md"]).toContain(" checked");
    expect(inputs["docs/guide.md"]).not.toContain(" checked");
    expect(dashboard).toMatch(
      /data-status="added"[^>]*data-review-check-item data-reviewed="true"/,
    );
    expect(dashboard).toContain('data-reviewed="true"] > .review-link');
    expect(dashboard).toContain('content: "✓ Reviewed"');
  });

  it("places progress inside the Previewable pages group", () => {
    const dashboard = createDashboard(review);
    const pagesGroup = dashboard.match(
      /<section class="review-group" data-review-group="pages"[\s\S]*?<\/section>/,
    )?.[0];
    expect(pagesGroup).toContain("Previewable pages");
    expect(pagesGroup).toContain('id="review-progress-count" role="status"');
  });

  it("omits progress when there are no previewable pages", () => {
    const dashboard = createDashboard({
      ...review,
      files: review.files.filter((changed) => changed.route === null),
    });
    expect(dashboard).not.toContain('id="review-progress-count"');
    expect(checkboxes(dashboard)).toHaveLength(0);
  });

  it("escapes page paths in check controls", () => {
    const dashboard = createDashboard({
      ...review,
      files: [file('docs/"><b>bold</b>.md', { route: "/safe" })],
    });
    expect(dashboard).not.toContain("<b>bold</b>");
    expect(dashboard).toContain(
      'data-review-check="docs/&quot;&gt;&lt;b&gt;bold&lt;/b&gt;.md"',
    );
  });

  it("syncs checks through the server without browser storage", () => {
    expect(() => new Function(reviewCheckScript)).not.toThrow();
    expect(reviewCheckScript).toContain('"/api/review-checks"');
    expect(reviewCheckScript).toContain('"/api/review-checks/clear"');
    expect(reviewCheckScript).toContain('"content-type": "application/json"');
    for (const storage of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
    ]) {
      expect(reviewCheckScript).not.toContain(storage);
    }
    expect(createDashboard(review)).toContain(reviewCheckScript);
  });
});

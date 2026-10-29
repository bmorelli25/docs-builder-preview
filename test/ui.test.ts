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

  it("links snippet consumers through a review-source selector", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [
        {
          ...rootFile,
          path: "docs/_snippets/shared.md",
          route: null,
          consumers: ["docs/guide.md"],
        },
      ],
      warnings: [],
    };

    const dashboard = createDashboard(review);
    expect(dashboard).toContain("docs/guide.md");
    expect(dashboard).toContain(
      'href="/docs/guide?review-source=docs%2F_snippets%2Fshared.md"',
    );
    expect(dashboard).toContain('target="docs-preview"');
  });

  it("renders an integrated, grouped review app with filters and badges", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "origin/main",
      mergeBase: "abc",
      warnings: ["One compact warning"],
      files: [
        {
          ...rootFile,
          path: "docs/added.md",
          route: "/docs/added",
          status: "added",
          addedLines: 12,
          deletedLines: 0,
        },
        {
          ...rootFile,
          path: "docs/renamed.md",
          previousPath: "docs/old-name.md",
          route: "/docs/renamed",
          status: "renamed",
          addedLines: 2,
          deletedLines: 1,
        },
        {
          ...rootFile,
          path: "docs/deleted.md",
          route: "/docs/deleted",
          status: "deleted",
          addedLines: 0,
          deletedLines: 18,
        },
        {
          ...rootFile,
          path: "docs/_snippets/shared.md",
          route: null,
          status: "modified",
          consumers: ["docs/guide.md", "docs/tutorial.md"],
          addedLines: 3,
          deletedLines: 2,
        },
        {
          ...rootFile,
          path: "images/diagram.svg",
          route: null,
          status: "modified",
          addedLines: 4,
          deletedLines: 4,
        },
      ],
    };

    const dashboard = createDashboard(review);
    expect(dashboard).toContain("<strong>5</strong> changed files");
    expect(dashboard).toContain("<strong>4</strong> preview pages");
    expect(dashboard).toContain("<code>origin/main</code>");
    expect(dashboard).toContain('id="review-search"');
    expect(dashboard).toContain('id="status-filter"');
    expect(dashboard).toContain('value="added"');
    expect(dashboard).toContain('value="modified"');
    expect(dashboard).toContain('data-review-group="pages"');
    expect(dashboard).toContain("Previewable pages");
    expect(dashboard).toContain('data-review-group="snippets"');
    expect(dashboard).toContain("Snippets and consumers");
    expect(dashboard).toContain('data-review-group="deleted"');
    expect(dashboard).toContain("Deleted pages");
    expect(dashboard).toContain('data-review-group="supporting"');
    expect(dashboard).toContain("Supporting files");
    expect(dashboard).toContain('class="status-badge status-added"');
    expect(dashboard).toContain('class="status-badge status-modified"');
    expect(dashboard).toContain('class="status-badge status-renamed"');
    expect(dashboard).toContain('class="status-badge status-deleted"');
    expect(dashboard).toContain("+12");
    expect(dashboard).toContain("−18");
    expect(dashboard).toContain('class="warnings"');
  });

  it("targets a same-origin iframe and includes selection and filtering behavior", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [
        {
          ...rootFile,
          path: "docs/guide.md",
          route: "/docs/guide",
        },
      ],
      warnings: [],
    };

    const dashboard = createDashboard(review);
    expect(dashboard).toContain(
      '<iframe name="docs-preview" title="Documentation preview"',
    );
    expect(dashboard).toContain('target="docs-preview"');
    expect(dashboard).toContain('class="preview-empty"');
    expect(dashboard).toContain("Select a page to preview");
    expect(dashboard).toContain('setAttribute("aria-current", "page")');
    expect(dashboard).toContain("applyFilters");
    expect(dashboard).toContain("item.hidden");
    expect(dashboard).toContain("group.hidden");
  });

  it("escapes dashboard metadata, warnings, and file labels", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: '<main & "next">',
      mergeBase: "abc",
      files: [
        {
          ...rootFile,
          path: '<script>alert("file")</script>.md',
          route: "/safe",
        },
      ],
      warnings: ['<img src=x onerror="warning">'],
    };

    const dashboard = createDashboard(review);
    expect(dashboard).not.toContain("<script>alert");
    expect(dashboard).not.toContain("<img src=x");
    expect(dashboard).toContain("&lt;main &amp; &quot;next&quot;&gt;");
    expect(dashboard).toContain(
      "&lt;script&gt;alert(&quot;file&quot;)&lt;/script&gt;.md",
    );
    expect(dashboard).toContain(
      "&lt;img src=x onerror=&quot;warning&quot;&gt;",
    );
  });

  it("reloads the dashboard when review data refreshes", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [],
      warnings: [],
    };

    const dashboard = createDashboard(review);
    const script = dashboard.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    let refresh: (() => void) | undefined;
    let reloads = 0;
    class EventSourceStub {
      constructor(url: string) {
        expect(url).toBe("/api/events");
      }
      addEventListener(event: string, listener: () => void) {
        if (event === "refresh") refresh = listener;
      }
      close() {}
    }
    const windowStub = {
      location: { reload: () => reloads++ },
      addEventListener() {},
    };

    new Function("EventSource", "window", script!)(
      EventSourceStub,
      windowStub,
    );
    refresh?.();
    expect(reloads).toBe(1);
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

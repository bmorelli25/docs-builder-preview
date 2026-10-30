import { describe, expect, it } from "vitest";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { createDashboard } from "../src/ui/dashboard.js";
import {
  createHighlighterData,
  createSourceHref,
  parentHighlighterScript,
} from "../src/ui/highlighter.js";
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
    expect(dashboard).toContain(
      'data-source-file="docs/_snippets/shared.md"',
    );
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
    expect(dashboard).toContain('sandbox="allow-same-origin"');
    expect(dashboard).not.toContain("allow-scripts");
    expect(dashboard).toContain('target="docs-preview"');
    expect(dashboard).toContain('class="preview-empty"');
    expect(dashboard).toContain("Select a page to preview");
    expect(dashboard).toContain('setAttribute("aria-current", "page")');
    expect(dashboard).toContain("applyFilters");
    expect(dashboard).toContain("item.hidden");
    expect(dashboard).toContain("group.hidden");
  });

  it("persists and safely restores dashboard state across refreshes", () => {
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
    expect(dashboard).toContain('sessionStorage.setItem("docs-review-state"');
    expect(dashboard).toContain('sessionStorage.getItem("docs-review-state")');
    expect(dashboard).toContain("activeHref");
    expect(dashboard).toContain("search:");
    expect(dashboard).toContain("status:");
    expect(dashboard).toContain("scrollTop:");
    expect(dashboard).toContain(
      'link.getAttribute("href") === state.activeHref',
    );
    expect(dashboard).toContain('preview.setAttribute("src", state.activeHref)');
    expect(dashboard).toContain("previewEmpty.hidden = false");
  });

  it("counts unique preview pathnames across snippet selectors", () => {
    const snippet = (path: string): ChangedFile => ({
      ...rootFile,
      path,
      route: null,
      consumers: ["docs/guide.md"],
    });
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [
        snippet("docs/_snippets/one.md"),
        snippet("docs/_snippets/two.md"),
      ],
      warnings: [],
    };

    expect(createDashboard(review)).toContain(
      "<strong>1</strong> preview pages",
    );
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
    expect(dashboard).toContain(
      '<script type="application/json" id="review-data">',
    );
    expect(dashboard).toContain("\\u003cscript\\u003e");
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
    let persisted = 0;
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
      persistReviewState: () => persisted++,
      addEventListener() {},
    };

    new Function("EventSource", "window", script!)(
      EventSourceStub,
      windowStub,
    );
    refresh?.();
    expect(persisted).toBe(1);
    expect(reloads).toBe(1);
  });

  it("embeds script-safe parent highlighter data", () => {
    const review: ReviewModel = {
      repositoryPath: "/canonical/repository",
      baseRef: "main",
      mergeBase: "abc",
      files: [rootFile],
      warnings: [],
    };
    const data = createHighlighterData(review);

    expect(data).not.toContain("</script>");
    expect(data).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(data)).toMatchObject({
      repositoryPath: "/canonical/repository",
      files: [
        {
          path: "index.md",
          sourceBase: "vscode://file/canonical/repository/index.md",
        },
      ],
    });
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

    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [file],
      warnings: [],
    };
    expect(createHighlighterData(review)).toContain('"text":"Read the guide"');
  });

  it("normalizes every changed block with review substitutions", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      substitutions: {
        "agent-builder": "Elastic Agent Builder",
        kib: "Kibana",
      },
      files: [
        {
          ...rootFile,
          blocks: [
            {
              kind: "modified",
              startLine: 1,
              endLine: 1,
              source:
                "{{agent-builder}} in {{kib}} {applies_to}`stack: ga 9.1`",
            },
          ],
        },
      ],
      warnings: [],
    };

    expect(JSON.parse(createHighlighterData(review)).files[0].blocks[0].text)
      .toBe("Elastic Agent Builder in Kibana");
  });

  it("runs matching and review controls only in the trusted parent", () => {
    expect(() => new Function(parentHighlighterScript)).not.toThrow();
    expect(parentHighlighterScript).toContain("preview.contentDocument");
    expect(parentHighlighterScript).toContain("uniqueExact");
    expect(parentHighlighterScript).toContain("uniqueTokenMatch");
    expect(parentHighlighterScript).toContain("Previous");
    expect(parentHighlighterScript).toContain("Next");
    expect(parentHighlighterScript).toContain("matched");
    expect(parentHighlighterScript).toContain("unmatched");
    expect(parentHighlighterScript).toContain("mapping-status");
    expect(parentHighlighterScript).toContain("Open source");
    expect(parentHighlighterScript).toContain("file.sourceBase");
    expect(parentHighlighterScript).toContain("deleted-inline");
    expect(parentHighlighterScript).toContain("nearest");
    expect(parentHighlighterScript).toContain("deleted-fallback");
    expect(parentHighlighterScript).toContain('createElement("link")');
    expect(parentHighlighterScript).toContain('rel = "stylesheet"');
    expect(parentHighlighterScript).toContain(
      'href = "/_review/highlight.css"',
    );
    expect(parentHighlighterScript).not.toContain('createElement("style")');
    expect(parentHighlighterScript).not.toContain("style.textContent");
    expect(parentHighlighterScript).not.toContain("EventSource");
  });

  it("encodes every Open source path segment and preserves separators", () => {
    expect(
      createSourceHref(
        "/Users/Brändon/My #repo",
        "docs/100% ready?/a b#.md",
        42,
      ),
    ).toBe(
      "vscode://file/Users/Br%C3%A4ndon/My%20%23repo/docs/100%25%20ready%3F/a%20b%23.md:42",
    );
    expect(createSourceHref("/repo", "guide.md", Number.NaN)).toBe(
      "vscode://file/repo/guide.md:1",
    );
  });

  it("keeps malicious upstream code outside the trusted runtime", () => {
    expect(parentHighlighterScript).not.toContain("__maliciousDocsScript");
    expect(parentHighlighterScript).not.toContain("eval(");
    expect(parentHighlighterScript).not.toContain("new Function");
  });

  it("exports distinct added and modified highlight styles", () => {
    expect(reviewStyles).toContain('[data-docs-review-mark="added"]');
    expect(reviewStyles).toContain('[data-docs-review-mark="modified"]');
    expect(reviewStyles).toContain("#16a34a");
    expect(reviewStyles).toContain("#ca8a04");
  });
});

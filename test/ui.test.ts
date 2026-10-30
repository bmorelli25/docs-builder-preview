import { describe, expect, it } from "vitest";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { createDashboard } from "../src/ui/dashboard.js";
import {
  createHighlighterData,
  createSourceHref,
  parentHighlighterScript,
} from "../src/ui/highlighter.js";
import { reviewStyles } from "../src/ui/styles.js";
import { wordTokenSource } from "../src/word-diff.js";

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

  it("renders accessible persistent review display controls", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [rootFile],
      warnings: [],
    };

    const dashboard = createDashboard(review);
    expect(dashboard).toContain('id="hide-deleted-lines"');
    expect(dashboard).toContain('for="hide-deleted-lines"');
    expect(dashboard).toContain("Hide deleted lines");
    expect(dashboard).toContain('id="page-sort"');
    expect(dashboard).toContain('aria-label="Sort previewable pages"');
    expect(dashboard).toContain('<option value="path">Path</option>');
    expect(dashboard).toContain(
      '<option value="lines-changed">Lines changed</option>',
    );
    expect(dashboard).toContain('id="sidebar-toggle"');
    expect(dashboard).toContain('aria-expanded="true"');
    expect(dashboard).toContain('aria-label="Collapse sidebar"');
    expect(dashboard).toContain("hideDeleted:");
    expect(dashboard).toContain("pageSort:");
    expect(dashboard).toContain("sidebarCollapsed:");
  });

  it("orders previewable pages by path and exposes exact line-change totals", () => {
    const page = (
      path: string,
      addedLines: number,
      deletedLines: number,
    ): ChangedFile => ({
      ...rootFile,
      path,
      route: `/${path.replace(".md", "")}`,
      addedLines,
      deletedLines,
    });
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [
        page("docs/zeta.md", 4, 3),
        page("docs/alpha.md", 2, 5),
        {
          ...page("docs/_snippets/shared.md", 100, 100),
          route: null,
          consumers: ["docs/consumer.md"],
        },
        page("docs/beta.md", 1, 1),
      ],
      warnings: [],
    };

    const dashboard = createDashboard(review);
    const alpha = dashboard.indexOf('data-path="docs/alpha.md"');
    const beta = dashboard.indexOf('data-path="docs/beta.md"');
    const zeta = dashboard.indexOf('data-path="docs/zeta.md"');
    expect(alpha).toBeGreaterThan(-1);
    expect(alpha).toBeLessThan(beta);
    expect(beta).toBeLessThan(zeta);
    expect(dashboard).toContain(
      'data-path="docs/alpha.md" data-lines-changed="7"',
    );
    expect(dashboard).toContain(
      'data-path="docs/zeta.md" data-lines-changed="7"',
    );
    expect(dashboard).toContain("right.linesChanged - left.linesChanged");
    expect(dashboard).toContain("left.path.localeCompare(right.path)");
    expect(dashboard).toContain(
      'querySelector("[data-review-group=\\"pages\\"] > ul")',
    );
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

  it("matches a changed step line by its title", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      files: [
        {
          ...rootFile,
          blocks: [
            {
              kind: "modified",
              startLine: 159,
              endLine: 159,
              source: "::::{step} Assess criticality and context",
            },
          ],
        },
      ],
      warnings: [],
    };
    expect(createHighlighterData(review)).toContain(
      '"text":"Assess criticality and context"',
    );
  });

  it("exposes changed tab titles with substitutions applied", () => {
    const review: ReviewModel = {
      repositoryPath: "/tmp/repo",
      baseRef: "main",
      mergeBase: "abc",
      substitutions: { kib: "Kibana" },
      files: [
        {
          ...rootFile,
          blocks: [
            {
              kind: "modified",
              startLine: 4,
              endLine: 4,
              source: "::::{tab-item} Local files on the {{kib}} host",
            },
          ],
        },
      ],
      warnings: [],
    };
    expect(createHighlighterData(review)).toContain(
      '"tabTitle":"Local files on the Kibana host"',
    );
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
      .toBe("Elastic Agent Builder in Kibana \uFFFC");
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
    expect(parentHighlighterScript).toContain("hide-deleted-lines");
    expect(parentHighlighterScript).toContain("applyDeletedVisibility");
    expect(parentHighlighterScript).toContain(
      'querySelectorAll(".deleted-inline")',
    );
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

  it("marks word diffs with DOM APIs and the server's tokenizer", () => {
    expect(parentHighlighterScript).toContain(
      `const wordPattern = ${JSON.stringify(wordTokenSource)};`,
    );
    expect(parentHighlighterScript).toContain('createElement("ins")');
    expect(parentHighlighterScript).toContain('createElement("del")');
    expect(parentHighlighterScript).toContain("removed.textContent = edit.text");
    expect(parentHighlighterScript).toContain(
      '".deleted-inline, .docs-review-del"',
    );
    expect(parentHighlighterScript).not.toContain("innerHTML");
    expect(parentHighlighterScript).not.toContain("insertAdjacentHTML");
    expect(reviewStyles).toContain("ins.docs-review-ins");
    expect(reviewStyles).toContain("del.docs-review-del[hidden]");
    expect(reviewStyles).toContain(".word-diff-panel");
  });

  it("passes word diffs through to the browser with their previous lines", () => {
    const review: ReviewModel = {
      repositoryPath: "/repo",
      baseRef: "main",
      mergeBase: "abc",
      warnings: [],
      files: [{
        ...rootFile,
        blocks: [{
          kind: "modified",
          startLine: 3,
          endLine: 3,
          source: "Kibana might </script> prompt",
          previous: { startLine: 3, endLine: 3, source: "Kibana will prompt" },
          wordDiff: [
            { kind: "equal", text: "Kibana" },
            { kind: "delete", text: "will", spaceBefore: true, spaceAfter: true },
            { kind: "insert", text: "might </script>" },
            { kind: "equal", text: "prompt" },
          ],
        }],
      }],
    };
    const data = createHighlighterData(review);
    expect(data).not.toContain("</script>");
    expect(JSON.parse(data).files[0].blocks[0]).toMatchObject({
      previous: { startLine: 3, endLine: 3 },
      wordDiff: review.files[0].blocks[0].wordDiff,
    });
  });

  it("exports distinct added and modified highlight styles", () => {
    expect(reviewStyles).toContain('[data-docs-review-mark="added"]');
    expect(reviewStyles).toContain('[data-docs-review-mark="modified"]');
    expect(reviewStyles).toContain("#16a34a");
    expect(reviewStyles).toContain("#ca8a04");
  });
});

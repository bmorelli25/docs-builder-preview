import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import type { ReviewModel } from "../src/model.js";
import { startReviewServer } from "../src/server.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

async function cleanup(
  reviewServer: Awaited<ReturnType<typeof startReviewServer>> | undefined,
  upstream: Server,
): Promise<void> {
  const resources = [
    ...(reviewServer
      ? [{ name: "review server", close: () => reviewServer.close() }]
      : []),
    { name: "fake upstream", close: () => close(upstream) },
  ];
  const results = await Promise.allSettled(
    resources.map((resource) => resource.close()),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          new Error(`Failed to close ${resources[index].name}`, {
            cause: result.reason,
          }),
        ]
      : [],
  );
  if (failures.length) {
    throw new AggregateError(failures, "Browser fixture cleanup failed");
  }
}

test("reviews changed pages safely in the integrated dashboard", async ({
  page,
}) => {
  const upstream = createServer((request, response) => {
    if (request.url === "/_static/site.css") {
      response.setHeader("content-type", "text/css");
      response.end("body { color: rgb(12, 34, 56); }");
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("content-security-policy", "style-src 'self'");
    if (request.url === "/guide") {
      response.end(`<!doctype html>
        <html><head><link rel="stylesheet" href="/_static/site.css"></head>
        <body><main><h1>Guide</h1><p>Elastic Agent Builder in Kibana</p></main>
        <script>window.__changedDocsScriptExecuted = true</script>
        <script src="/runtime.js"></script>
        <script type="module" src="/module.js"></script>
        <script type="application/ld+json">{"name":"Guide fixture"}</script>
        </body></html>`);
      return;
    }
    if (request.url === "/fallback") {
      response.end("<html><body><main><p>Fallback page</p></main></body></html>");
      return;
    }
    if (request.url === "/docs/consumer") {
      response.end(
        "<html><body><main><p>Snippet changed text</p></main></body></html>",
      );
      return;
    }
    response.statusCode = 404;
    response.end("missing");
  });
  const upstreamUrl = await listen(upstream);
  const review: ReviewModel = {
    repositoryPath: "/tmp/Repo # 100% ü",
    baseRef: "main",
    mergeBase: "abc",
    substitutions: {
      "agent-builder": "Elastic Agent Builder",
      kib: "Kibana",
    },
    warnings: [],
    files: [
      {
        path: "docs/guide # 100% ü?.md",
        status: "modified",
        route: "/guide",
        addedLines: 1,
        deletedLines: 1,
        blocks: [
          { kind: "added", startLine: 1, endLine: 1, source: "# Guide" },
          {
            kind: "modified",
            startLine: 3,
            endLine: 3,
            source:
              "{{agent-builder}} in {{kib}} {applies_to}`stack: ga 9.1`",
          },
          {
            kind: "modified",
            startLine: 8,
            endLine: 8,
            source: "Not rendered anywhere",
          },
        ],
        deletedHunks: [
          {
            oldStartLine: 4,
            oldEndLine: 4,
            newAnchorLine: 1,
            source: "Deleted near surviving content",
          },
        ],
      },
      {
        path: "docs/fallback.md",
        status: "added",
        route: "/fallback",
        addedLines: 0,
        deletedLines: 2,
        blocks: [],
        deletedHunks: [
          {
            oldStartLine: 1,
            oldEndLine: 2,
            newAnchorLine: 0,
            source: "Deleted without surviving content",
          },
        ],
      },
      {
        path: "docs/_snippets/shared #.md",
        status: "modified",
        route: null,
        consumers: ["docs/consumer.md"],
        addedLines: 1,
        deletedLines: 0,
        blocks: [
          {
            kind: "modified",
            startLine: 4,
            endLine: 4,
            source: "Snippet changed text",
          },
        ],
        deletedHunks: [],
      },
      {
        path: "docs/many.md",
        status: "modified",
        route: "/many",
        addedLines: 5,
        deletedLines: 2,
        blocks: [],
        deletedHunks: [],
      },
      {
        path: "docs/tie.md",
        status: "added",
        route: "/tie",
        addedLines: 3,
        deletedLines: 4,
        blocks: [],
        deletedHunks: [],
      },
    ],
  };
  let reviewServer:
    | Awaited<ReturnType<typeof startReviewServer>>
    | undefined;
  try {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    reviewServer = await startReviewServer({
      review,
      port: 0,
      upstreamUrl,
    });
    await page.goto(reviewServer.url);
    await expect(
      page.getByRole("heading", { name: "Documentation review" }),
    ).toBeVisible();
    const iframe = page.locator('iframe[name="docs-preview"]');
    await expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");
    const hideDeleted = page.getByLabel("Hide deleted lines");
    const pageSort = page.getByLabel("Sort previewable pages");
    const sidebarToggle = page.getByRole("button", {
      name: "Collapse sidebar",
    });
    await expect(hideDeleted).not.toBeChecked();
    await expect(pageSort).toHaveValue("path");
    await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");

    const pageEntries = page.locator(
      '[data-review-group="pages"] > ul > li',
    );
    await expect(pageEntries).toHaveCount(4);
    await expect(
      pageEntries.evaluateAll((entries) =>
        entries.map((entry) => entry.getAttribute("data-lines-changed")),
      ),
    ).resolves.toEqual([
      "2",
      "2",
      "7",
      "7",
    ]);
    await expect(
      pageEntries.locator(".review-link").evaluateAll((links) =>
        links.map((link) => link.getAttribute("data-source-file")),
      ),
    ).resolves.toEqual([
      "docs/fallback.md",
      "docs/guide # 100% ü?.md",
      "docs/many.md",
      "docs/tie.md",
    ]);

    await pageSort.selectOption("lines-changed");
    await expect(
      pageEntries.locator(".review-link").evaluateAll((links) =>
        links.map((link) => link.getAttribute("data-source-file")),
      ),
    ).resolves.toEqual([
      "docs/many.md",
      "docs/tie.md",
      "docs/fallback.md",
      "docs/guide # 100% ü?.md",
    ]);

    await sidebarToggle.focus();
    await page.keyboard.press("Enter");
    const collapsedGuide = page.locator('a[href="/guide"]');
    await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/);
    await expect(page.getByRole("button", { name: "Expand sidebar" }))
      .toHaveAttribute("aria-expanded", "false");
    await expect(collapsedGuide.locator(".file-path")).toBeHidden();
    await expect(collapsedGuide.locator(".status-badge")).toBeVisible();
    await expect(collapsedGuide.locator(".additions")).toBeVisible();
    await expect(collapsedGuide).toHaveAttribute(
      "aria-label",
      "docs/guide # 100% ü?.md, Modified, 1 line added, 1 line deleted",
    );
    await expect(collapsedGuide).toHaveAttribute(
      "title",
      "docs/guide # 100% ü?.md — Modified — +1 −1",
    );
    await page.keyboard.press("Space");

    await page.getByLabel("Search changed files").fill("guide");
    await expect(page.locator('a[href="/guide"]')).toBeVisible();
    await expect(page.locator('a[href="/fallback"]')).toBeHidden();
    await page.getByLabel("Filter files by status").selectOption("modified");
    await expect(page.locator('a[href="/guide"]')).toBeVisible();
    await page.getByLabel("Search changed files").fill("");
    await page.getByLabel("Filter files by status").selectOption("all");

    await page.locator('a[href="/guide"]').click();
    const guide = page.frame({ name: "docs-preview" });
    if (!guide) throw new Error("Preview frame was not created");
    await expect(guide.getByRole("heading", { name: "Guide" })).toBeVisible();
    expect(
      await guide.evaluate(() => window.__changedDocsScriptExecuted),
    ).toBeUndefined();
    expect(
      await guide
        .locator('script[type="application/ld+json"]')
        .evaluate((script) => script.textContent),
    ).toBe('{"name":"Guide fixture"}');
    await expect(guide.locator("script:not([type]), script[type=module]"))
      .toHaveCount(0);
    expect(
      await guide.locator("body").evaluate((body) => getComputedStyle(body).color),
    ).toBe("rgb(12, 34, 56)");
    await expect(guide.locator('[data-docs-review-mark="added"]')).toHaveCount(1);
    await expect(
      guide.locator('[data-docs-review-mark="modified"]'),
    ).toHaveCount(1);
    await expect(
      guide.locator('[data-docs-review-mark="added"]'),
    ).toHaveCSS("background-color", "rgba(34, 197, 94, 0.24)");
    await expect(
      guide.locator('[data-docs-review-mark="added"]'),
    ).toHaveCSS("outline", "rgb(22, 163, 74) solid 2px");
    await expect(
      guide.locator('[data-docs-review-mark="modified"]'),
    ).toHaveCSS("background-color", "rgba(234, 179, 8, 0.27)");
    await expect(
      guide.locator('[data-docs-review-mark="modified"]'),
    ).toHaveCSS("outline", "rgb(202, 138, 4) solid 2px");
    expect(
      consoleErrors.filter((message) =>
        message.includes("Blocked script execution"),
      ),
    ).toEqual([]);
    await expect(page.locator("#mapping-counts")).toHaveText(
      "2 matched · 1 unmatched",
    );
    await expect(
      page.locator('a[href="/guide"] .mapping-status'),
    ).toHaveText("2 matched · 1 unmatched");
    await expect(page.locator("#review-previous")).toBeEnabled();
    await expect(page.locator("#review-next")).toBeEnabled();
    const openSource = page.locator("#open-source");
    await expect(openSource).toHaveAttribute(
      "href",
      "vscode://file/tmp/Repo%20%23%20100%25%20%C3%BC/docs/guide%20%23%20100%25%20%C3%BC%3F.md:1",
    );
    await page.locator("#review-next").click();
    await expect(openSource).toHaveAttribute("href", /:3$/);
    await page.locator("#review-previous").click();
    await expect(openSource).toHaveAttribute("href", /:1$/);
    expect(
      await guide.locator(".deleted-inline").evaluateAll((deletions) =>
        deletions.map((deletion) => ({
          source: deletion.textContent,
          previousMark: deletion.previousElementSibling?.getAttribute(
            "data-docs-review-mark",
          ),
          previousText: deletion.previousElementSibling?.textContent,
        })),
      ),
    ).toEqual([
      {
        source: "Deleted lines 4-4: Deleted near surviving content",
        previousMark: "added",
        previousText: "Guide",
      },
    ]);
    await hideDeleted.check();
    await expect(guide.locator(".deleted-inline")).toBeHidden();
    await hideDeleted.uncheck();
    await expect(guide.locator(".deleted-inline")).toBeVisible();
    await hideDeleted.check();

    await page.locator('a[href="/fallback"]').click();
    await expect(page.locator("#deleted-fallback")).toContainText(
      "Deleted without surviving content",
    );
    await expect(page.locator("#deleted-fallback")).toBeHidden();

    const snippetLink = page.locator(
      'a[data-source-file="docs/_snippets/shared #.md"]',
    );
    await snippetLink.click();
    const snippetFrame = page.frame({ name: "docs-preview" });
    if (!snippetFrame) throw new Error("Snippet frame was not created");
    await expect(
      snippetFrame.locator('[data-docs-review-mark="modified"]'),
    ).toHaveCount(1);
    await expect(snippetLink.locator(".mapping-status")).toHaveText(
      "1 matched · 0 unmatched",
    );

    await page.getByLabel("Search changed files").fill("_snippets");
    await page.getByLabel("Filter files by status").selectOption("modified");
    await pageSort.selectOption("lines-changed");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const reloaded = page.waitForEvent("framenavigated", (frame) => {
      return frame === page.mainFrame();
    });
    let recipients = 0;
    for (let attempts = 0; attempts < 40; attempts++) {
      recipients = reviewServer.refresh();
      if (recipients > 0) break;
      await page.waitForTimeout(25);
    }
    expect(recipients).toBe(1);
    await reloaded;
    await expect(page.getByLabel("Search changed files")).toHaveValue(
      "_snippets",
    );
    await expect(page.getByLabel("Filter files by status")).toHaveValue(
      "modified",
    );
    await expect(page.getByLabel("Hide deleted lines")).toBeChecked();
    await expect(page.getByLabel("Sort previewable pages")).toHaveValue(
      "lines-changed",
    );
    await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/);
    await expect(page.getByRole("button", { name: "Expand sidebar" }))
      .toHaveAttribute("aria-expanded", "false");
    const restoredSnippet = page.locator(
      'a[data-source-file="docs/_snippets/shared #.md"]',
    );
    await expect(restoredSnippet).toHaveAttribute("aria-current", "page");
    await expect(
      page.frameLocator('iframe[name="docs-preview"]').locator(
        '[data-docs-review-mark="modified"]',
      ),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await page.getByLabel("Search changed files").fill("");
    await page.locator('a[href="/guide"]').click();
    await expect(
      page.frameLocator('iframe[name="docs-preview"]').locator(
        ".deleted-inline",
      ),
    ).toBeHidden();
  } finally {
    await cleanup(reviewServer, upstream);
  }
});

test("follows docs navigation inside the preview", async ({ page }) => {
  const filler = Array.from(
    { length: 40 },
    (_, index) => `<li><a href="/filler/${index}" class="nav-link">Filler ${index}</a></li>`,
  ).join("");
  const nav = `<nav id="pages-nav">
    <div class="sticky"><a class="pages-dropdown_active" href="/">Docs</a></div>
    <ul>${filler}
      <li class="nav-folder">
        <div class="peer"><a href="/guide" class="nav-folder-link">Guide</a>
          <label for="F-guide"><input id="F-guide" type="checkbox" class="hidden"></label></div>
        <ul class="nav-subtree">
          <li><a href="/guide/second" class="nav-link">Second page</a></li>
          <li><a href="/guide/third" class="nav-link">Third page</a></li>
          <li><a href="/guide/plain" class="nav-link">Plain page</a></li>
        </ul>
      </li>
    </ul>
  </nav>`;
  const body: Record<string, string> = {
    "/": "<main><h1>Docs home</h1></main>",
    "/?preview=1": "<main><h1>Docs home</h1></main>",
    "/guide/second": "<main><h1>Second page</h1><p>Second changed sentence</p></main>",
    "/guide/third": "<main><h1>Third page</h1><p>Third changed sentence</p></main>",
    "/guide/plain": "<main><h1>Plain page</h1><p>Second changed sentence</p></main>",
  };
  const upstream = createServer((request, response) => {
    if (request.url === "/_static/site.css") {
      response.setHeader("content-type", "text/css");
      response.end(`
        #pages-nav { height: 240px; overflow-y: auto; }
        .nav-subtree, .hidden { display: none; }
        .peer:has(:checked) ~ .nav-subtree { display: block; }
        #pages-nav .current { color: rgb(11, 100, 217); }
      `);
      return;
    }
    const content = body[request.url ?? ""];
    if (!content) {
      response.statusCode = 404;
      response.end("missing");
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><head>
      <link rel="stylesheet" href="/_static/site.css"></head>
      <body hx-boost="true">${nav}${content}
      <script>window.__docsNavScriptExecuted = true</script></body></html>`);
  });
  const upstreamUrl = await listen(upstream);
  const changed = (name: string, text: string): ReviewModel["files"][number] => ({
    path: `docs/guide/${name}.md`,
    status: "modified",
    route: `/guide/${name}`,
    addedLines: 1,
    deletedLines: 0,
    blocks: [{ kind: "added", startLine: 3, endLine: 3, source: text }],
    deletedHunks: [],
  });
  const review: ReviewModel = {
    repositoryPath: "/tmp/repo",
    baseRef: "main",
    mergeBase: "abc",
    warnings: [],
    files: [
      changed("second", "Second changed sentence"),
      changed("third", "Third changed sentence"),
    ],
  };
  let reviewServer:
    | Awaited<ReturnType<typeof startReviewServer>>
    | undefined;
  try {
    reviewServer = await startReviewServer({ review, port: 0, upstreamUrl });
    await page.goto(reviewServer.url);
    const preview = page.frameLocator('iframe[name="docs-preview"]');
    const previewUrl = () =>
      page.locator('iframe[name="docs-preview"]').evaluate((frame) => {
        const location = (frame as HTMLIFrameElement).contentWindow!.location;
        return location.pathname + location.search;
      });
    const selected = page.locator('.review-link[aria-current="page"]');

    await page.locator('.review-link[href="/guide/second"]').click();
    const second = preview.locator('#pages-nav a[href="/guide/second"]');
    await expect(second).toBeVisible();
    await expect(second).toHaveClass(/\bcurrent\b/);
    await expect(second).toHaveCSS("color", "rgb(11, 100, 217)");
    await expect(preview.locator("#F-guide")).toBeChecked();
    await expect(second).toBeInViewport();
    expect(
      await preview.locator("#pages-nav").evaluate((nav) => nav.scrollTop),
    ).toBeGreaterThan(0);
    await expect(
      preview.locator('[data-docs-review-mark="added"]'),
    ).toHaveText("Second changed sentence");

    await preview.locator('#pages-nav a[href="/guide/third"]').click();
    await expect(preview.getByRole("heading", { name: "Third page" })).toBeVisible();
    expect(await previewUrl()).toBe("/guide/third");
    await expect(selected).toHaveAttribute("href", "/guide/third");
    await expect(
      preview.locator('#pages-nav a[href="/guide/third"]'),
    ).toHaveClass(/\bcurrent\b/);
    await expect(
      preview.locator('[data-docs-review-mark="added"]'),
    ).toHaveText("Third changed sentence");
    await expect(page.locator("#mapping-counts")).toHaveText(
      "1 matched · 0 unmatched",
    );
    await expect(
      page.locator('.review-link[href="/guide/third"] .mapping-status'),
    ).toHaveText("1 matched · 0 unmatched");

    await preview.locator('#pages-nav a[href="/guide/plain"]').click();
    await expect(preview.getByRole("heading", { name: "Plain page" })).toBeVisible();
    await expect(selected).toHaveCount(0);
    await expect(page.locator("#preview-toolbar")).toBeHidden();
    await expect(preview.locator("[data-docs-review-mark]")).toHaveCount(0);
    await expect(
      preview.locator('#pages-nav a[href="/guide/plain"]'),
    ).toHaveClass(/\bcurrent\b/);

    await preview.locator("#pages-nav a.pages-dropdown_active").click();
    await expect(preview.getByRole("heading", { name: "Docs home" })).toBeVisible();
    expect(await previewUrl()).toBe("/?preview=1");

    await page.reload();
    await expect(preview.getByRole("heading", { name: "Docs home" })).toBeVisible();
    await expect(page.locator(".preview-empty")).toBeHidden();
    expect(
      await page
        .frame({ name: "docs-preview" })!
        .evaluate(() => window.__docsNavScriptExecuted),
    ).toBeUndefined();
  } finally {
    await cleanup(reviewServer, upstream);
  }
});

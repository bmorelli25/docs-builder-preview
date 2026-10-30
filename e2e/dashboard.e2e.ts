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

    await page.locator('a[href="/fallback"]').click();
    await expect(page.locator("#deleted-fallback")).toContainText(
      "Deleted without surviving content",
    );

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
    const restoredSnippet = page.locator(
      'a[data-source-file="docs/_snippets/shared #.md"]',
    );
    await expect(restoredSnippet).toHaveAttribute("aria-current", "page");
    await expect(
      page.frameLocator('iframe[name="docs-preview"]').locator(
        '[data-docs-review-mark="modified"]',
      ),
    ).toHaveCount(1);
  } finally {
    await cleanup(reviewServer, upstream);
  }
});

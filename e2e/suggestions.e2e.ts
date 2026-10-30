import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { startReviewServer, type RunningServer } from "../src/server.js";
import type { SourceLocator } from "../src/source-locate.js";

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

const pageFile = (path: string, route: string): ChangedFile => ({
  path,
  status: "modified",
  route,
  addedLines: 1,
  deletedLines: 0,
  blocks: [],
  deletedHunks: [],
});

const review: ReviewModel = {
  repositoryPath: "/tmp/docs-content",
  baseRef: "main",
  mergeBase: "abc",
  warnings: [],
  files: [pageFile("docs/guide.md", "/guide")],
};

const locator: SourceLocator = {
  rebuild: async () => undefined,
  fileForRoute: () => "docs/guide.md",
  locate: async (_route, quote) => ({
    path: "docs/guide.md",
    startLine: 3,
    endLine: 3,
    source: quote.exact,
    heading: "Guide",
    exact: quote.exact,
    found: true,
  }),
};

test("creates, persists, and exports inline edit suggestions", async ({
  page: browserPage,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const upstream = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><body><main>
      <h1>Guide</h1>
      <p id="target">Kibana might prompt you to switch when ready.</p>
    </main></body></html>`);
  });
  const upstreamUrl = await listen(upstream);
  const storageDir = await mkdtemp(join(tmpdir(), "suggestions-e2e-"));
  const servers: RunningServer[] = [];
  try {
    const server = await startReviewServer({
      review,
      port: 0,
      upstreamUrl,
      suggestions: {
        branch: "docs/feature",
        locator,
        storageDir,
      },
    });
    servers.push(server);
    await browserPage.goto(server.url);
    await browserPage.locator('a[href="/guide"]').click();
    const frame = browserPage.frameLocator('iframe[name="docs-preview"]');
    await expect(frame.locator("#target")).toBeVisible();

    await frame.locator("#target").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const editor = browserPage.locator("#suggestion-editor");
    await expect(editor).toBeVisible();
    const textarea = browserPage.locator("#suggestion-editor-text");
    await expect(textarea).toHaveValue(
      "Kibana might prompt you to switch when ready.",
    );
    await textarea.fill("Kibana prompts you to switch when ready.");
    await browserPage.locator("#suggestion-editor-save").click();
    await expect(editor).toBeHidden();
    await expect(browserPage.locator("#suggestions-count")).toHaveText(
      "1 suggestion",
    );
    await expect(
      frame.locator('[data-suggestion-mark]'),
    ).toHaveCount(1);

    await browserPage.reload();
    await browserPage.locator('a[href="/guide"]').click();
    await expect(browserPage.locator("#suggestions-count")).toHaveText(
      "1 suggestion",
    );
    await expect(
      browserPage.frameLocator('iframe[name="docs-preview"]').locator("[data-suggestion-mark]"),
    ).toHaveCount(1);

    await browserPage.locator("#suggestions-copy-all").click();
    await expect
      .poll(async () => browserPage.evaluate(() => navigator.clipboard.readText()))
      .toContain("Type: Replace");
    await expect
      .poll(async () => browserPage.evaluate(() => navigator.clipboard.readText()))
      .toContain("Kibana prompts you to switch when ready.");

    browserPage.once("dialog", (dialog) => dialog.accept());
    await browserPage.locator("#suggestions-clear-all").click();
    await expect(browserPage.locator("#suggestions-count")).toHaveText(
      "0 suggestions",
    );

    await browserPage
      .frameLocator('iframe[name="docs-preview"]')
      .locator("#target")
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    await expect(editor).toBeVisible();
    await textarea.fill("Make this sentence shorter.");
    await editor.getByText("Instruction", { exact: true }).click();
    await expect(editor).toBeVisible();
    await textarea.press("Control+Enter");
    await expect(editor).toBeHidden();
    await expect(browserPage.locator(".suggestion-item-kind")).toHaveText(
      "Instruction",
    );
    await expect(browserPage.locator("#suggestions-count")).toHaveText(
      "1 suggestion",
    );

    // Escape cancels without saving.
    browserPage.once("dialog", (dialog) => dialog.accept());
    await browserPage.locator("#suggestions-clear-all").click();
    await expect(browserPage.locator("#suggestions-count")).toHaveText(
      "0 suggestions",
    );
    await browserPage.waitForTimeout(600);
    await browserPage
      .frameLocator('iframe[name="docs-preview"]')
      .locator("#target")
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    await expect(editor).toBeVisible();
    await textarea.fill("This should be discarded.");
    await textarea.press("Escape");
    await expect(editor).toBeHidden();
    await expect(browserPage.locator("#suggestions-count")).toHaveText(
      "0 suggestions",
    );
  } finally {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await close(upstream);
  }
});

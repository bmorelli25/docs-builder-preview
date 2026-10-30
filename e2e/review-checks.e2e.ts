import { createServer, type Server } from "node:http";

import { expect, test, type Page } from "@playwright/test";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { startReviewServer, type RunningServer } from "../src/server.js";

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

const page = (path: string, route: string): ChangedFile => ({
  path,
  status: "modified",
  route,
  addedLines: 3,
  deletedLines: 1,
  blocks: [],
  deletedHunks: [],
});

const review: ReviewModel = {
  repositoryPath: "/tmp/repo",
  baseRef: "main",
  mergeBase: "abc",
  warnings: [],
  files: [
    page("docs/guide.md", "/guide"),
    { ...page("docs/fallback.md", "/fallback"), status: "added" },
    page("docs/tutorial.md", "/tutorial"),
    {
      ...page("docs/_snippets/shared.md", "/unused"),
      route: null,
      consumers: ["docs/guide.md"],
    },
  ],
};

async function refreshDashboard(browserPage: Page, server: RunningServer) {
  const reloaded = browserPage.waitForEvent(
    "framenavigated",
    (frame) => frame === browserPage.mainFrame(),
  );
  let recipients = 0;
  for (let attempts = 0; attempts < 40 && recipients === 0; attempts++) {
    recipients = server.refresh();
    if (recipients === 0) await browserPage.waitForTimeout(25);
  }
  expect(recipients).toBe(1);
  await reloaded;
}

test("checks off reviewed pages in server memory only", async ({
  page: browserPage,
  context,
}) => {
  const upstream = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<html><body><main><p>${request.url}</p></main></body></html>`);
  });
  const upstreamUrl = await listen(upstream);
  const servers: RunningServer[] = [];
  try {
    const server = await startReviewServer({ review, port: 0, upstreamUrl });
    servers.push(server);
    await browserPage.goto(server.url);

    const progress = browserPage.locator("#review-progress-count");
    const clear = browserPage.getByRole("button", { name: "Clear checks" });
    const guideCheck = browserPage.getByRole("checkbox", {
      name: "Mark docs/guide.md as reviewed",
    });
    const tutorialCheck = browserPage.getByRole("checkbox", {
      name: "Mark docs/tutorial.md as reviewed",
    });
    const guideCard = browserPage.locator(
      'li[data-review-check-item]:has(a[href="/guide"])',
    );
    const guideLink = browserPage.locator('a[href="/guide"]');
    const iframe = browserPage.locator('iframe[name="docs-preview"]');

    await expect(progress).toHaveText("0 of 3 reviewed");
    await expect(clear).toBeDisabled();
    await expect(browserPage.getByRole("checkbox")).toHaveCount(3);

    await guideCheck.check();
    await expect(progress).toHaveText("1 of 3 reviewed");
    await expect(clear).toBeEnabled();
    await expect(guideCard).toHaveAttribute("data-reviewed", "true");
    await expect(guideCard).toContainText("docs/guide.md");
    await expect(guideLink).not.toHaveAttribute("aria-current", "page");
    await expect(iframe).not.toHaveAttribute("src", /.*/);

    await tutorialCheck.focus();
    await browserPage.keyboard.press("Space");
    await expect(tutorialCheck).toBeChecked();
    await expect(progress).toHaveText("2 of 3 reviewed");

    await guideLink.click();
    await expect(guideLink).toHaveAttribute("aria-current", "page");
    await expect(iframe).toHaveAttribute("src", "/guide");
    await expect(guideCheck).toBeChecked();

    await browserPage.reload();
    await expect(guideCheck).toBeChecked();
    await expect(tutorialCheck).toBeChecked();
    await expect(progress).toHaveText("2 of 3 reviewed");

    server.setReview({
      ...review,
      files: review.files.filter((file) => file.path !== "docs/tutorial.md"),
    });
    await refreshDashboard(browserPage, server);
    await expect(guideCheck).toBeChecked();
    await expect(tutorialCheck).toHaveCount(0);
    await expect(progress).toHaveText("1 of 2 reviewed");
    server.setReview(review);
    await refreshDashboard(browserPage, server);
    await expect(tutorialCheck).not.toBeChecked();
    await expect(progress).toHaveText("1 of 3 reviewed");

    await clear.click();
    await expect(progress).toHaveText("0 of 3 reviewed");
    await expect(guideCheck).not.toBeChecked();
    await expect(clear).toBeDisabled();
    await browserPage.reload();
    await expect(progress).toHaveText("0 of 3 reviewed");
    await expect(guideCheck).not.toBeChecked();

    await guideCheck.check();
    await expect(progress).toHaveText("1 of 3 reviewed");
    expect(await context.cookies()).toEqual([]);
    const storage = await browserPage.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(storage).not.toContain("guide.md");

    await server.close();
    const restarted = await startReviewServer({
      review,
      port: 0,
      upstreamUrl,
    });
    servers.push(restarted);
    await browserPage.goto(restarted.url);
    await expect(progress).toHaveText("0 of 3 reviewed");
    await expect(guideCheck).not.toBeChecked();
  } finally {
    await Promise.allSettled(servers.map((server) => server.close()));
    await close(upstream);
  }
});

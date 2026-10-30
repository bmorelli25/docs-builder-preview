import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { ChangedFile, ReviewModel } from "../src/model.js";
import { MAX_REVIEW_CHECK_BODY_BYTES } from "../src/review-checks.js";
import { startReviewServer, type RunningServer } from "../src/server.js";

const running: RunningServer[] = [];

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
  mergeBase: "abc123",
  warnings: [],
  files: [
    page("docs/guide.md", "/docs/guide"),
    page("docs/tutorial.md", "/docs/tutorial"),
    { ...page("docs/removed.md", "/docs/removed"), status: "deleted" },
    {
      ...page("docs/_snippets/shared.md", "/unused"),
      route: null,
      consumers: ["docs/guide.md"],
    },
  ],
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

async function start(model: ReviewModel = review): Promise<RunningServer> {
  const server = await startReviewServer({ review: model, port: 0 });
  running.push(server);
  return server;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function raw(
  server: RunningServer,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: server.host,
        port: server.port,
        method: options.method ?? "POST",
        path: options.path ?? "/api/review-checks",
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(options.body);
  });
}

function postJson(
  server: RunningServer,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return raw(server, {
    path,
    headers: {
      "content-type": "application/json",
      origin: server.url,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const setReviewed = (
  server: RunningServer,
  path: string,
  reviewed: boolean,
  headers?: Record<string, string>,
) => postJson(server, "/api/review-checks", { path, reviewed }, headers);

async function state(server: RunningServer) {
  const response = await fetch(`${server.url}/api/review-checks`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}

describe("review check endpoints", () => {
  it("starts empty and counts only previewable pages", async () => {
    const server = await start();
    expect(await state(server)).toEqual({ reviewed: [], total: 2 });
  });

  it("checks and unchecks a previewable page", async () => {
    const server = await start();

    const checked = await setReviewed(server, "docs/tutorial.md", true);
    expect(checked.status).toBe(200);
    expect(JSON.parse(checked.body)).toEqual({
      reviewed: ["docs/tutorial.md"],
      total: 2,
    });
    expect(checked.headers["set-cookie"]).toBeUndefined();
    await setReviewed(server, "docs/guide.md", true);
    expect((await state(server)).reviewed).toEqual([
      "docs/guide.md",
      "docs/tutorial.md",
    ]);

    const dashboard = await fetch(server.url).then((response) => response.text());
    expect(dashboard).toContain(
      'data-review-check="docs/guide.md" aria-label="Mark docs/guide.md as reviewed" checked',
    );
    expect(dashboard).toContain("2 of 2 reviewed");

    const unchecked = await setReviewed(server, "docs/guide.md", false);
    expect(JSON.parse(unchecked.body).reviewed).toEqual(["docs/tutorial.md"]);
  });

  it("clears every check", async () => {
    const server = await start();
    await setReviewed(server, "docs/guide.md", true);
    await setReviewed(server, "docs/tutorial.md", true);

    const cleared = await postJson(server, "/api/review-checks/clear", {});
    expect(cleared.status).toBe(200);
    expect(JSON.parse(cleared.body)).toEqual({ reviewed: [], total: 2 });
    expect(await state(server)).toEqual({ reviewed: [], total: 2 });
  });

  it("rejects paths that are not current previewable pages", async () => {
    const server = await start();
    for (const path of [
      "docs/unknown.md",
      "docs/removed.md",
      "docs/_snippets/shared.md",
      "",
    ]) {
      const response = await setReviewed(server, path, true);
      expect(response.status, path).toBe(400);
      expect(JSON.parse(response.body).error).toBe("Not a previewable page");
    }
    expect((await state(server)).reviewed).toEqual([]);
  });

  it("rejects malformed bodies", async () => {
    const server = await start();
    for (const body of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ path: "docs/guide.md" }),
      JSON.stringify({ path: "docs/guide.md", reviewed: "yes" }),
      JSON.stringify({ path: ["docs/guide.md"], reviewed: true }),
    ]) {
      const response = await postJson(server, "/api/review-checks", body);
      expect(response.status, body).toBe(400);
    }
    expect((await postJson(server, "/api/review-checks/clear", "[]")).status)
      .toBe(400);
  });

  it("rejects cross-origin mutations and accepts same-origin or no Origin", async () => {
    const server = await start();
    for (const origin of [
      "https://evil.example",
      "null",
      `http://127.0.0.1:${server.port + 1}`,
      `https://127.0.0.1:${server.port}`,
      `http://localhost:${server.port}`,
    ]) {
      const toggle = await setReviewed(server, "docs/guide.md", true, { origin });
      expect(toggle.status, origin).toBe(403);
      await setReviewed(server, "docs/tutorial.md", true);
      const clear = await postJson(
        server,
        "/api/review-checks/clear",
        {},
        { origin },
      );
      expect(clear.status, origin).toBe(403);
    }
    expect((await state(server)).reviewed).toEqual(["docs/tutorial.md"]);

    const localhost = await raw(server, {
      headers: {
        host: `localhost:${server.port}`,
        origin: `http://localhost:${server.port}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: "docs/guide.md", reviewed: true }),
    });
    expect(localhost.status).toBe(200);

    const withoutOrigin = await raw(server, {
      path: "/api/review-checks/clear",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(withoutOrigin.status).toBe(200);
  });

  it("requires a JSON content type for mutations", async () => {
    const server = await start();
    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/jsonp",
      undefined,
    ]) {
      const headers: Record<string, string> = { origin: server.url };
      if (contentType) headers["content-type"] = contentType;
      const body = JSON.stringify({ path: "docs/guide.md", reviewed: true });
      const toggle = await raw(server, { headers, body });
      expect(toggle.status, String(contentType)).toBe(415);
      const clear = await raw(server, {
        path: "/api/review-checks/clear",
        headers,
        body: "{}",
      });
      expect(clear.status, String(contentType)).toBe(415);
    }
    expect(
      (
        await setReviewed(server, "docs/guide.md", true, {
          "content-type": "Application/JSON; charset=utf-8",
        })
      ).status,
    ).toBe(200);
  });

  it("bounds the request body", async () => {
    const server = await start();
    const padding = "x".repeat(MAX_REVIEW_CHECK_BODY_BYTES);
    const declared = await postJson(server, "/api/review-checks", {
      path: "docs/guide.md",
      reviewed: true,
      padding,
    });
    expect(declared.status).toBe(413);

    const chunked = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: server.host,
          port: server.port,
          method: "POST",
          path: "/api/review-checks",
          headers: {
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.once("error", reject);
      request.write(`{"padding":"${padding}`);
      request.end(`${padding}"}`);
    });
    expect(chunked).toBe(413);
    expect((await state(server)).reviewed).toEqual([]);
  });

  it("allows only the documented methods", async () => {
    const server = await start();
    const put = await raw(server, { method: "PUT", body: "{}" });
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe("GET, HEAD, POST");
    const getClear = await raw(server, {
      method: "GET",
      path: "/api/review-checks/clear",
    });
    expect(getClear.status).toBe(405);
    expect(getClear.headers.allow).toBe("POST");
  });

  it("keeps Host validation in front of the endpoints", async () => {
    const server = await start();
    for (const host of ["evil.example", `127.0.0.1:${server.port + 1}`]) {
      const response = await raw(server, {
        headers: {
          host,
          origin: `http://${host}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ path: "docs/guide.md", reviewed: true }),
      });
      expect(response.status, host).toBe(400);
    }
    expect((await state(server)).reviewed).toEqual([]);
  });

  it("keeps checks in memory per server instance", async () => {
    const first = await start();
    await setReviewed(first, "docs/guide.md", true);
    expect((await state(first)).reviewed).toEqual(["docs/guide.md"]);
    await first.close();
    running.splice(running.indexOf(first), 1);

    const second = await start();
    expect(await state(second)).toEqual({ reviewed: [], total: 2 });
    const dashboard = await fetch(second.url).then((response) => response.text());
    expect(dashboard).toContain("0 of 2 reviewed");
    expect(dashboard).not.toMatch(/data-review-check="[^"]*"[^>]* checked/);
  });

  it("drops checks for pages that leave the changed set", async () => {
    const server = await start();
    await setReviewed(server, "docs/guide.md", true);
    await setReviewed(server, "docs/tutorial.md", true);

    server.setReview({
      ...review,
      files: review.files.filter((file) => file.path !== "docs/guide.md"),
    });
    expect(await state(server)).toEqual({
      reviewed: ["docs/tutorial.md"],
      total: 1,
    });
    expect((await setReviewed(server, "docs/guide.md", true)).status).toBe(400);

    server.setReview({
      ...review,
      files: review.files.map((file) =>
        file.path === "docs/tutorial.md"
          ? { ...file, status: "deleted" as const }
          : file,
      ),
    });
    expect(await state(server)).toEqual({ reviewed: [], total: 1 });

    server.setReview(review);
    expect(await state(server)).toEqual({ reviewed: [], total: 2 });
  });
});

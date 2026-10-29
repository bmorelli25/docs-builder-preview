import {
  createServer,
  request as httpRequest,
  type Server,
} from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { ReviewModel } from "../src/model.js";
import { startReviewServer, type RunningServer } from "../src/server.js";

const running: Array<{ close(): Promise<void> }> = [];

const review: ReviewModel = {
  repositoryPath: "/tmp/docs",
  baseRef: "main",
  mergeBase: "abc123",
  warnings: [],
  files: [
    {
      path: "guide.md",
      status: "modified",
      route: "/guide",
      addedLines: 2,
      deletedLines: 1,
      blocks: [
        {
          kind: "added",
          startLine: 3,
          endLine: 3,
          source: "New exact sentence.",
        },
        {
          kind: "modified",
          startLine: 7,
          endLine: 8,
          source: "A changed token sequence",
        },
      ],
      deletedHunks: [
        {
          oldStartLine: 4,
          oldEndLine: 4,
          source: "Removed sentence",
        },
      ],
    },
  ],
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

async function fakeUpstream(): Promise<{
  server: Server;
  url: string;
  requests: string[];
  close(): Promise<void>;
}> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/guide" || request.url === "/docs/guide") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<!doctype html><html><body><main>Guide</main></body></html>");
      return;
    }
    if (request.url === "/events") {
      response.setHeader("content-type", "text/event-stream");
      response.write("data: ready\n\n");
      return;
    }
    response.setHeader("content-type", "text/css");
    response.end("body{color:navy}");
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  const handle = {
    server,
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close,
  };
  running.push(handle);
  return handle;
}

async function start(upstreamUrl: string): Promise<RunningServer> {
  const server = await startReviewServer({
    review,
    port: 0,
    upstreamUrl,
  });
  running.push(server);
  return server;
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
): Promise<string> {
  let received = "";
  while (!received.includes(expected)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += new TextDecoder().decode(chunk.value);
  }
  return received;
}

describe("startReviewServer", () => {
  it("serves the dashboard and review API on localhost", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    expect(server.host).toBe("127.0.0.1");
    const dashboard = await fetch(server.url);
    expect(dashboard.status).toBe(200);
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain("guide.md");
    expect(dashboardHtml).toContain(
      '<iframe name="docs-preview" title="Documentation preview"',
    );
    expect(dashboardHtml).toContain('target="docs-preview"');
    expect(dashboardHtml).toContain('id="review-search"');
    expect(dashboardHtml).toContain('id="status-filter"');

    const api = await fetch(`${server.url}/api/review`);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect(await api.json()).toEqual(review);
  });

  it("proxies assets and injects testable highlighter assets into HTML", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    const asset = await fetch(`${server.url}/_static/site.css?theme=dark`);
    expect(await asset.text()).toBe("body{color:navy}");
    expect(upstream.requests).toContain("/_static/site.css?theme=dark");

    const page = await fetch(`${server.url}/guide`);
    const html = await page.text();
    expect(html).toContain("<main>Guide</main>");
    expect(html).toContain("data-docs-review-styles");
    expect(html).toContain("data-docs-review-highlighter");
    expect(html.indexOf("data-docs-review-highlighter")).toBeLessThan(
      html.indexOf("</body>"),
    );
    expect(html).toContain("Unmatched");
    expect(html).toContain("Removed sentence");
  });

  it("uses a validated snippet selector to highlight included content", async () => {
    const upstream = await fakeUpstream();
    const snippetReview: ReviewModel = {
      ...review,
      files: [
        {
          path: "docs/_snippets/shared.md",
          status: "modified",
          route: null,
          consumers: ["docs/guide.md"],
          addedLines: 1,
          deletedLines: 0,
          blocks: [
            {
              kind: "modified",
              startLine: 1,
              endLine: 1,
              source: "Changed included text.",
            },
          ],
          deletedHunks: [],
        },
      ],
    };
    const server = await startReviewServer({
      review: snippetReview,
      port: 0,
      upstreamUrl: upstream.url,
    });
    running.push(server);

    const dashboard = await fetch(server.url).then((response) => response.text());
    expect(dashboard).toContain(
      'href="/docs/guide?review-source=docs%2F_snippets%2Fshared.md"',
    );

    const page = await fetch(
      `${server.url}/docs/guide?review-source=docs%2F_snippets%2Fshared.md`,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Changed included text.");
    expect(upstream.requests).toContain("/docs/guide");
  });

  it("rejects unknown or unrelated review-source selectors", async () => {
    const upstream = await fakeUpstream();
    const snippetReview: ReviewModel = {
      ...review,
      files: [
        {
          path: "docs/_snippets/shared.md",
          status: "modified",
          route: null,
          consumers: ["docs/guide.md"],
          addedLines: 1,
          deletedLines: 0,
          blocks: [],
          deletedHunks: [],
        },
      ],
    };
    const server = await startReviewServer({
      review: snippetReview,
      port: 0,
      upstreamUrl: upstream.url,
    });
    running.push(server);

    for (const path of [
      "/docs/guide?review-source=docs%2F_snippets%2Funknown.md",
      "/other?review-source=docs%2F_snippets%2Fshared.md",
    ]) {
      expect(await fetch(`${server.url}${path}`)).toHaveProperty("status", 400);
    }
    expect(upstream.requests).toEqual([]);
  });

  it("rejects traversal and authority-confusion request targets", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    const rawStatus = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            host: server.host,
            port: server.port,
            path,
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode ?? 0));
          },
        );
        request.once("error", reject);
        request.end();
      });
    for (const path of [
      "/%2e%2e/secret",
      "/..%2fsecret",
      "/%2F%2Fevil.example/",
      "//evil.example/",
    ]) {
      expect(await rawStatus(path), path).toBe(400);
    }
    expect(upstream.requests).toEqual([]);
  });

  it("streams upstream SSE without buffering or HTML injection", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    const response = await fetch(`${server.url}/events`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(chunk.value)).toBe("data: ready\n\n");
  });

  it("owns an SSE endpoint and broadcasts refresh events", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);
    const response = await fetch(`${server.url}/api/events`);
    const reader = response.body!.getReader();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await readUntil(reader, "event: connected")).toContain(
      "event: connected\ndata: {}\n\n",
    );
    expect(upstream.requests).toEqual([]);

    expect(server.broadcast("review", { changed: true })).toBe(1);
    expect(await readUntil(reader, "event: review")).toContain(
      'event: review\ndata: {"changed":true}\n\n',
    );

    expect(server.refresh()).toBe(1);
    expect(await readUntil(reader, "event: refresh")).toContain(
      "event: refresh\ndata: {}\n\n",
    );

    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.broadcast("review")).toBe(0);
  });

  it("ends app-owned SSE clients during shutdown", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);
    const response = await fetch(`${server.url}/api/events`);
    const reader = response.body!.getReader();
    await readUntil(reader, "event: connected");

    await server.close();

    const result = await reader.read();
    expect(result.done).toBe(true);
    expect(server.broadcast("review")).toBe(0);
  });

  it("closes promptly with an active SSE connection", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);
    const response = await fetch(`${server.url}/events`);
    const reader = response.body!.getReader();
    await reader.read();

    const result = await Promise.race([
      server.close().then(() => "closed"),
      new Promise<"timed-out">((resolve) =>
        setTimeout(() => resolve("timed-out"), 250),
      ),
    ]);
    await reader.cancel();
    expect(result).toBe("closed");
  });

  it("stops only the docs-builder process it owns", async () => {
    const upstream = await fakeUpstream();
    let ownedStops = 0;
    const owned = await startReviewServer({
      review,
      port: 0,
      docsBuilder: {
        url: upstream.url,
        port: Number(new URL(upstream.url).port),
        owned: true,
        stop: async () => {
          ownedStops++;
        },
      },
    });
    await owned.close();
    expect(ownedStops).toBe(1);

    let reusedStops = 0;
    const reused = await startReviewServer({
      review,
      port: 0,
      docsBuilder: {
        url: upstream.url,
        port: Number(new URL(upstream.url).port),
        owned: false,
        stop: async () => {
          reusedStops++;
        },
      },
    });
    await reused.close();
    expect(reusedStops).toBe(0);
  });

  it("closes the server when owned docs-builder cleanup fails and retries that cleanup", async () => {
    const upstream = await fakeUpstream();
    let stops = 0;
    const server = await startReviewServer({
      review,
      port: 0,
      docsBuilder: {
        url: upstream.url,
        port: Number(new URL(upstream.url).port),
        owned: true,
        stop: async () => {
          stops++;
          if (stops === 1) throw new Error("stop failed");
        },
      },
    });

    await expect(server.close()).rejects.toThrow(/docs-builder/);
    await expect(fetch(server.url)).rejects.toThrow();
    expect(stops).toBe(1);

    await server.close();
    expect(stops).toBe(2);
  });

  it("stops an owned docs-builder when upstream validation fails", async () => {
    let stops = 0;

    await expect(
      startReviewServer({
        review,
        port: 0,
        docsBuilder: {
          url: "http://example.com:8080",
          port: 8080,
          owned: true,
          stop: async () => {
            stops++;
          },
        },
      }),
    ).rejects.toThrow(/localhost/);
    expect(stops).toBe(1);
  });
});

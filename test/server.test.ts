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
    if (request.url === "/guide") {
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

describe("startReviewServer", () => {
  it("serves the dashboard and review API on localhost", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    expect(server.host).toBe("127.0.0.1");
    const dashboard = await fetch(server.url);
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toContain("guide.md");

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

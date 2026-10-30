import {
  createServer,
  request as httpRequest,
  type Server,
} from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { ReviewModel } from "../src/model.js";
import {
  isAllowedHostAuthority,
  startReviewServer,
  type RunningServer,
} from "../src/server.js";

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
          newAnchorLine: 3,
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
      response.setHeader("content-security-policy", "style-src 'self'");
      const html = [
        "<!doctype html><html><body><main>Guide</main>",
        '<script>window.__maliciousDocsScript = true</script>',
        '<script src="/normal.js"></script>',
        '<script type="module" src="/module.js"></script>',
        '<script type="application/x-javascript">legacy()</script>',
        '<script type="application/ld+json">{"name":"Guide"}</script>',
        '<script type="application/json">{"fixture":true}</script>',
        "</body></html>",
      ].join("");
      response.setHeader("content-length", Buffer.byteLength(html));
      response.end(html);
      return;
    }
    if (request.url === "/events") {
      response.setHeader("content-type", "text/event-stream");
      response.write("data: ready\n\n");
      return;
    }
    if (request.url === "/data.json") {
      response.setHeader("content-type", "application/json");
      response.setHeader("content-length", "16");
      response.end('{"script":"raw"}');
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
  it("accepts omitted loopback Host ports only for HTTP port 80", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      expect(isAllowedHostAuthority(host, 80), host).toBe(true);
      expect(isAllowedHostAuthority(`${host}:80`, 80), `${host}:80`).toBe(
        true,
      );
      expect(isAllowedHostAuthority(host, 4173), `${host} without port`).toBe(
        false,
      );
      expect(
        isAllowedHostAuthority(`${host}:4173`, 4173),
        `${host}:4173`,
      ).toBe(true);
    }
  });

  it("serves startup and failure status before docs-builder is available", async () => {
    const server = await startReviewServer({ review, port: 0 });
    running.push(server);

    const starting = await fetch(server.url).then((response) => response.text());
    expect(starting).toContain("Starting docs-builder");
    const unavailable = await fetch(`${server.url}/guide`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toContain("docs-builder is starting");

    const events = await fetch(`${server.url}/api/events`);
    const reader = events.body!.getReader();
    await readUntil(reader, "event: connected");
    server.setDocsBuilderStatus({
      state: "failed",
      error: "Build <failed>",
      logs: Array.from({ length: 150 }, (_, index) => `stderr: line ${index}`),
    });
    expect(await readUntil(reader, "event: refresh")).toContain(
      "event: refresh",
    );
    await reader.cancel();
    const failed = await fetch(server.url).then((response) => response.text());
    expect(failed).toContain("Build &lt;failed&gt;");
    expect(failed).toContain("stderr: line 149");
    expect(failed).not.toContain("stderr: line 0\n");
    const status = await fetch(`${server.url}/api/docs-builder`).then(
      (response) => response.json(),
    );
    expect(status.logs).toHaveLength(100);
    expect(status.logs[0]).toBe("stderr: line 50");
    const failedProxy = await fetch(`${server.url}/guide`);
    expect(failedProxy.status).toBe(503);
    expect(await failedProxy.text()).toContain("Build <failed>");
  });

  it("falls back to a free review port when the requested port is occupied", async () => {
    const occupied = createServer((_request, response) => response.end("busy"));
    await new Promise<void>((resolve) =>
      occupied.listen(0, "127.0.0.1", resolve),
    );
    running.push({
      close: () =>
        new Promise<void>((resolve, reject) =>
          occupied.close((error) => (error ? reject(error) : resolve())),
        ),
    });
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("no address");

    const server = await startReviewServer({ review, port: address.port });
    running.push(server);

    expect(server.port).not.toBe(address.port);
    expect((await fetch(server.url)).status).toBe(200);
  });

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

  it("strips executable scripts from HTML while preserving data scripts", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    const asset = await fetch(`${server.url}/_static/site.css?theme=dark`);
    expect(asset.headers.get("access-control-allow-origin")).toBeNull();
    expect(await asset.text()).toBe("body{color:navy}");
    expect(upstream.requests).toContain("/_static/site.css?theme=dark");

    const page = await fetch(`${server.url}/guide`);
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
    expect(page.headers.get("content-security-policy")).toBe("style-src 'self'");
    const html = await page.text();
    expect(html).toContain("<main>Guide</main>");
    expect(html).not.toContain("window.__maliciousDocsScript = true");
    expect(html).not.toContain('src="/normal.js"');
    expect(html).not.toContain('src="/module.js"');
    expect(html).not.toContain("legacy()");
    expect(html).toContain(
      '<script type="application/ld+json">{"name":"Guide"}</script>',
    );
    expect(html).toContain(
      '<script type="application/json">{"fixture":true}</script>',
    );
    expect(Number(page.headers.get("content-length"))).toBe(
      Buffer.byteLength(html),
    );
    expect(html).not.toContain("data-docs-review-styles");
    expect(html).not.toContain("data-docs-review-highlighter");
    expect(html).not.toContain("new EventSource");
  });

  it("passes non-HTML responses through unchanged", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    const response = await fetch(`${server.url}/data.json`);
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-length")).toBe("16");
    expect(body).toBe('{"script":"raw"}');
  });

  it("serves dedicated same-origin highlight CSS for strict CSP pages", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    const response = await fetch(`${server.url}/_review/highlight.css`, {
      headers: { origin: "null" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.text()).toContain(
      '[data-docs-review-mark="added"]',
    );
    expect(upstream.requests).toEqual([]);
  });

  it("uses a validated snippet selector for the trusted parent highlighter", async () => {
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
    expect(dashboard).toContain(
      'data-source-file="docs/_snippets/shared.md"',
    );

    const page = await fetch(
      `${server.url}/docs/guide?review-source=docs%2F_snippets%2Fshared.md`,
    );
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<main>Guide</main>");
    expect(html).not.toContain("Changed included text.");
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

  it("rejects non-loopback, missing, malformed, and wrong-port Host authorities", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);
    const requestWithHost = (
      host: string | undefined,
    ): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const request = httpRequest(
          {
            host: server.host,
            port: server.port,
            path: "/api/review",
            setHost: host !== undefined,
            headers: host === undefined ? undefined : { host },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.once("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        request.once("error", reject);
        request.end();
      });

    for (const host of [
      "evil.example",
      "127.0.0.1",
      "localhost",
      "[::1]",
      `127.0.0.1:${server.port + 1}`,
      `127.0.0.1:${server.port}:80`,
      undefined,
    ]) {
      const response = await requestWithHost(host);
      expect(response.status, String(host)).toBe(400);
      expect(response.body).not.toContain("guide.md");
    }
    expect(upstream.requests).toEqual([]);

    for (const host of [
      `127.0.0.1:${server.port}`,
      `localhost:${server.port}`,
      `[::1]:${server.port}`,
    ]) {
      expect((await requestWithHost(host)).status, host).toBe(200);
    }
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

  it("keeps app APIs non-CORS", async () => {
    const upstream = await fakeUpstream();
    const server = await start(upstream.url);

    const events = await fetch(`${server.url}/api/events`, {
      headers: { origin: "null" },
    });
    expect(events.headers.get("access-control-allow-origin")).toBeNull();
    await events.body!.cancel();

    const api = await fetch(`${server.url}/api/review`, {
      headers: { origin: "null" },
    });
    expect(api.status).toBe(200);
    expect(api.headers.get("access-control-allow-origin")).toBeNull();
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

  it("disconnects never-ending upstream responses during shutdown", async () => {
    let markDisconnected!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      markDisconnected = resolve;
    });
    const upstreamServer = createServer((_request, response) => {
      response.setHeader("content-type", "text/event-stream");
      response.write("data: connected\n\n");
      response.once("close", markDisconnected);
    });
    await new Promise<void>((resolve) =>
      upstreamServer.listen(0, "127.0.0.1", resolve),
    );
    const address = upstreamServer.address();
    if (!address || typeof address === "string") throw new Error("no address");
    running.push({
      close: () =>
        new Promise<void>((resolve, reject) => {
          upstreamServer.close((error) =>
            error ? reject(error) : resolve(),
          );
          upstreamServer.closeAllConnections();
        }),
    });
    const server = await start(`http://127.0.0.1:${address.port}`);
    const response = await fetch(`${server.url}/never-ending`);
    const reader = response.body!.getReader();
    await reader.read();
    void reader.closed.catch(() => undefined);

    const result = await Promise.race([
      Promise.all([server.close(), disconnected]).then(() => "closed"),
      new Promise<"timed-out">((resolve) =>
        setTimeout(() => resolve("timed-out"), 250),
      ),
    ]);

    expect(result).toBe("closed");
  });

});

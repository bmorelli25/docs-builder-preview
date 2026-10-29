import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";

import type { DocsBuilderHandle } from "./docs-builder.js";
import type { ChangedFile, ReviewModel } from "./model.js";
import { sourcePathToRoute } from "./routes.js";
import { createDashboard } from "./ui/dashboard.js";
import { createHighlighterScript } from "./ui/highlighter.js";
import { reviewStyles } from "./ui/styles.js";

export interface ServerOptions {
  review: ReviewModel;
  port?: number;
  upstreamUrl?: string;
  docsBuilder?: DocsBuilderHandle;
}

export interface RunningServer {
  url: string;
  host: "127.0.0.1";
  port: number;
  setReview(review: ReviewModel): void;
  broadcast(event: string, data?: unknown): number;
  refresh(): number;
  close(): Promise<void>;
}

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function safeRequestTarget(rawUrl: string): URL | undefined {
  if (
    !rawUrl.startsWith("/") ||
    rawUrl.startsWith("//") ||
    /[\u0000-\u001f\u007f]/.test(rawUrl)
  ) {
    return undefined;
  }
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
  const normalized = decoded.replaceAll("\\", "/");
  if (
    normalized.startsWith("//") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }
  try {
    return new URL(rawUrl, "http://127.0.0.1");
  } catch {
    return undefined;
  }
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sseMessage(event: string, data: unknown = {}): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(event)) {
    throw new Error(`Invalid SSE event name: ${event}`);
  }
  const serialized = JSON.stringify(data ?? {});
  return `event: ${event}\ndata: ${serialized}\n\n`;
}

function forwardedHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (
      value !== undefined &&
      !hopByHopHeaders.has(name.toLowerCase()) &&
      name.toLowerCase() !== "host" &&
      name.toLowerCase() !== "accept-encoding"
    ) {
      result[name] = value;
    }
  }
  result["accept-encoding"] = "identity";
  return result;
}

function proxiedResponseHeaders(
  headers: IncomingHttpHeaders,
): IncomingHttpHeaders {
  const result = {
    ...headers,
    "access-control-allow-origin": "*",
  };
  delete result["access-control-allow-credentials"];
  return result;
}

function injectAssets(html: string, file: ChangedFile | undefined): string {
  const style = `<style data-docs-review-styles>${reviewStyles}</style>`;
  const script = `<script data-docs-review-highlighter>${createHighlighterScript(file)}</script>`;
  const withStyle = /<\/head\s*>/i.test(html)
    ? html.replace(/<\/head\s*>/i, `${style}</head>`)
    : `${style}${html}`;
  return /<\/body\s*>/i.test(withStyle)
    ? withStyle.replace(/<\/body\s*>/i, `${script}</body>`)
    : `${withStyle}${script}`;
}

async function proxyRequest(
  request: import("node:http").IncomingMessage,
  response: ServerResponse,
  target: URL,
  file: ChangedFile | undefined,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = transport(
      target,
      {
        method: request.method,
        headers: forwardedHeaders(request.headers),
      },
      (upstreamResponse) => {
        const contentType = String(
          upstreamResponse.headers["content-type"] ?? "",
        ).toLowerCase();
        const isHtml = contentType.includes("text/html");

        if (!isHtml) {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            proxiedResponseHeaders(upstreamResponse.headers),
          );
          upstreamResponse.pipe(response);
          upstreamResponse.once("end", resolve);
          return;
        }

        const chunks: Buffer[] = [];
        let length = 0;
        upstreamResponse.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length <= 10 * 1024 * 1024) chunks.push(chunk);
          else upstreamResponse.destroy(new Error("HTML response too large"));
        });
        upstreamResponse.once("end", () => {
          const body = injectAssets(Buffer.concat(chunks).toString("utf8"), file);
          const headers = proxiedResponseHeaders(upstreamResponse.headers);
          delete headers["content-length"];
          delete headers["content-encoding"];
          delete headers["content-security-policy"];
          headers["content-length"] = String(Buffer.byteLength(body));
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          response.end(body);
          resolve();
        });
        upstreamResponse.once("error", (error) => {
          if (!response.headersSent) send(response, 502, error.message);
          else response.destroy(error);
          resolve();
        });
      },
    );
    upstream.once("error", (error) => {
      if (!response.headersSent) send(response, 502, `Upstream error: ${error.message}`);
      else response.destroy(error);
      resolve();
    });
    request.pipe(upstream);
  });
}

export async function startReviewServer(
  options: ServerOptions,
): Promise<RunningServer> {
  let review = options.review;
  let upstreamBase: URL;
  try {
    const upstreamValue = options.docsBuilder?.url ?? options.upstreamUrl;
    if (!upstreamValue) throw new Error("A docs-builder upstream is required");
    upstreamBase = new URL(upstreamValue);
    if (
      !["http:", "https:"].includes(upstreamBase.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(upstreamBase.hostname) ||
      upstreamBase.username ||
      upstreamBase.password
    ) {
      throw new Error("The docs-builder upstream must be localhost");
    }
  } catch (error) {
    if (options.docsBuilder?.owned) await options.docsBuilder.stop();
    throw error;
  }

  const eventClients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown = {}) => {
    const message = sseMessage(event, data);
    let recipients = 0;
    for (const client of eventClients) {
      if (client.destroyed || client.writableEnded) {
        eventClients.delete(client);
        continue;
      }
      client.write(message);
      recipients++;
    }
    return recipients;
  };

  const server = createServer(async (request, response) => {
    const target = safeRequestTarget(request.url ?? "");
    if (!target) {
      send(response, 400, "Invalid request target");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      send(response, 405, "Method not allowed");
      return;
    }
    if (target.pathname === "/" && !target.search) {
      send(
        response,
        200,
        createDashboard(review),
        "text/html; charset=utf-8",
      );
      return;
    }
    if (target.pathname === "/api/review") {
      response.setHeader("cache-control", "no-store");
      send(
        response,
        200,
        JSON.stringify(review),
        "application/json; charset=utf-8",
      );
      return;
    }
    if (target.pathname === "/api/events") {
      const headers: import("node:http").OutgoingHttpHeaders = {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      };
      if (request.headers.origin === "null") {
        headers["access-control-allow-origin"] = "null";
        headers.vary = "Origin";
      }
      response.writeHead(200, headers);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      eventClients.add(response);
      const removeClient = () => eventClients.delete(response);
      response.once("close", removeClient);
      response.write(sseMessage("connected"));
      return;
    }

    const selectors = target.searchParams.getAll("review-source");
    let file: ChangedFile | undefined;
    if (selectors.length > 0) {
      const selector = selectors[0];
      file = review.files.find(({ path }) => path === selector);
      const isConsumer = file?.consumers?.some(
        (consumer) => sourcePathToRoute(consumer) === target.pathname,
      );
      if (selectors.length !== 1 || !selector || !file || !isConsumer) {
        send(response, 400, "Invalid review source");
        return;
      }
      target.searchParams.delete("review-source");
    } else {
      file = review.files.find(
        ({ route }) => route !== null && route === target.pathname,
      );
    }
    const upstream = new URL(upstreamBase);
    upstream.pathname = target.pathname;
    upstream.search = target.search;
    await proxyRequest(request, response, upstream, file);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4173, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (options.docsBuilder?.owned) await options.docsBuilder.stop();
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Review server did not receive a TCP address");
  }
  let serverClosed = false;
  let docsBuilderStopped = !options.docsBuilder?.owned;
  let activeClose: Promise<void> | undefined;
  return {
    host: "127.0.0.1",
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    setReview: (nextReview) => {
      review = nextReview;
    },
    broadcast,
    refresh: () => broadcast("refresh"),
    close: () => {
      if (activeClose) return activeClose;
      for (const client of eventClients) client.end();
      eventClients.clear();
      activeClose = (async () => {
        const cleanups: Array<{
          name: string;
          run(): Promise<void>;
          complete(): void;
        }> = [];
        if (!serverClosed) {
          cleanups.push({
            name: "review server",
            run: () =>
              new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
              }),
            complete: () => {
              serverClosed = true;
            },
          });
        }
        if (!docsBuilderStopped && options.docsBuilder) {
          cleanups.push({
            name: "docs-builder",
            run: options.docsBuilder.stop,
            complete: () => {
              docsBuilderStopped = true;
            },
          });
        }
        const results = await Promise.allSettled(
          cleanups.map((cleanup) => cleanup.run()),
        );
        const failures: unknown[] = [];
        const failedNames: string[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            cleanups[index].complete();
          } else {
            failures.push(result.reason);
            failedNames.push(cleanups[index].name);
          }
        });
        if (failures.length > 0) {
          throw new AggregateError(
            failures,
            `Failed to close ${failedNames.join(", ")}`,
          );
        }
      })().finally(() => {
        activeClose = undefined;
      });
      return activeClose;
    },
  };
}

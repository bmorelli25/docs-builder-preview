import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";

import type { ChangedFile, ReviewModel } from "./model.js";
import { sourcePathToRoute } from "./routes.js";
import { createDashboard } from "./ui/dashboard.js";
import { reviewStyles } from "./ui/styles.js";

export interface ServerOptions {
  review: ReviewModel;
  port?: number;
  upstreamUrl?: string;
  docsBuilderStatus?: DocsBuilderStatus;
}

export interface DocsBuilderStatus {
  state: "starting" | "ready" | "failed";
  url?: string;
  error?: string;
  logs: string[];
}

export interface RunningServer {
  url: string;
  host: "127.0.0.1";
  port: number;
  setReview(review: ReviewModel): void;
  setDocsBuilderStatus(status: DocsBuilderStatus): void;
  broadcast(event: string, data?: unknown): number;
  refresh(): number;
  close(): Promise<void>;
}

function localUpstream(value: string): URL {
  const upstream = new URL(value);
  if (
    !["http:", "https:"].includes(upstream.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname) ||
    upstream.username ||
    upstream.password
  ) {
    throw new Error("The docs-builder upstream must be localhost");
  }
  return upstream;
}

function boundedStatus(status: DocsBuilderStatus): DocsBuilderStatus {
  return {
    ...status,
    logs: status.logs.slice(-100).map((line) => line.slice(-2_000)),
  };
}

function validHostAuthority(
  request: import("node:http").IncomingMessage,
  listeningPort: number | undefined,
): boolean {
  if (listeningPort === undefined) return false;
  const hosts: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "host") {
      hosts.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  if (hosts.length !== 1) return false;
  const match = hosts[0].match(
    /^(?:127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/i,
  );
  return match !== null && Number(match[1]) === listeningPort;
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
  const result = { ...headers };
  delete result["access-control-allow-origin"];
  delete result["access-control-allow-credentials"];
  return result;
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: URL,
  activeRequests: Set<ClientRequest>,
  activeResponses: Set<IncomingMessage>,
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
        activeResponses.add(upstreamResponse);
        const removeResponse = () => activeResponses.delete(upstreamResponse);
        upstreamResponse.once("end", removeResponse);
        upstreamResponse.once("error", removeResponse);
        upstreamResponse.once("close", removeResponse);
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          proxiedResponseHeaders(upstreamResponse.headers),
        );
        upstreamResponse.pipe(response);
        upstreamResponse.once("end", resolve);
        upstreamResponse.once("close", resolve);
        upstreamResponse.once("error", (error) => {
          if (!response.headersSent) send(response, 502, error.message);
          else response.destroy(error);
          resolve();
        });
      },
    );
    activeRequests.add(upstream);
    const removeRequest = () => activeRequests.delete(upstream);
    upstream.once("error", removeRequest);
    upstream.once("close", removeRequest);
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
  let docsBuilderStatus = boundedStatus(
    options.docsBuilderStatus ??
      (options.upstreamUrl
        ? { state: "ready", url: options.upstreamUrl, logs: [] }
        : { state: "starting", logs: [] }),
  );
  let upstreamBase =
    docsBuilderStatus.state === "ready" && docsBuilderStatus.url
      ? localUpstream(docsBuilderStatus.url)
      : undefined;

  const eventClients = new Set<ServerResponse>();
  const activeProxyRequests = new Set<ClientRequest>();
  const activeProxyResponses = new Set<IncomingMessage>();
  let listeningPort: number | undefined;
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
    if (!validHostAuthority(request, listeningPort)) {
      send(response, 400, "Invalid Host header");
      return;
    }
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
        createDashboard(review, docsBuilderStatus),
        "text/html; charset=utf-8",
      );
      return;
    }
    if (target.pathname === "/api/docs-builder") {
      response.setHeader("cache-control", "no-store");
      send(
        response,
        200,
        JSON.stringify(docsBuilderStatus),
        "application/json; charset=utf-8",
      );
      return;
    }
    if (target.pathname === "/_review/highlight.css") {
      send(response, 200, reviewStyles, "text/css; charset=utf-8");
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

    if (!upstreamBase || docsBuilderStatus.state !== "ready") {
      const detail =
        docsBuilderStatus.state === "failed"
          ? docsBuilderStatus.error ?? "docs-builder failed"
          : "docs-builder is starting";
      const recentLogs = docsBuilderStatus.logs.slice(-10).join("\n");
      send(
        response,
        503,
        `${detail}${recentLogs ? `\n\nRecent logs:\n${recentLogs}` : ""}`,
      );
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
    await proxyRequest(
      request,
      response,
      upstream,
      activeProxyRequests,
      activeProxyResponses,
    );
  });

  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  const requestedPort = options.port ?? 4173;
  try {
    await listen(requestedPort);
  } catch (error) {
    if (
      requestedPort !== 0 &&
      (error as NodeJS.ErrnoException).code === "EADDRINUSE"
    ) {
      await listen(0);
    } else {
      throw error;
    }
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Review server did not receive a TCP address");
  }
  listeningPort = address.port;
  let serverClosed = false;
  let activeClose: Promise<void> | undefined;
  return {
    host: "127.0.0.1",
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    setReview: (nextReview) => {
      review = nextReview;
    },
    setDocsBuilderStatus: (nextStatus) => {
      const bounded = boundedStatus(nextStatus);
      const stateChanged = bounded.state !== docsBuilderStatus.state;
      upstreamBase =
        bounded.state === "ready" && bounded.url
          ? localUpstream(bounded.url)
          : undefined;
      docsBuilderStatus = bounded;
      if (stateChanged) broadcast("refresh");
    },
    broadcast,
    refresh: () => broadcast("refresh"),
    close: () => {
      if (activeClose) return activeClose;
      for (const client of eventClients) client.end();
      eventClients.clear();
      for (const upstreamResponse of activeProxyResponses) {
        upstreamResponse.destroy();
      }
      for (const upstreamRequest of activeProxyRequests) {
        upstreamRequest.destroy();
      }
      activeProxyResponses.clear();
      activeProxyRequests.clear();
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

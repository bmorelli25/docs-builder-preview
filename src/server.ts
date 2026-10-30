import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ChangedFile, ReviewModel } from "./model.js";
import { openingTagEnd, rewritePreviewHtml } from "./preview-html.js";
import { createReviewChecks } from "./review-checks.js";
import { sourcePathToRoute } from "./routes.js";
import { createSourceLocator, type SourceLocator } from "./source-locate.js";
import { createSuggestions, type Suggestions } from "./suggestions.js";
import { createDashboard } from "./ui/dashboard.js";
import { reviewStyles } from "./ui/styles.js";

const execFileAsync = promisify(execFile);

export interface ServerOptions {
  review: ReviewModel;
  port?: number;
  upstreamUrl?: string;
  docsBuilderStatus?: DocsBuilderStatus;
  suggestions?: {
    branch?: string;
    locator?: SourceLocator;
    storageDir?: string;
  };
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

export function isAllowedHostAuthority(
  authority: string,
  listeningPort: number,
): boolean {
  const match = authority.match(
    /^(?:127\.0\.0\.1|localhost|\[::1\])(?::([1-9]\d{0,4}))?$/i,
  );
  if (!match) return false;
  return match[1] === undefined
    ? listeningPort === 80
    : Number(match[1]) === listeningPort;
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
  return isAllowedHostAuthority(hosts[0], listeningPort);
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

const MAX_BUFFERED_HTML_BYTES = 20 * 1024 * 1024;

function scriptType(openingTag: string): string | undefined {
  const match = openingTag.match(
    /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
  );
  return match?.slice(1).find((value) => value !== undefined)?.trim().toLowerCase();
}

function isExecutableScript(openingTag: string): boolean {
  const type = scriptType(openingTag);
  if (type === undefined || type === "" || type === "module") return true;
  const mime = type.split(";", 1)[0].trim();
  return /^(?:text|application)\/(?:java|ecma)script$/.test(mime) ||
    mime === "application/x-ecmascript" ||
    mime === "application/x-javascript" ||
    mime === "text/javascript1.0" ||
    mime === "text/javascript1.1" ||
    mime === "text/javascript1.2" ||
    mime === "text/javascript1.3" ||
    mime === "text/javascript1.4" ||
    mime === "text/javascript1.5" ||
    mime === "text/jscript" ||
    mime === "text/livescript" ||
    mime === "text/x-javascript";
}

export function stripExecutableScripts(html: string): string {
  let result = "";
  let cursor = 0;
  const scriptStart = /<script\b/gi;
  const commentStart = /<!--/g;

  while (cursor < html.length) {
    scriptStart.lastIndex = cursor;
    commentStart.lastIndex = cursor;
    const script = scriptStart.exec(html);
    const comment = commentStart.exec(html);
    if (!script) {
      result += html.slice(cursor);
      break;
    }
    if (comment && comment.index < script.index) {
      const commentEnd = html.indexOf("-->", comment.index + 4);
      const end = commentEnd === -1 ? html.length : commentEnd + 3;
      result += html.slice(cursor, end);
      cursor = end;
      continue;
    }

    const tagEnd = openingTagEnd(html, script.index);
    if (tagEnd === undefined) {
      result += html.slice(cursor);
      break;
    }
    const closingTag = /<\/script\s*>/gi;
    closingTag.lastIndex = tagEnd + 1;
    const close = closingTag.exec(html);
    const elementEnd = close?.index === undefined
      ? html.length
      : closingTag.lastIndex;
    const openingTag = html.slice(script.index, tagEnd + 1);
    if (!isExecutableScript(openingTag)) {
      result += html.slice(cursor, elementEnd);
    } else {
      result += html.slice(cursor, script.index);
    }
    cursor = elementEnd;
  }

  return result;
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: URL,
  activeRequests: Set<ClientRequest>,
  activeResponses: Set<IncomingMessage>,
  changedRoutes: ReadonlyMap<string, string>,
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
        const contentType = upstreamResponse.headers["content-type"] ?? "";
        const isHtml = /^text\/html(?:\s*;|$)/i.test(
          Array.isArray(contentType) ? contentType[0] ?? "" : contentType,
        );
        if (!isHtml) {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            proxiedResponseHeaders(upstreamResponse.headers),
          );
          upstreamResponse.pipe(response);
          upstreamResponse.once("end", resolve);
          upstreamResponse.once("close", resolve);
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          resolve();
        };
        upstreamResponse.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BUFFERED_HTML_BYTES) {
            upstreamResponse.destroy();
            send(
              response,
              502,
              `Upstream HTML exceeds ${MAX_BUFFERED_HTML_BYTES} bytes`,
            );
            finish();
            return;
          }
          chunks.push(chunk);
        });
        upstreamResponse.once("end", () => {
          if (finished) return;
          const sanitized = Buffer.from(
            rewritePreviewHtml(
              stripExecutableScripts(Buffer.concat(chunks).toString("utf8")),
              target.pathname,
              changedRoutes,
            ),
            "utf8",
          );
          const headers = proxiedResponseHeaders(upstreamResponse.headers);
          delete headers["transfer-encoding"];
          delete headers["content-length"];
          headers["content-length"] = String(sanitized.length);
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          response.end(request.method === "HEAD" ? undefined : sanitized);
          finish();
        });
        upstreamResponse.once("close", finish);
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

async function currentBranch(repositoryPath: string): Promise<string> {
  try {
    const branch = (
      await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repositoryPath,
        encoding: "utf8",
      })
    ).stdout.trim();
    return branch && branch !== "HEAD" ? branch : "HEAD";
  } catch {
    return "HEAD";
  }
}

export async function startReviewServer(
  options: ServerOptions,
): Promise<RunningServer> {
  let review = options.review;
  const reviewChecks = createReviewChecks(() => review);
  const suggestionLocator =
    options.suggestions?.locator ??
    (await createSourceLocator({
      repositoryPath: review.repositoryPath,
      substitutions: () => review.substitutions ?? {},
    }).catch(
      (): SourceLocator => ({
        rebuild: async () => undefined,
        fileForRoute: () => undefined,
        locate: async (route, quote) => ({
          path: `${route.replace(/^\//, "") || "page"}.md`,
          startLine: 1,
          endLine: 1,
          source: quote.exact,
          exact: quote.exact,
          found: false,
        }),
      }),
    ));
  const suggestionBranch =
    options.suggestions?.branch ?? (await currentBranch(review.repositoryPath));
  const suggestions: Suggestions = await createSuggestions({
    repositoryPath: review.repositoryPath,
    branch: suggestionBranch,
    locator: suggestionLocator,
    getReview: () => review,
    storageDir: options.suggestions?.storageDir,
  });
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
    if (await reviewChecks.handle(request, response, target)) return;
    if (await suggestions.handle(request, response, target)) return;
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      send(response, 405, "Method not allowed");
      return;
    }
    if (target.pathname === "/" && !target.search) {
      send(
        response,
        200,
        createDashboard(
          review,
          docsBuilderStatus,
          reviewChecks.reviewed(),
          suggestions.list(),
        ),
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
      new Map(
        review.files.flatMap((file) =>
          file.route && file.status !== "deleted"
            ? [[file.route, file.status] as const]
            : [],
        ),
      ),
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
      reviewChecks.prune(nextReview);
      void suggestionLocator.rebuild().catch(() => undefined);
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

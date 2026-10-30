import type { IncomingMessage, ServerResponse } from "node:http";

import type { ReviewModel } from "./model.js";

export const MAX_REVIEW_CHECK_BODY_BYTES = 16 * 1024;

export interface ReviewCheckState {
  reviewed: string[];
  total: number;
}

export interface ReviewChecks {
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    target: URL,
  ): Promise<boolean>;
  prune(review: ReviewModel): void;
  reviewed(): ReadonlySet<string>;
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function previewablePagePaths(review: ReviewModel): string[] {
  return review.files
    .filter((file) => file.route && file.status !== "deleted")
    .map((file) => file.path);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(serialized);
}

function rawHeaderValues(request: IncomingMessage, name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function assertMutationAllowed(request: IncomingMessage): void {
  const origins = rawHeaderValues(request, "origin");
  const dashboardOrigin = `http://${request.headers.host ?? ""}`.toLowerCase();
  if (
    origins.length > 1 ||
    (origins.length === 1 && origins[0].toLowerCase() !== dashboardOrigin)
  ) {
    throw new RequestError(403, "Cross-origin review check requests are not allowed");
  }
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError(415, "Content-Type must be application/json");
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_REVIEW_CHECK_BODY_BYTES) {
    throw new RequestError(413, "Request body is too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_REVIEW_CHECK_BODY_BYTES) {
        throw new RequestError(413, "Request body is too large");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Request body could not be read");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "Request body must be JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createReviewChecks(getReview: () => ReviewModel): ReviewChecks {
  const checked = new Set<string>();

  const state = (): ReviewCheckState => {
    const pages = previewablePagePaths(getReview());
    return {
      reviewed: pages.filter((path) => checked.has(path)),
      total: pages.length,
    };
  };

  const setReviewed = (body: unknown) => {
    if (
      !isRecord(body) ||
      typeof body.path !== "string" ||
      typeof body.reviewed !== "boolean"
    ) {
      throw new RequestError(
        400,
        'Expected {"path": string, "reviewed": boolean}',
      );
    }
    if (!previewablePagePaths(getReview()).includes(body.path)) {
      throw new RequestError(400, "Not a previewable page");
    }
    if (body.reviewed) checked.add(body.path);
    else checked.delete(body.path);
  };

  const clear = (body: unknown) => {
    if (!isRecord(body)) throw new RequestError(400, "Expected a JSON object");
    checked.clear();
  };

  return {
    prune(review) {
      const pages = new Set(previewablePagePaths(review));
      for (const path of checked) {
        if (!pages.has(path)) checked.delete(path);
      }
    },
    reviewed: () => new Set(state().reviewed),
    async handle(request, response, target) {
      const route = target.pathname;
      if (route !== "/api/review-checks" && route !== "/api/review-checks/clear") {
        return false;
      }
      const isState = route === "/api/review-checks";
      const allowed = isState ? ["GET", "HEAD", "POST"] : ["POST"];
      const method = request.method ?? "";
      if (!allowed.includes(method)) {
        sendJson(
          response,
          405,
          { error: "Method not allowed" },
          { allow: allowed.join(", ") },
        );
        return true;
      }
      try {
        if (method === "POST") {
          assertMutationAllowed(request);
          (isState ? setReviewed : clear)(await readJsonBody(request));
        }
        sendJson(response, 200, state());
      } catch (error) {
        if (!(error instanceof RequestError)) throw error;
        if (response.destroyed) return true;
        // Unread request bodies would otherwise stall a keep-alive socket.
        sendJson(response, error.status, { error: error.message }, {
          connection: "close",
        });
      }
      return true;
    },
  };
}

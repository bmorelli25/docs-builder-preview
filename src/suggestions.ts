import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { ReviewModel } from "./model.js";
import {
  suggestionStoreKey,
  type SourceLocation,
  type SourceLocator,
  type TextQuote,
} from "./source-locate.js";

export const MAX_SUGGESTION_BODY_BYTES = 64 * 1024;

export type SuggestionKind = "replace" | "instruction" | "delete";

export interface Suggestion {
  id: string;
  route: string;
  quote: TextQuote;
  kind: SuggestionKind;
  newText: string;
  createdAt: string;
  updatedAt: string;
  location: SourceLocation;
}

export interface SuggestionState {
  suggestions: Suggestion[];
  repositoryPath: string;
  branch: string;
}

export interface Suggestions {
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    target: URL,
  ): Promise<boolean>;
  list(): Suggestion[];
  exportMarkdown(): string;
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
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
    throw new RequestError(403, "Cross-origin suggestion requests are not allowed");
  }
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError(415, "Content-Type must be application/json");
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_SUGGESTION_BODY_BYTES) {
    throw new RequestError(413, "Request body is too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_SUGGESTION_BODY_BYTES) {
        throw new RequestError(413, "Request body is too large");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Request body could not be read");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new RequestError(400, "Request body must be JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQuote(value: unknown): value is TextQuote {
  return (
    isRecord(value) &&
    typeof value.exact === "string" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string" &&
    value.exact.trim().length > 0 &&
    value.exact.length <= 8_000 &&
    value.prefix.length <= 200 &&
    value.suffix.length <= 200
  );
}

function isKind(value: unknown): value is SuggestionKind {
  return value === "replace" || value === "instruction" || value === "delete";
}

function blockquote(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.map((line) => `> ${line}`).join("\n");
}

function indentSource(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

export function formatSuggestionsExport(
  state: SuggestionState,
): string {
  const header = [
    "# Documentation edit suggestions",
    `Repository: ${state.repositoryPath} (branch ${state.branch})`,
    "",
    'Apply each suggestion to the source file listed. "Replace" means use the new',
    "text as written, adjusting Markdown or MyST syntax only as needed. \"Instruction\"",
    'means rewrite the original text as described. "Delete" means remove it.',
    "Keep substitutions such as {{kib}}, links, and directives intact.",
    "",
  ];

  if (state.suggestions.length === 0) {
    return [...header, "No suggestions yet.", ""].join("\n");
  }

  const byFile = new Map<string, Suggestion[]>();
  for (const suggestion of state.suggestions) {
    const path = suggestion.location.path;
    const group = byFile.get(path) ?? [];
    group.push(suggestion);
    byFile.set(path, group);
  }

  const entries: string[] = [];
  let index = 1;
  for (const [path, group] of [...byFile.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    group.sort(
      (left, right) =>
        left.location.startLine - right.location.startLine ||
        left.createdAt.localeCompare(right.createdAt),
    );
    for (const suggestion of group) {
      const lines =
        suggestion.location.startLine === suggestion.location.endLine
          ? String(suggestion.location.startLine)
          : `${suggestion.location.startLine}-${suggestion.location.endLine}`;
      const typeLabel =
        suggestion.kind === "replace"
          ? "Replace"
          : suggestion.kind === "instruction"
            ? "Instruction"
            : "Delete";
      const parts = [
        `## ${index}. ${path}, lines ${lines}`,
      ];
      if (suggestion.location.heading) {
        parts.push(`Section: ${suggestion.location.heading}`);
      }
      if (!suggestion.location.found) {
        parts.push("Note: original text was not found in the current source.");
      }
      parts.push(
        `Type: ${typeLabel}`,
        "Original text (as rendered):",
        blockquote(suggestion.quote.exact),
        "Source:",
        indentSource(suggestion.location.source || suggestion.quote.exact),
      );
      if (suggestion.kind === "delete") {
        parts.push("New text:", "> (delete)");
      } else {
        parts.push(
          suggestion.kind === "instruction" ? "Instruction:" : "New text:",
          blockquote(suggestion.newText),
        );
      }
      parts.push("");
      entries.push(parts.join("\n"));
      index++;
    }
  }

  return [...header, ...entries].join("\n");
}

export function suggestionsFilePath(
  repositoryPath: string,
  branch: string,
  baseDir = join(homedir(), ".docs-builder-preview", "suggestions"),
): string {
  return join(baseDir, `${suggestionStoreKey(repositoryPath, branch)}.json`);
}

async function loadSuggestions(path: string): Promise<Suggestion[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.suggestions)) return [];
    return parsed.suggestions.filter((item): item is Suggestion => {
      return (
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.route === "string" &&
        isQuote(item.quote) &&
        isKind(item.kind) &&
        typeof item.newText === "string" &&
        typeof item.createdAt === "string" &&
        typeof item.updatedAt === "string" &&
        isRecord(item.location) &&
        typeof item.location.path === "string"
      );
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

async function saveSuggestions(
  path: string,
  suggestions: Suggestion[],
  meta: { repositoryPath: string; branch: string },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(
    {
      version: 1,
      repositoryPath: meta.repositoryPath,
      branch: meta.branch,
      suggestions,
    },
    null,
    2,
  );
  await writeFile(temp, payload, "utf8");
  await rename(temp, path);
}

export async function createSuggestions(options: {
  repositoryPath: string;
  branch: string;
  locator: SourceLocator;
  getReview: () => ReviewModel;
  storageDir?: string;
}): Promise<Suggestions> {
  const filePath = suggestionsFilePath(
    options.repositoryPath,
    options.branch,
    options.storageDir,
  );
  let suggestions = await loadSuggestions(filePath);

  const persist = async () => {
    if (suggestions.length === 0) {
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return;
    }
    await saveSuggestions(filePath, suggestions, {
      repositoryPath: options.repositoryPath,
      branch: options.branch,
    });
  };

  const state = (): SuggestionState => ({
    suggestions: [...suggestions],
    repositoryPath: options.repositoryPath,
    branch: options.branch,
  });

  const create = async (body: unknown) => {
    if (
      !isRecord(body) ||
      typeof body.route !== "string" ||
      !body.route.startsWith("/") ||
      !isQuote(body.quote) ||
      !isKind(body.kind) ||
      typeof body.newText !== "string" ||
      body.newText.length > 16_000
    ) {
      throw new RequestError(
        400,
        'Expected {"route","quote","kind","newText"}',
      );
    }
    const location = await options.locator.locate(body.route, body.quote);
    const now = new Date().toISOString();
    const kind =
      body.kind === "replace" && body.newText.trim() === ""
        ? "delete"
        : body.kind;
    const suggestion: Suggestion = {
      id: randomUUID(),
      route: body.route,
      quote: {
        exact: body.quote.exact,
        prefix: body.quote.prefix,
        suffix: body.quote.suffix,
      },
      kind,
      newText: kind === "delete" ? "" : body.newText,
      createdAt: now,
      updatedAt: now,
      location,
    };
    suggestions = [...suggestions, suggestion];
    await persist();
    return suggestion;
  };

  const update = async (body: unknown) => {
    if (
      !isRecord(body) ||
      typeof body.id !== "string" ||
      (body.kind !== undefined && !isKind(body.kind)) ||
      (body.newText !== undefined && typeof body.newText !== "string")
    ) {
      throw new RequestError(400, 'Expected {"id", optional "kind"/"newText"}');
    }
    const index = suggestions.findIndex((item) => item.id === body.id);
    if (index === -1) throw new RequestError(404, "Suggestion not found");
    const current = suggestions[index];
    let kind = body.kind ?? current.kind;
    let newText = body.newText ?? current.newText;
    if (typeof newText === "string" && newText.length > 16_000) {
      throw new RequestError(400, "newText is too large");
    }
    if (kind === "replace" && newText.trim() === "") kind = "delete";
    if (kind === "delete") newText = "";
    const next: Suggestion = {
      ...current,
      kind,
      newText,
      updatedAt: new Date().toISOString(),
    };
    suggestions = suggestions.map((item, itemIndex) =>
      itemIndex === index ? next : item,
    );
    await persist();
    return next;
  };

  const remove = async (body: unknown) => {
    if (!isRecord(body) || typeof body.id !== "string") {
      throw new RequestError(400, 'Expected {"id": string}');
    }
    const before = suggestions.length;
    suggestions = suggestions.filter((item) => item.id !== body.id);
    if (suggestions.length === before) {
      throw new RequestError(404, "Suggestion not found");
    }
    await persist();
  };

  const clear = async (body: unknown) => {
    if (!isRecord(body)) throw new RequestError(400, "Expected a JSON object");
    suggestions = [];
    await persist();
  };

  return {
    list: () => [...suggestions],
    exportMarkdown: () => formatSuggestionsExport(state()),
    async handle(request, response, target) {
      const route = target.pathname;
      const routes = new Set([
        "/api/suggestions",
        "/api/suggestions/delete",
        "/api/suggestions/clear",
        "/api/suggestions/export",
      ]);
      if (!routes.has(route)) return false;

      if (route === "/api/suggestions/export") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendJson(
            response,
            405,
            { error: "Method not allowed" },
            { allow: "GET, HEAD" },
          );
          return true;
        }
        const markdown = formatSuggestionsExport(state());
        if (request.method === "HEAD") {
          response.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-length": Buffer.byteLength(markdown),
            "cache-control": "no-store",
          });
          response.end();
          return true;
        }
        sendText(response, 200, markdown, "text/markdown; charset=utf-8");
        return true;
      }

      if (route === "/api/suggestions") {
        const method = request.method ?? "";
        if (!["GET", "HEAD", "POST", "PATCH"].includes(method)) {
          sendJson(
            response,
            405,
            { error: "Method not allowed" },
            { allow: "GET, HEAD, POST, PATCH" },
          );
          return true;
        }
        try {
          if (method === "POST") {
            assertMutationAllowed(request);
            const created = await create(await readJsonBody(request));
            sendJson(response, 201, { suggestion: created, ...state() });
            return true;
          }
          if (method === "PATCH") {
            assertMutationAllowed(request);
            const updated = await update(await readJsonBody(request));
            sendJson(response, 200, { suggestion: updated, ...state() });
            return true;
          }
          sendJson(response, 200, state());
        } catch (error) {
          if (!(error instanceof RequestError)) throw error;
          if (response.destroyed) return true;
          sendJson(response, error.status, { error: error.message }, {
            connection: "close",
          });
        }
        return true;
      }

      if (route === "/api/suggestions/delete" || route === "/api/suggestions/clear") {
        if (request.method !== "POST") {
          sendJson(
            response,
            405,
            { error: "Method not allowed" },
            { allow: "POST" },
          );
          return true;
        }
        try {
          assertMutationAllowed(request);
          const body = await readJsonBody(request);
          if (route === "/api/suggestions/delete") await remove(body);
          else await clear(body);
          sendJson(response, 200, state());
        } catch (error) {
          if (!(error instanceof RequestError)) throw error;
          if (response.destroyed) return true;
          sendJson(response, error.status, { error: error.message }, {
            connection: "close",
          });
        }
        return true;
      }

      return false;
    },
  };
}

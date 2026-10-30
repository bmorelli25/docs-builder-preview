import { mkdtemp, readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ReviewModel } from "../src/model.js";
import { startReviewServer, type RunningServer } from "../src/server.js";
import {
  formatSuggestionsExport,
  MAX_SUGGESTION_BODY_BYTES,
  suggestionsFilePath,
  type Suggestion,
} from "../src/suggestions.js";
import type { SourceLocator, TextQuote } from "../src/source-locate.js";

const running: RunningServer[] = [];

const review: ReviewModel = {
  repositoryPath: "/tmp/docs-content",
  baseRef: "main",
  mergeBase: "abc123",
  warnings: [],
  files: [
    {
      path: "docs/guide.md",
      status: "modified",
      route: "/docs/guide",
      addedLines: 1,
      deletedLines: 0,
      blocks: [],
      deletedHunks: [],
    },
  ],
};

function locator(overrides: Partial<SourceLocator> = {}): SourceLocator {
  return {
    rebuild: async () => undefined,
    fileForRoute: () => "docs/guide.md",
    locate: async (_route, quote: TextQuote) => ({
      path: "docs/guide.md",
      startLine: 3,
      endLine: 3,
      source: "{{kib}} might prompt you.",
      heading: "Switch to Agent Builder",
      exact: quote.exact,
      found: true,
    }),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

async function start(options: {
  storageDir?: string;
  locator?: SourceLocator;
  branch?: string;
} = {}): Promise<{ server: RunningServer; storageDir: string }> {
  const storageDir =
    options.storageDir ?? (await mkdtemp(join(tmpdir(), "suggestions-")));
  const server = await startReviewServer({
    review,
    port: 0,
    suggestions: {
      branch: options.branch ?? "docs/feature",
      locator: options.locator ?? locator(),
      storageDir,
    },
  });
  running.push(server);
  return { server, storageDir };
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
        path: options.path ?? "/api/suggestions",
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
    body: JSON.stringify(body),
  });
}

const sampleSuggestion = (): Suggestion => ({
  id: "s1",
  route: "/docs/guide",
  quote: {
    exact: "Kibana might prompt you.",
    prefix: "Switch ",
    suffix: " when ready",
  },
  kind: "replace",
  newText: "Kibana prompts you.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  location: {
    path: "docs/guide.md",
    startLine: 3,
    endLine: 3,
    source: "{{kib}} might prompt you.",
    heading: "Switch to Agent Builder",
    exact: "Kibana might prompt you.",
    found: true,
  },
});

describe("formatSuggestionsExport", () => {
  it("formats replace, instruction, and delete entries", () => {
    const markdown = formatSuggestionsExport({
      repositoryPath: "/tmp/docs-content",
      branch: "docs/feature",
      suggestions: [
        sampleSuggestion(),
        {
          ...sampleSuggestion(),
          id: "s2",
          kind: "instruction",
          newText: "Make this shorter.",
          location: {
            ...sampleSuggestion().location,
            startLine: 10,
            endLine: 12,
          },
        },
        {
          ...sampleSuggestion(),
          id: "s3",
          kind: "delete",
          newText: "",
          quote: { exact: "Remove me.", prefix: "", suffix: "" },
          location: {
            ...sampleSuggestion().location,
            path: "docs/other.md",
            startLine: 1,
            endLine: 1,
            source: "Remove me.",
            found: false,
          },
        },
      ],
    });

    expect(markdown).toContain("# Documentation edit suggestions");
    expect(markdown).toContain("Type: Replace");
    expect(markdown).toContain("Type: Instruction");
    expect(markdown).toContain("Type: Delete");
    expect(markdown).toContain("> Kibana prompts you.");
    expect(markdown).toContain("> Make this shorter.");
    expect(markdown).toContain("> (delete)");
    expect(markdown).toContain("{{kib}} might prompt you.");
    expect(markdown).toContain("Note: original text was not found");
    expect(markdown).toMatch(/substitutions such as \{\{[\w.-]+\}\}/i);
    expect(markdown).toMatch(/links/i);
    expect(markdown).toMatch(/Replace/i);
    expect(markdown).toContain(
      "New text is the desired wording as it appeared in the preview",
    );
    expect(markdown).toContain(
      "unless the suggestion explicitly says to remove or change them",
    );
  });
});

describe("suggestions API", () => {
  it("creates, updates, deletes, clears, and persists suggestions", async () => {
    const { server, storageDir } = await start();

    const created = await postJson(server, "/api/suggestions", {
      route: "/docs/guide",
      quote: {
        exact: "Kibana might prompt you.",
        prefix: "",
        suffix: "",
      },
      kind: "replace",
      newText: "Kibana prompts you.",
    });
    expect(created.status).toBe(201);
    const createdBody = JSON.parse(created.body);
    expect(createdBody.suggestions).toHaveLength(1);
    const id = createdBody.suggestion.id as string;

    const file = suggestionsFilePath(
      review.repositoryPath,
      "docs/feature",
      storageDir,
    );
    expect(JSON.parse(await readFile(file, "utf8")).suggestions).toHaveLength(1);

    const updated = await raw(server, {
      method: "PATCH",
      path: "/api/suggestions",
      headers: {
        "content-type": "application/json",
        origin: server.url,
      },
      body: JSON.stringify({ id, kind: "instruction", newText: "Shorten this." }),
    });
    expect(updated.status).toBe(200);
    expect(JSON.parse(updated.body).suggestion.kind).toBe("instruction");

    const exported = await raw(server, {
      method: "GET",
      path: "/api/suggestions/export",
    });
    expect(exported.status).toBe(200);
    expect(exported.body).toContain("Type: Instruction");
    expect(exported.body).toContain("> Shorten this.");

    const deleted = await postJson(server, "/api/suggestions/delete", { id });
    expect(deleted.status).toBe(200);
    expect(JSON.parse(deleted.body).suggestions).toHaveLength(0);

    await postJson(server, "/api/suggestions", {
      route: "/docs/guide",
      quote: { exact: "Again.", prefix: "", suffix: "" },
      kind: "delete",
      newText: "",
    });
    const cleared = await postJson(server, "/api/suggestions/clear", {});
    expect(JSON.parse(cleared.body).suggestions).toHaveLength(0);
  });

  it("rejects bad Origin, content type, and oversized bodies", async () => {
    const { server } = await start();
    const badOrigin = await postJson(
      server,
      "/api/suggestions",
      {
        route: "/docs/guide",
        quote: { exact: "Hello", prefix: "", suffix: "" },
        kind: "replace",
        newText: "Hi",
      },
      { origin: "http://evil.example" },
    );
    expect(badOrigin.status).toBe(403);

    const badType = await raw(server, {
      path: "/api/suggestions",
      headers: {
        "content-type": "text/plain",
        origin: server.url,
      },
      body: "{}",
    });
    expect(badType.status).toBe(415);

    const oversized = await raw(server, {
      path: "/api/suggestions",
      headers: {
        "content-type": "application/json",
        origin: server.url,
        "content-length": String(MAX_SUGGESTION_BODY_BYTES + 1),
      },
      body: "x".repeat(MAX_SUGGESTION_BODY_BYTES + 1),
    });
    expect(oversized.status).toBe(413);
  });

  it("reloads persisted suggestions for a new server instance", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "suggestions-persist-"));
    const first = await start({ storageDir });
    await postJson(first.server, "/api/suggestions", {
      route: "/docs/guide",
      quote: { exact: "Persisted text.", prefix: "", suffix: "" },
      kind: "replace",
      newText: "Still here.",
    });
    await first.server.close();
    running.pop();

    const second = await start({ storageDir });
    const listed = await raw(second.server, {
      method: "GET",
      path: "/api/suggestions",
    });
    expect(JSON.parse(listed.body).suggestions).toHaveLength(1);
    expect(JSON.parse(listed.body).suggestions[0].quote.exact).toBe(
      "Persisted text.",
    );
  });
});

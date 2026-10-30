import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  normalizeVisibleText,
  segmentMarkdown,
  type SourceBlock,
} from "./markdown.js";
import { sourcePathToRoute } from "./routes.js";
import { includeTargets } from "./snippets.js";

const execFileAsync = promisify(execFile);

export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface SourceLocation {
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  heading?: string;
  exact: string;
  found: boolean;
}

export interface SourceLocator {
  rebuild(): Promise<void>;
  locate(route: string, quote: TextQuote): Promise<SourceLocation>;
  fileForRoute(route: string): string | undefined;
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.stdout;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function routeKey(route: string): string {
  let path = route.split(/[?#]/, 1)[0];
  try {
    path = decodeURI(path);
  } catch {
    // Keep malformed escapes as written.
  }
  return path.length > 1 ? path.replace(/\/+$/, "") : path || "/";
}

function visible(source: string, substitutions: Record<string, string>): string {
  return normalizeSpace(normalizeVisibleText(source, substitutions));
}

function nearestHeading(
  blocks: SourceBlock[],
  startLine: number,
): string | undefined {
  let heading: string | undefined;
  for (const block of blocks) {
    if (block.startLine > startLine) break;
    if (block.kind === "heading") heading = block.text || undefined;
  }
  return heading;
}

function findQuoteInText(
  haystack: string,
  quote: TextQuote,
): { start: number; end: number } | undefined {
  const exact = normalizeSpace(quote.exact);
  if (!exact) return undefined;
  const needle = normalizeSpace(haystack);
  if (!needle) return undefined;

  const matches: number[] = [];
  let from = 0;
  while (from <= needle.length) {
    const index = needle.indexOf(exact, from);
    if (index === -1) break;
    matches.push(index);
    from = index + Math.max(1, exact.length);
  }
  if (matches.length === 0) return undefined;

  const prefix = normalizeSpace(quote.prefix);
  const suffix = normalizeSpace(quote.suffix);
  const scored = matches.map((start) => {
    const before = needle.slice(Math.max(0, start - prefix.length - 8), start);
    const after = needle.slice(
      start + exact.length,
      start + exact.length + suffix.length + 8,
    );
    let score = 0;
    if (prefix && before.endsWith(prefix)) score += 2;
    else if (prefix && before.includes(prefix)) score += 1;
    if (suffix && after.startsWith(suffix)) score += 2;
    else if (suffix && after.includes(suffix)) score += 1;
    return { start, score };
  });
  scored.sort((left, right) => right.score - left.score || left.start - right.start);
  const best = scored[0];
  return { start: best.start, end: best.start + exact.length };
}

function locateInSource(
  path: string,
  source: string,
  quote: TextQuote,
  substitutions: Record<string, string>,
): SourceLocation | undefined {
  const blocks = segmentMarkdown(source);
  const exact = normalizeSpace(quote.exact);
  if (!exact) return undefined;

  const overlapping: SourceBlock[] = [];
  for (const block of blocks) {
    const text = visible(block.source, substitutions);
    if (!text) continue;
    if (findQuoteInText(text, quote) || text.includes(exact)) {
      overlapping.push(block);
    }
  }

  if (overlapping.length === 0) {
    // Cross-block selection: search the joined visible page text.
    const joined = blocks
      .map((block) => visible(block.source, substitutions))
      .filter(Boolean)
      .join(" ");
    if (!findQuoteInText(joined, quote)) return undefined;
    const containing = blocks.filter((block) => {
      const text = visible(block.source, substitutions);
      return [...exact.split(" ")].some((token) => token.length > 2 && text.includes(token));
    });
    if (containing.length === 0) return undefined;
    overlapping.push(...containing);
  }

  overlapping.sort((left, right) => left.startLine - right.startLine);
  const startLine = overlapping[0].startLine;
  const endLine = overlapping.at(-1)!.endLine;
  const excerpt = overlapping.map((block) => block.source).join("\n");
  return {
    path,
    startLine,
    endLine,
    source: excerpt,
    heading: nearestHeading(blocks, startLine),
    exact: normalizeSpace(quote.exact),
    found: true,
  };
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    const contents = await readFile(path);
    if (contents.includes(0)) return undefined;
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return undefined;
  }
}

async function resolveInclude(
  root: string,
  consumerPath: string,
  target: string,
): Promise<string | undefined> {
  const resolved = resolve(root, dirname(consumerPath), target);
  const relative = resolved.startsWith(root + sep) || resolved === root
    ? resolved.slice(root.length).replace(/^[/\\]/, "").split(sep).join("/")
    : undefined;
  if (!relative) return undefined;
  const source = await readTextFile(resolve(root, relative));
  return source === undefined ? undefined : relative;
}

export function suggestionStoreKey(repositoryPath: string, branch: string): string {
  const digest = createHash("sha1").update(repositoryPath).digest("hex").slice(0, 16);
  const safeBranch = branch.replace(/[^\w.@+=-]+/g, "_").slice(0, 120) || "HEAD";
  return `${digest}/${safeBranch}`;
}

export async function createSourceLocator(options: {
  repositoryPath: string;
  substitutions?: () => Record<string, string>;
}): Promise<SourceLocator> {
  const root = await realpath(
    (await git(options.repositoryPath, ["rev-parse", "--show-toplevel"])).trim(),
  );
  let routes = new Map<string, string>();

  const rebuild = async () => {
    try {
      const listed = (
        await git(root, [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          "*.md",
          "*.mdx",
        ])
      )
        .split("\0")
        .filter(Boolean);
      const next = new Map<string, string>();
      for (const path of listed) {
        const route = sourcePathToRoute(path);
        if (!route) continue;
        next.set(routeKey(route), path);
        if (route.endsWith("/")) next.set(routeKey(route.slice(0, -1)), path);
      }
      routes = next;
    } catch {
      // The repository may have been removed during tests or shutdown.
    }
  };

  await rebuild();

  const substitutions = () => options.substitutions?.() ?? {};

  const locateInFile = async (
    path: string,
    quote: TextQuote,
  ): Promise<SourceLocation | undefined> => {
    const source = await readTextFile(resolve(root, path));
    if (source === undefined) return undefined;
    return locateInSource(path, source, quote, substitutions());
  };

  return {
    rebuild,
    fileForRoute(route) {
      return routes.get(routeKey(route));
    },
    async locate(route, quote) {
      const path = routes.get(routeKey(route));
      const exact = normalizeSpace(quote.exact);
      if (!path) {
        return {
          path: route.replace(/^\//, "") + ".md",
          startLine: 1,
          endLine: 1,
          source: exact,
          exact,
          found: false,
        };
      }

      const direct = await locateInFile(path, quote);
      if (direct) return direct;

      const pageSource = await readTextFile(resolve(root, path));
      if (pageSource) {
        for (const target of includeTargets(pageSource)) {
          const included = await resolveInclude(root, path, target);
          if (!included) continue;
          const hit = await locateInFile(included, quote);
          if (hit) return hit;
        }
      }

      const blocks = pageSource ? segmentMarkdown(pageSource) : [];
      return {
        path,
        startLine: 1,
        endLine: 1,
        source: exact,
        heading: nearestHeading(blocks, Number.POSITIVE_INFINITY),
        exact,
        found: false,
      };
    },
  };
}

/** Test helper: locate a quote in an in-memory Markdown source. */
export function locateQuoteInMarkdown(
  path: string,
  source: string,
  quote: TextQuote,
  substitutions: Record<string, string> = {},
): SourceLocation | undefined {
  return locateInSource(path, source, quote, substitutions);
}

import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(repositoryPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.stdout;
}

function pathWithinRoot(root: string, path: string): string | undefined {
  const repositoryRelative = relative(root, path);
  if (
    repositoryRelative === ".." ||
    repositoryRelative.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelative)
  ) {
    return undefined;
  }
  return repositoryRelative.split(sep).join("/");
}

async function normalizeChangedPath(
  root: string,
  changedPath: string,
): Promise<string | undefined> {
  const fullPath = isAbsolute(changedPath)
    ? resolve(changedPath)
    : resolve(root, changedPath);
  return canonicalFileWithinRoot(root, fullPath);
}

async function canonicalFileWithinRoot(
  root: string,
  path: string,
): Promise<string | undefined> {
  try {
    const canonicalPath = await realpath(path);
    if (!(await lstat(canonicalPath)).isFile()) return undefined;
    return pathWithinRoot(root, canonicalPath);
  } catch {
    return undefined;
  }
}

function includeTargets(source: string): string[] {
  const targets: string[] = [];
  let codeFence: string | undefined;
  const directiveFences: string[] = [];

  const addTarget = (rawTarget: string) => {
    let target = rawTarget.trim();
    if (
      (target.startsWith('"') && target.endsWith('"')) ||
      (target.startsWith("'") && target.endsWith("'")) ||
      (target.startsWith("<") && target.endsWith(">"))
    ) {
      target = target.slice(1, -1);
    }
    if (
      target &&
      !target.startsWith("#") &&
      !/^[A-Za-z][A-Za-z\d+.-]*:/.test(target)
    ) {
      targets.push(target);
    }
  };

  for (const line of source.split(/\r?\n/)) {
    if (codeFence) {
      if (
        new RegExp(`^\\s*${codeFence[0]}{${codeFence.length},}\\s*$`).test(
          line,
        )
      ) {
        codeFence = undefined;
      }
      continue;
    }

    const activeDirective = directiveFences.at(-1);
    if (
      activeDirective &&
      new RegExp(
        `^\\s*${activeDirective[0]}{${activeDirective.length},}\\s*$`,
      ).test(line)
    ) {
      directiveFences.pop();
      continue;
    }

    const fenced = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenced) {
      const directive = fenced[2]
        .trim()
        .match(/^\{([^}]+)\}(?:\s+(.+))?$/);
      if (!directive) {
        codeFence = fenced[1];
        continue;
      }
      directiveFences.push(fenced[1]);
      if (
        /^(?:include|literalinclude)$/i.test(directive[1]) &&
        directive[2]
      ) {
        addTarget(directive[2]);
      }
      continue;
    }

    const colon = line.match(/^\s*(:{3,})\{([^}]+)\}(?:\s+(.+))?$/);
    if (colon) {
      directiveFences.push(colon[1]);
      if (/^(?:include|literalinclude)$/i.test(colon[2]) && colon[3]) {
        addTarget(colon[3]);
      }
    }
  }
  return targets;
}

async function readMarkdownConsumer(
  root: string,
  repositoryRelativePath: string,
): Promise<string | undefined> {
  const fullPath = resolve(root, repositoryRelativePath);
  if (pathWithinRoot(root, fullPath) === undefined) return undefined;

  const status = await lstat(fullPath);
  if (!status.isFile() || status.isSymbolicLink()) return undefined;
  const contents = await readFile(fullPath);
  if (contents.includes(0)) return undefined;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return undefined;
  }
}

export async function findSnippetConsumers(
  repositoryPath: string,
  snippetPaths: string[],
): Promise<Map<string, string[]>> {
  const root = await realpath(
    (await git(repositoryPath, ["rev-parse", "--show-toplevel"])).trim(),
  );
  const normalizedSnippetPaths = [
    ...new Set(
      (await Promise.all(
        snippetPaths.map((path) => normalizeChangedPath(root, path)),
      )).filter((path): path is string => path !== undefined),
    ),
  ];
  const consumers = new Map(
    normalizedSnippetPaths.map((path) => [path, [] as string[]]),
  );
  if (consumers.size === 0) return consumers;

  const markdownPaths = (
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
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  await Promise.all(
    markdownPaths.map(async (consumerPath) => {
      let source: string | undefined;
      try {
        source = await readMarkdownConsumer(root, consumerPath);
      } catch {
        return;
      }
      if (source === undefined) return;

      const matched = new Set<string>();
      for (const target of includeTargets(source)) {
        const resolvedTarget = resolve(root, dirname(consumerPath), target);
        const normalizedTarget = await canonicalFileWithinRoot(
          root,
          resolvedTarget,
        );
        if (normalizedTarget && consumers.has(normalizedTarget)) {
          matched.add(normalizedTarget);
        }
      }
      for (const target of matched) {
        consumers.get(target)?.push(consumerPath.split(sep).join("/"));
      }
    }),
  );

  for (const paths of consumers.values()) {
    paths.sort((left, right) => left.localeCompare(right));
  }
  return consumers;
}

export type SourceBlockKind =
  | "heading"
  | "paragraph"
  | "list-item"
  | "code"
  | "directive";

export interface SourceBlock {
  kind: SourceBlockKind;
  startLine: number;
  endLine: number;
  source: string;
  text: string;
}

const directiveOption = /^\s*:[A-Za-z][\w-]*:\s*/;
const listItem = /^(\s*)(?:[-+*]|\d+[.)])\s+/;

function decodeEntities(source: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return source.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (entity, decimal: string, hexadecimal: string, name: string) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hexadecimal) return String.fromCodePoint(parseInt(hexadecimal, 16));
      return named[name.toLowerCase()] ?? entity;
    },
  );
}

export function normalizeVisibleText(source: string): string {
  const sourceLines = source.split(/\r?\n/);
  const openingFence = sourceLines[0]?.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (
    openingFence &&
    !openingFence[2].trim().startsWith("{") &&
    new RegExp(
      `^\\s*${openingFence[1][0]}{${openingFence[1].length},}\\s*$`,
    ).test(sourceLines.at(-1) ?? "")
  ) {
    return sourceLines.slice(1, -1).join(" ").replace(/\s+/g, " ").trim();
  }

  const visibleLines = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !directiveOption.test(line) &&
        !/^(?:`{3,}|~{3,})(?:\{[^}]+\}.*|\w*)?\s*$/.test(trimmed) &&
        !/^:{3,}(?:\{[^}]+\}.*)?$/.test(trimmed) &&
        !/^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?$/.test(trimmed)
      );
    })
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}(?:\s+|$)/, "")
        .replace(/^\s*>\s?/, "")
        .replace(listItem, "")
        .replace(/^\s*\|?|\|?\s*$/g, "")
        .replace(/\s*\|\s*/g, " "),
    )
    .join(" ");

  return decodeEntities(visibleLines)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/`+([^`]+?)`+/g, "$1")
    .replace(/\\([\\`*_[\]{}()#+.!|>-])/g, "$1")
    .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
    .replace(/([*_])([^*_\s](?:.*?[^*_\s])?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

function block(
  kind: SourceBlockKind,
  lines: string[],
  start: number,
  end: number,
  visibleSource = lines.slice(start, end + 1).join("\n"),
): SourceBlock | undefined {
  const source = lines.slice(start, end + 1).join("\n");
  const text =
    kind === "code"
      ? visibleSource.replace(/\s+/g, " ").trim()
      : normalizeVisibleText(visibleSource);
  if (!text) return undefined;
  return {
    kind,
    startLine: start + 1,
    endLine: end + 1,
    source,
    text,
  };
}

function fenceAt(line: string) {
  return line.match(/^\s*(`{3,}|~{3,})(.*)$/);
}

function colonDirectiveAt(line: string) {
  return line.match(/^\s*(:{3,})\{([^}]+)\}(?:\s+.*)?$/);
}

function startsBlock(line: string): boolean {
  return (
    /^\s{0,3}#{1,6}(?:\s+|$)/.test(line) ||
    listItem.test(line) ||
    Boolean(fenceAt(line)) ||
    Boolean(colonDirectiveAt(line))
  );
}

export function segmentMarkdown(source: string): SourceBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: SourceBlock[] = [];

  for (let index = 0; index < lines.length; ) {
    if (!lines[index].trim()) {
      index++;
      continue;
    }

    const fence = fenceAt(lines[index]);
    if (fence) {
      const start = index;
      const marker = fence[1];
      const info = fence[2].trim();
      index++;
      while (
        index < lines.length &&
        !new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(
          lines[index],
        )
      ) {
        index++;
      }
      if (index < lines.length) index++;
      const end = index - 1;
      const directiveName = info.match(/^\{([^}]+)\}/)?.[1].toLowerCase();
      if (directiveName === "include" || directiveName === "literalinclude") {
        continue;
      }
      const candidate = block(
        directiveName ? "directive" : "code",
        lines,
        start,
        end,
        lines.slice(start + 1, Math.max(start + 1, end)).join("\n"),
      );
      if (candidate) blocks.push(candidate);
      continue;
    }

    const directive = colonDirectiveAt(lines[index]);
    if (directive) {
      const start = index;
      const markerLength = directive[1].length;
      const directiveName = directive[2].toLowerCase();
      index++;
      while (
        index < lines.length &&
        !new RegExp(`^\\s*:{${markerLength},}\\s*$`).test(lines[index])
      ) {
        index++;
      }
      if (index < lines.length) index++;
      const end = index - 1;
      if (directiveName === "include" || directiveName === "literalinclude") {
        continue;
      }
      const candidate = block(
        "directive",
        lines,
        start,
        end,
        lines.slice(start + 1, Math.max(start + 1, end)).join("\n"),
      );
      if (candidate) blocks.push(candidate);
      continue;
    }

    if (/^\s{0,3}#{1,6}(?:\s+|$)/.test(lines[index])) {
      const candidate = block("heading", lines, index, index);
      if (candidate) blocks.push(candidate);
      index++;
      continue;
    }

    if (
      index + 1 < lines.length &&
      /^\s*(?:=+|-+)\s*$/.test(lines[index + 1])
    ) {
      const candidate = block("heading", lines, index, index + 1, lines[index]);
      if (candidate) blocks.push(candidate);
      index += 2;
      continue;
    }

    const item = lines[index].match(listItem);
    if (item) {
      const start = index;
      const indentation = item[1].length;
      index++;
      while (index < lines.length && lines[index].trim()) {
        const nextItem = lines[index].match(listItem);
        if (nextItem && nextItem[1].length <= indentation) break;
        if (startsBlock(lines[index]) && !/^\s+/.test(lines[index])) break;
        index++;
      }
      const candidate = block("list-item", lines, start, index - 1);
      if (candidate) blocks.push(candidate);
      continue;
    }

    const start = index;
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines[index]) &&
      !(
        index + 1 < lines.length &&
        /^\s*(?:=+|-+)\s*$/.test(lines[index + 1])
      )
    ) {
      index++;
    }
    const candidate = block("paragraph", lines, start, index - 1);
    if (candidate) blocks.push(candidate);
  }

  return blocks;
}

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
      const numericValue = decimal
        ? Number(decimal)
        : hexadecimal
          ? parseInt(hexadecimal, 16)
          : undefined;
      if (numericValue !== undefined) {
        if (
          !Number.isSafeInteger(numericValue) ||
          numericValue <= 0 ||
          numericValue > 0x10ffff ||
          (numericValue >= 0xd800 && numericValue <= 0xdfff)
        ) {
          return entity;
        }
        return String.fromCodePoint(numericValue);
      }
      return named[name.toLowerCase()] ?? entity;
    },
  );
}

interface ProtectedInlineCode {
  source: string;
  restore(source: string): string;
}

function protectInlineCode(source: string): ProtectedInlineCode {
  const values: string[] = [];
  let tokenPrefix = "\uE000CODE";
  while (source.includes(tokenPrefix)) tokenPrefix += "X";
  let protectedSource = "";

  for (let index = 0; index < source.length; ) {
    if (source[index] !== "`") {
      protectedSource += source[index++];
      continue;
    }

    const openingStart = index;
    while (source[index] === "`") index++;
    const delimiterLength = index - openingStart;
    let closingStart = index;

    while (closingStart < source.length) {
      closingStart = source.indexOf("`", closingStart);
      if (closingStart === -1) break;
      let closingEnd = closingStart;
      while (source[closingEnd] === "`") closingEnd++;
      if (closingEnd - closingStart === delimiterLength) break;
      closingStart = closingEnd;
    }

    if (closingStart === -1 || closingStart >= source.length) {
      protectedSource += source.slice(openingStart, index);
      continue;
    }

    let value = source.slice(index, closingStart).replace(/\r?\n/g, " ");
    if (
      value.startsWith(" ") &&
      value.endsWith(" ") &&
      /[^ ]/.test(value)
    ) {
      value = value.slice(1, -1);
    }
    const token = `${tokenPrefix}${values.length}\uE001`;
    values.push(value);
    protectedSource += token;
    index = closingStart + delimiterLength;
  }

  return {
    source: protectedSource,
    restore(normalizedSource: string) {
      return values.reduce(
        (result, value, index) =>
          result.replaceAll(`${tokenPrefix}${index}\uE001`, value),
        normalizedSource,
      );
    },
  };
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function balancedEnd(
  source: string,
  start: number,
  opening: string,
  closing: string,
): number | undefined {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (isEscaped(source, index)) continue;
    if (source[index] === opening) depth++;
    if (source[index] === closing && --depth === 0) return index;
  }
  return undefined;
}

function containsWhitespace(source: string): boolean {
  return /\s/.test(source);
}

function stripLinkDestinations(source: string): string {
  let visible = "";

  for (let index = 0; index < source.length; ) {
    const image = source[index] === "!" && source[index + 1] === "[";
    const labelStart = image ? index + 1 : index;
    if (
      source[labelStart] !== "[" ||
      isEscaped(source, labelStart)
    ) {
      visible += source[index++];
      continue;
    }

    const labelEnd = balancedEnd(source, labelStart, "[", "]");
    if (labelEnd === undefined) {
      visible += source[index++];
      continue;
    }

    const destinationStart = labelEnd + 1;
    if (source[destinationStart] === "(") {
      const destinationEnd = balancedEnd(
        source,
        destinationStart,
        "(",
        ")",
      );
      const destination =
        destinationEnd === undefined
          ? undefined
          : source.slice(destinationStart + 1, destinationEnd);
      if (
        destinationEnd !== undefined &&
        destination !== undefined &&
        !containsWhitespace(destination)
      ) {
        visible += source.slice(labelStart + 1, labelEnd);
        index = destinationEnd + 1;
        continue;
      }
    } else if (source[destinationStart] === "[") {
      const referenceEnd = balancedEnd(
        source,
        destinationStart,
        "[",
        "]",
      );
      if (referenceEnd !== undefined) {
        visible += source.slice(labelStart + 1, labelEnd);
        index = referenceEnd + 1;
        continue;
      }
    }

    visible += source[index++];
  }
  return visible;
}

/** Stands in for link text docs-builder generates, such as `[](/page.md)` titles. */
export const generatedTextGap = "\uFFFC";

export function normalizeVisibleText(
  source: string,
  substitutions: Record<string, string> = {},
): string {
  const expandedSource = source
    .replace(/\{\{([^{}\r\n]+)\}\}/g, (token, key: string) =>
      Object.hasOwn(substitutions, key)
        ? substitutions[key]
        : /^[\w.-]+$/.test(key.trim())
          ? ` ${generatedTextGap} `
          : token,
    )
    .replace(/^(\s*#{1,6}\s.*?)\s*\[[\w.-]+\]\s*$/gm, "$1")
    .replace(/\{(?:applies_to|icon)\}\s*`[^`\r\n]*`/g, "")
    .replace(/(?<!!)\[\]\([^()\s]*\)/g, ` ${generatedTextGap} `);
  const sourceLines = expandedSource.split(/\r?\n/);
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

  const inlineCode = protectInlineCode(expandedSource);
  const visibleLines = inlineCode.source
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
    .map((line) => {
      const atxHeading = line.match(/^\s{0,3}#{1,6}(?:[ \t]+|$)/);
      const visibleLine = atxHeading
        ? line
            .slice(atxHeading[0].length)
            .replace(/(?:[ \t]+#+[ \t]*|^#+[ \t]*)$/, "")
        : line;
      return visibleLine
        .replace(/^\s*>\s?/, "")
        .replace(listItem, "")
        .replace(/^\s*\|?|\|?\s*$/g, "")
        .replace(/\s*\|\s*/g, " ");
    })
    .join(" ");

  const normalized = decodeEntities(stripLinkDestinations(visibleLines))
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\\([\\`*_[\]{}()#+.!|>-])/g, "$1")
    .replace(/(\*\*|~~)(?=\S)(.+?\S)\1/g, "$2")
    .replace(
      /(^|[^\p{L}\p{N}_])__(?=\S)(.+?\S)__(?![\p{L}\p{N}_])/gu,
      "$1$2",
    )
    .replace(/\*(?=\S)(.+?\S)\*/g, "$1")
    .replace(
      /(^|[^\p{L}\p{N}_])_(?=\S)(.+?\S)_(?![\p{L}\p{N}_])/gu,
      "$1$2",
    )
    .replace(/\s+/g, " ")
    .trim();
  return inlineCode.restore(normalized);
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

function isThematicBreak(line: string): boolean {
  return /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function isSetextUnderline(line: string): boolean {
  return /^\s*(?:=+|-+)\s*$/.test(line);
}

function isTableRow(line: string): boolean {
  return /^\s{0,3}\|/.test(line);
}

function startsBlock(line: string): boolean {
  return (
    /^\s{0,3}#{1,6}(?:\s+|$)/.test(line) ||
    isTableRow(line) ||
    listItem.test(line) ||
    isThematicBreak(line) ||
    Boolean(fenceAt(line)) ||
    Boolean(colonDirectiveAt(line))
  );
}

function findSetextUnderline(
  lines: string[],
  start: number,
): number | undefined {
  for (let index = start + 1; index < lines.length; index++) {
    if (isSetextUnderline(lines[index])) return index;
    if (!lines[index].trim() || startsBlock(lines[index])) return undefined;
  }
  return undefined;
}

/** One-based line number of the closing frontmatter fence, or 0 when absent. */
export function frontmatterEndLine(source: string): number {
  const lines = source.split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] ?? "")) return 0;
  return lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line)) + 1;
}

export function segmentMarkdown(source: string): SourceBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: SourceBlock[] = [];
  const frontmatterEnd = frontmatterEndLine(source) - 1;

  for (let index = frontmatterEnd + 1; index < lines.length; ) {
    if (!lines[index].trim()) {
      index++;
      continue;
    }

    if (isThematicBreak(lines[index])) {
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
      const closed = index < lines.length;
      if (closed) index++;
      const end = index - 1;
      const contentEnd = closed ? end : end + 1;
      const directiveName = info.match(/^\{([^}]+)\}/)?.[1].toLowerCase();
      if (directiveName === "include" || directiveName === "literalinclude") {
        continue;
      }
      const candidate = block(
        directiveName ? "directive" : "code",
        lines,
        start,
        end,
        lines.slice(start + 1, Math.max(start + 1, contentEnd)).join("\n"),
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
      const closed = index < lines.length;
      if (closed) index++;
      const end = index - 1;
      const contentEnd = closed ? end : end + 1;
      if (directiveName === "include" || directiveName === "literalinclude") {
        continue;
      }
      const body = lines.slice(start + 1, Math.max(start + 1, contentEnd));
      for (const child of segmentMarkdown(body.join("\n"))) {
        blocks.push({
          ...child,
          startLine: child.startLine + start + 1,
          endLine: child.endLine + start + 1,
        });
      }
      continue;
    }

    if (/^\s{0,3}#{1,6}(?:\s+|$)/.test(lines[index])) {
      const candidate = block("heading", lines, index, index);
      if (candidate) blocks.push(candidate);
      index++;
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
        if (
          isSetextUnderline(lines[index]) &&
          !/^\s+/.test(lines[index])
        ) {
          break;
        }
        if (startsBlock(lines[index]) && !/^\s+/.test(lines[index])) break;
        index++;
      }
      const candidate = block("list-item", lines, start, index - 1);
      if (candidate) blocks.push(candidate);
      continue;
    }

    if (isTableRow(lines[index])) {
      const candidate = block("paragraph", lines, index, index);
      if (candidate) blocks.push(candidate);
      index++;
      continue;
    }

    const setextUnderline = findSetextUnderline(lines, index);
    if (setextUnderline !== undefined) {
      const candidate = block(
        "heading",
        lines,
        index,
        setextUnderline,
        lines.slice(index, setextUnderline).join("\n"),
      );
      if (candidate) blocks.push(candidate);
      index = setextUnderline + 1;
      continue;
    }

    const start = index;
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines[index])
    ) {
      index++;
    }
    const candidate = block("paragraph", lines, start, index - 1);
    if (candidate) blocks.push(candidate);
  }

  return blocks;
}

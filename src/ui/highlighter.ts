import type { ReviewModel } from "../model.js";
import { normalizeVisibleText } from "../markdown.js";
import { wordTokenSource } from "../word-diff.js";

export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function createSourceBase(
  repositoryPath: string,
  filePath: string,
): string {
  const repository = repositoryPath
    .replaceAll("\\", "/")
    .replace(/\/+$/, "");
  const path = filePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const encodedPath = `${repository}/${path}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `vscode://file${encodedPath.startsWith("/") ? "" : "/"}${encodedPath}`;
}

export function createSourceHref(
  repositoryPath: string,
  filePath: string,
  line: number,
): string {
  const safeLine = Number.isSafeInteger(line) && line > 0 ? line : 1;
  return `${createSourceBase(repositoryPath, filePath)}:${safeLine}`;
}

function tabTitle(
  source: string,
  substitutions?: Record<string, string>,
): { tabTitle?: string } {
  const title = source.match(/^\s*:{3,}\{tab-item\}[ \t]+(.+)$/m)?.[1];
  return title ? { tabTitle: normalizeVisibleText(title, substitutions) } : {};
}

function stepTitle(
  source: string,
  substitutions?: Record<string, string>,
): string {
  const title = source.match(/^\s*:{3,}\{step\}[ \t]+(.+)$/m)?.[1];
  return title ? normalizeVisibleText(title, substitutions) : "";
}

export function createHighlighterData(review: ReviewModel): string {
  return safeJson({
    repositoryPath: review.repositoryPath,
    files: review.files.map((file) => ({
      ...file,
      sourceBase: createSourceBase(review.repositoryPath, file.path),
      blocks: file.blocks.map((block) => ({
          ...block,
          text: normalizeVisibleText(block.source, review.substitutions) ||
            stepTitle(block.source, review.substitutions),
          ...tabTitle(block.source, review.substitutions),
          ...(block.container && {
            container: {
              neighbor: normalizeVisibleText(
                block.container.neighborSource,
                review.substitutions,
              ),
              ...(block.container.title && {
                title: normalizeVisibleText(
                  block.container.title,
                  review.substitutions,
                ),
              }),
            },
          }),
          ...(block.imageAlt !== undefined && {
            imageAlt: normalizeVisibleText(block.imageAlt, review.substitutions),
          }),
          ...(block.appliesTo && {
            appliesTo: {
              index: block.appliesTo.index,
              heading: block.appliesTo.headingSource === undefined
                ? undefined
                : normalizeVisibleText(
                  block.appliesTo.headingSource,
                  review.substitutions,
                ),
            },
          }),
        })),
    })),
  });
}

export const parentHighlighterScript = `(() => {
  "use strict";
  const reviewDataElement = document.getElementById("review-data");
  const preview = document.querySelector('iframe[name="docs-preview"]');
  if (!reviewDataElement || !preview) return;
  const reviewData = JSON.parse(reviewDataElement.textContent || "{}");
  const files = new Map((reviewData.files || []).map((file) => [file.path, file]));
  const toolbar = document.getElementById("preview-toolbar");
  const previous = document.getElementById("review-previous");
  const next = document.getElementById("review-next");
  const status = document.getElementById("mapping-counts");
  const openSource = document.getElementById("open-source");
  const unmatchedPanel = document.getElementById("unmatched-panel");
  const unmatchedList = document.getElementById("unmatched-list");
  const deletedFallback = document.getElementById("deleted-fallback");
  const hideDeleted = document.getElementById("hide-deleted-lines");
  previous.textContent = "Previous";
  next.textContent = "Next";
  openSource.textContent = "Open source";
  const normalize = (value) => value
    .normalize("NFKC")
    .replace(/\\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
  const tokens = (value) => normalize(value).match(/[\\p{L}\\p{N}]+/gu) || [];
  const wordPattern = ${JSON.stringify(wordTokenSource)};
  const wordTokens = (value) => [...value.matchAll(new RegExp(wordPattern, "gu"))];
  const wordKey = (value) => value.normalize("NFKC").toLocaleLowerCase();
  const isWord = (value) => /[\\p{L}\\p{N}]/u.test(value);
  const maxAlignmentCells = 250000;
  const markWordsInPlace = (frameDocument, element, parts) => {
    const walker = frameDocument.createTreeWalker(element, 4, {
      acceptNode: (node) => node.parentElement?.closest(
        ".docs-review-del, .word-diff-panel, .deleted-inline, script, style"
      ) ? 2 : 1,
    });
    const nodes = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (text) text += " ";
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    const rendered = wordTokens(text).map((match) => ({
      key: wordKey(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    }));
    const expected = parts.flatMap((part, index) => part.kind === "delete"
      ? []
      : wordTokens(part.text).map((match) => ({
        key: wordKey(match[0]),
        part: index,
        word: isWord(match[0]),
      })));
    const rows = expected.length + 1;
    const columns = rendered.length + 1;
    if (expected.length === 0 || rows * columns > maxAlignmentCells) return false;
    const table = new Uint32Array(rows * columns);
    for (let i = expected.length - 1; i >= 0; i--) {
      for (let j = rendered.length - 1; j >= 0; j--) {
        table[i * columns + j] = expected[i].key === rendered[j].key
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
      }
    }
    const alignment = new Array(expected.length).fill(-1);
    for (let i = 0, j = 0; i < expected.length && j < rendered.length; ) {
      if (expected[i].key === rendered[j].key) alignment[i++] = j++;
      else if (table[(i + 1) * columns + j] >= table[i * columns + j + 1]) i++;
      else j++;
    }
    const equalWords = expected.filter((token) => token.word && parts[token.part].kind === "equal");
    const alignedEqualWords = equalWords.filter((token) => alignment[expected.indexOf(token)] >= 0);
    if (
      expected.some((token, index) =>
        token.word && parts[token.part].kind === "insert" && alignment[index] < 0) ||
      alignedEqualWords.length < equalWords.length * 0.8
    ) {
      return false;
    }
    const locate = (offset, preferEnd) => {
      const entry = nodes.findLast((candidate) => preferEnd
        ? candidate.start < offset
        : candidate.start <= offset);
      return entry && { node: entry.node, nodeIndex: nodes.indexOf(entry), at: offset - entry.start };
    };
    const edits = [];
    const wrap = (start, end) => {
      nodes.forEach(({ node, start: nodeStart }, nodeIndex) => {
        const from = Math.max(start, nodeStart) - nodeStart;
        const to = Math.min(end, nodeStart + node.data.length) - nodeStart;
        if (from < to && node.data.slice(from, to).trim()) {
          edits.push({ node, nodeIndex, at: from, to, kind: "insert" });
        }
      });
    };
    const deletions = [];
    let tokenIndex = 0;
    parts.forEach((part, partIndex) => {
      if (part.kind === "delete") {
        deletions.push({ part, before: tokenIndex });
        return;
      }
      const first = tokenIndex;
      while (tokenIndex < expected.length && expected[tokenIndex].part === partIndex) tokenIndex++;
      if (part.kind !== "insert") return;
      let run;
      for (let index = first; index <= tokenIndex; index++) {
        const position = index < tokenIndex ? alignment[index] : -1;
        if (run && position === run.last + 1) {
          run.last = position;
          continue;
        }
        if (run) wrap(rendered[run.first].start, rendered[run.last].end);
        run = position >= 0 ? { first: position, last: position } : undefined;
      }
    });
    for (const { part, before } of deletions) {
      const previousIndex = alignment.slice(0, before).findLast((position) => position >= 0);
      const nextIndex = alignment.slice(before).find((position) => position >= 0);
      const anchor = previousIndex !== undefined
        ? locate(rendered[previousIndex].end, true)
        : nextIndex !== undefined
          ? locate(rendered[nextIndex].start, false)
          : undefined;
      if (!anchor) return false;
      edits.push({
        ...anchor,
        kind: "delete",
        text: previousIndex !== undefined
          ? (part.spaceBefore ? " " : "") + part.text
          : part.text + (part.spaceAfter ? " " : ""),
      });
    }
    edits.sort((left, right) => left.nodeIndex - right.nodeIndex ||
      right.at - left.at ||
      (left.kind === right.kind ? 0 : left.kind === "insert" ? -1 : 1));
    for (const edit of edits) {
      if (edit.kind === "insert") {
        const middle = edit.at > 0 ? edit.node.splitText(edit.at) : edit.node;
        if (edit.to - edit.at < middle.data.length) middle.splitText(edit.to - edit.at);
        const inserted = frameDocument.createElement("ins");
        inserted.className = "docs-review-ins";
        middle.replaceWith(inserted);
        inserted.append(middle);
      } else {
        const removed = frameDocument.createElement("del");
        removed.className = "docs-review-del";
        removed.textContent = edit.text;
        if (edit.at === 0) {
          const wrapper = edit.node.parentElement;
          (wrapper?.classList.contains("docs-review-ins") && wrapper.firstChild === edit.node
            ? wrapper
            : edit.node).before(removed);
        } else {
          if (edit.at < edit.node.data.length) edit.node.splitText(edit.at);
          edit.node.after(removed);
        }
      }
    }
    return true;
  };
  const attachWordDiffPanel = (frameDocument, element, parts) => {
    const panel = frameDocument.createElement("aside");
    panel.className = "word-diff-panel";
    const title = frameDocument.createElement("div");
    title.className = "word-diff-panel-title";
    title.textContent = "Word changes";
    const body = frameDocument.createElement("div");
    parts.forEach((part, index) => {
      if (index > 0 && !/^[,.;:!?)\\]]/.test(part.text) && !/[(\\[]$/.test(parts[index - 1].text)) {
        body.append(" ");
      }
      const text = part.text.replace(/\uFFFC/g, "…");
      if (part.kind === "equal") {
        body.append(text);
        return;
      }
      const word = frameDocument.createElement(part.kind === "insert" ? "ins" : "del");
      word.className = part.kind === "insert" ? "docs-review-ins" : "docs-review-del";
      word.textContent = text;
      body.append(word);
    });
    panel.append(title, body);
    if (element.localName === "tr") element.cells[element.cells.length - 1]?.append(panel);
    else if (/^(?:li|td|th|dd)$/.test(element.localName)) element.append(panel);
    else element.insertAdjacentElement("afterend", panel);
    element.addEventListener("click", (event) => {
      if (event.target.closest?.("a, .word-diff-panel")) return;
      panel.classList.toggle("open");
    });
  };
  const sourceHref = (file, line) =>
    file.sourceBase + ":" + (Number.isSafeInteger(line) && line > 0 ? line : 1);
  const mappingStatus = (link, matched, unmatched) => {
    const indicator = link?.querySelector(".mapping-status");
    if (!indicator) return;
    indicator.textContent = matched + " matched · " + unmatched + " unmatched";
    indicator.dataset.mapping = unmatched === 0 ? "matched" : matched ? "partial" : "unmatched";
  };
  const revealCurrentNavItem = (frameDocument) => {
    const nav = frameDocument?.getElementById("pages-nav");
    const current = [...(nav?.querySelectorAll(".current") || [])]
      .find((element) => element.getClientRects().length > 0);
    if (!nav || !current) return;
    const navBox = nav.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    const stickyHeight = nav.querySelector(".sticky")?.getBoundingClientRect().height || 0;
    if (box.top >= navBox.top + stickyHeight && box.bottom <= navBox.bottom) return;
    const centered = stickyHeight + (navBox.height - stickyHeight) / 2 - box.height / 2;
    nav.scrollTop = Math.max(0, nav.scrollTop + box.top - navBox.top - centered);
  };
  const applyDeletedVisibility = () => {
    const hidden = hideDeleted?.checked === true;
    deletedFallback.hidden = hidden;
    for (const note of preview.contentDocument?.querySelectorAll(".deleted-inline, .docs-review-del") || []) {
      note.hidden = hidden;
    }
  };
  hideDeleted?.addEventListener("change", applyDeletedVisibility);
  const resetParentUi = () => {
    toolbar.hidden = true;
    status.textContent = "0 matched · 0 unmatched";
    unmatchedPanel.hidden = true;
    unmatchedList.replaceChildren();
    deletedFallback.replaceChildren();
    openSource.hidden = true;
    previous.disabled = true;
    next.disabled = true;
  };
  preview.addEventListener("load", () => {
    resetParentUi();
    const link = document.querySelector('.review-link[aria-current="page"]');
    const file = files.get(link?.dataset.sourceFile || "");
    const frameDocument = preview.contentDocument;
    revealCurrentNavItem(frameDocument);
    if (!file || !frameDocument) {
      mappingStatus(link, 0, file?.blocks?.length || 0);
      applyDeletedVisibility();
      return;
    }
    const stylesheet = frameDocument.createElement("link");
    stylesheet.dataset.docsReviewStyles = "";
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/_review/highlight.css";
    (frameDocument.head || frameDocument.documentElement).append(stylesheet);
    const elements = [...frameDocument.querySelectorAll(
      "main p, main h1, main h2, main h3, main h4, main h5, main h6, main li, main pre, main blockquote, main td, main th, main tr, article p, article h1, article h2, article h3, article h4, article h5, article h6, article li, article pre, article blockquote, article td, article th, article tr"
    )].filter((element) => !element.closest("nav, aside.sidebar"));
    const available = new Set(elements);
    const matched = [];
    const unmatched = [];
    const elementText = (element) => element.localName === "tr"
      ? [...element.cells].map((cell) => cell.textContent || "").join(" ")
      : element.textContent || "";
    const pick = (block, matches) => {
      const candidates = elements.filter(matches);
      const leaves = candidates.filter((candidate) => !candidates.some(
        (other) => other !== candidate && candidate.contains(other)
      ));
      const open = leaves.filter((leaf) => available.has(leaf));
      if (open.length === 1) return open[0];
      const ordinal = block.occurrences === leaves.length ? leaves[block.occurrence] : null;
      return ordinal && available.has(ordinal) ? ordinal : null;
    };
    const uniqueExact = (block, text) => pick(
      block,
      (element) => normalize(elementText(element)) === text ||
        tokens(elementText(element)).join(" ") === tokens(text).join(" ")
    );
    const containsInOrder = (actual, segments) => {
      let from = 0;
      for (const segment of segments) {
        let found = -1;
        for (let start = from; start <= actual.length - segment.length; start++) {
          if (segment.every((token, offset) => token === actual[start + offset])) {
            found = start;
            break;
          }
        }
        if (found === -1) return false;
        from = found + segment.length;
      }
      return true;
    };
    const uniqueTokenMatch = (block, text) => {
      const segments = text.split("\\uFFFC").map(tokens).filter((segment) => segment.length);
      const total = segments.reduce((sum, segment) => sum + segment.length, 0);
      if (total < 3) return null;
      return pick(block, (element) => {
        const actual = tokens(elementText(element));
        return actual.length >= total && containsInOrder(actual, segments);
      });
    };
    const tabLabels = [...frameDocument.querySelectorAll("label.tabs-label")];
    const appliesRows = [...frameDocument.querySelectorAll(
      "main h1, main h2, main h3, main h4, main h5, main h6, main .applies-block"
    )].filter((element) => !element.closest("nav, aside.sidebar"));
    const appliesMatch = (block) => {
      let cursor = 0;
      if (block.appliesTo.heading !== undefined) {
        const heading = normalize(block.appliesTo.heading);
        cursor = appliesRows.findIndex((element) =>
          !element.classList.contains("applies-block") &&
          tokens(element.textContent || "").join(" ") === tokens(heading).join(" ")
        ) + 1;
        if (cursor === 0) return null;
      }
      let seen = 0;
      for (; cursor < appliesRows.length; cursor++) {
        const row = appliesRows[cursor];
        if (!row.classList.contains("applies-block")) return null;
        if (seen++ === block.appliesTo.index) return available.has(row) ? row : null;
      }
      return null;
    };
    const sameWords = (left, right) => {
      const words = tokens(right).join(" ");
      return words.length > 0 && tokens(left).join(" ") === words;
    };
    const containerSelector = ".admonition, li.step, details, .dropdown, .tabs-item";
    const containerMatch = (block) => {
      if (block.container.title) {
        const titled = [...frameDocument.querySelectorAll(
          "main h1, main h2, main h3, main h4, main h5, main h6, main .admonition-title, main summary"
        )].find((element) => !element.closest("nav, aside.sidebar") &&
          sameWords(element.textContent || "", block.container.title));
        const titledContainer = titled?.closest(containerSelector);
        if (titledContainer) return titledContainer;
      }
      const segments = block.container.neighbor.split("\\uFFFC")
        .map(tokens).filter((segment) => segment.length);
      if (segments.length === 0) return null;
      const candidates = elements.filter((element) =>
        containsInOrder(tokens(elementText(element)), segments)
      );
      const inner = candidates.find((candidate) => !candidates.some(
        (other) => other !== candidate && candidate.contains(other)
      ));
      return inner?.closest(containerSelector) || inner || null;
    };
    const imageMatch = (block) => [...frameDocument.querySelectorAll("main img[alt]")]
      .find((image) => sameWords(image.getAttribute("alt") || "", block.imageAlt)) || null;
    for (const block of file.blocks || []) {
      if (block.tabTitle) {
        const title = normalize(block.tabTitle);
        const labels = tabLabels.filter((label) =>
          !label.dataset.docsReviewMark && normalize(label.textContent || "") === title
        );
        if (labels.length === 1) {
          labels[0].dataset.docsReviewMark = block.kind;
          labels[0].dataset.docsReviewLines = block.startLine + "-" + block.endLine;
          matched.push({ element: labels[0], block });
        } else {
          unmatched.push(block);
        }
        continue;
      }
      const text = normalize(block.text || "");
      const element = block.appliesTo
        ? appliesMatch(block)
        : block.container
          ? containerMatch(block)
          : block.imageAlt !== undefined
            ? imageMatch(block)
            : text && (uniqueExact(block, text) || uniqueTokenMatch(block, text));
      if (!element) {
        unmatched.push(block);
        continue;
      }
      available.delete(element);
      element.dataset.docsReviewMark = block.kind;
      element.dataset.docsReviewLines = block.startLine + "-" + block.endLine;
      matched.push({ element, block });
    }
    const wordDiffLines = new Set();
    for (const { element, block } of matched) {
      if (!block.wordDiff?.length || !block.previous) continue;
      element.dataset.docsReviewWordDiff = markWordsInPlace(frameDocument, element, block.wordDiff)
        ? "inline"
        : (attachWordDiffPanel(frameDocument, element, block.wordDiff), "panel");
      for (let line = block.previous.startLine; line <= block.previous.endLine; line++) {
        wordDiffLines.add(line);
      }
    }
    for (const block of unmatched) {
      const item = document.createElement("li");
      item.textContent = "Lines " + block.startLine + "-" + block.endLine + ": " + block.source;
      unmatchedList.append(item);
    }
    unmatchedPanel.hidden = unmatched.length === 0;
    for (const hunk of file.deletedHunks || []) {
      const shownAsWords = hunk.source.split("\\n").every((line, index) =>
        !line.trim() || wordDiffLines.has(hunk.oldStartLine + index)
      );
      if (shownAsWords) continue;
      const note = frameDocument.createElement("aside");
      note.className = "deleted-inline";
      note.textContent = "Deleted lines " + hunk.oldStartLine + "-" +
        hunk.oldEndLine + ": " + hunk.source;
      if (matched.length) {
        const distanceFromAnchor = (match) =>
          hunk.newAnchorLine < match.block.startLine
            ? match.block.startLine - hunk.newAnchorLine
            : hunk.newAnchorLine > match.block.endLine
              ? hunk.newAnchorLine - match.block.endLine
              : 0;
        const nearest = matched.reduce((best, candidate) =>
          distanceFromAnchor(candidate) < distanceFromAnchor(best)
            ? candidate
            : best
        );
        nearest.element.insertAdjacentElement("afterend", note);
      } else {
        const fallback = document.createElement("pre");
        fallback.textContent = note.textContent;
        deletedFallback.append(fallback);
      }
    }
    const tabChanges = new Map();
    const changedInside = [
      ...matched.map((match) => [match.element, match.block.kind]),
      ...[...frameDocument.querySelectorAll(".deleted-inline")].map((note) => [note, "modified"]),
    ];
    for (const [element, kind] of changedInside) {
      for (let content = element.closest(".tabs-content"); content; content = content.parentElement?.closest(".tabs-content")) {
        const label = content.previousElementSibling;
        if (!label?.matches("label.tabs-label")) continue;
        tabChanges.set(label, tabChanges.get(label) === "modified" ? "modified" : kind);
      }
    }
    for (const [label, kind] of tabChanges) {
      if (!label.dataset.docsReviewMark) label.dataset.docsReviewTab = kind;
    }
    if (file.frontmatter) {
      const range = (start, end) => start === end ? "Line " + start : "Lines " + start + "-" + end;
      const box = frameDocument.createElement("aside");
      box.className = "frontmatter-change";
      box.dataset.docsReviewMark = file.frontmatter.kind;
      const title = frameDocument.createElement("div");
      title.className = "frontmatter-change-title";
      title.textContent = "Frontmatter changed";
      box.append(title);
      for (const block of file.frontmatter.blocks) {
        const lines = frameDocument.createElement("pre");
        lines.textContent = range(block.startLine, block.endLine) + ":\\n" + block.source;
        box.append(lines);
      }
      for (const hunk of file.frontmatter.deletedHunks) {
        const lines = frameDocument.createElement("pre");
        lines.className = "deleted-inline";
        lines.textContent = "Deleted " + range(hunk.oldStartLine, hunk.oldEndLine).toLowerCase() + ":\\n" + hunk.source;
        box.append(lines);
      }
      const container = frameDocument.querySelector("main") || frameDocument.querySelector("article") || frameDocument.body;
      const heading = [...(container?.querySelectorAll("h1") || [])]
        .find((element) => !element.closest("nav, aside.sidebar"));
      if (heading) heading.insertAdjacentElement("beforebegin", box);
      else container?.prepend(box);
      const first = file.frontmatter.blocks[0];
      const startLine = first?.startLine || file.frontmatter.deletedHunks[0]?.newAnchorLine || 1;
      matched.unshift({
        element: box,
        block: { kind: file.frontmatter.kind, startLine, endLine: first?.endLine || startLine },
      });
    }
    applyDeletedVisibility();
    toolbar.hidden = false;
    status.textContent = matched.length + " matched · " + unmatched.length + " unmatched";
    mappingStatus(link, matched.length, unmatched.length);
    let current = -1;
    const show = (offset) => {
      if (!matched.length) return;
      current = (current + offset + matched.length) % matched.length;
      const match = matched[current];
      openSource.href = sourceHref(file, match.block.startLine);
      openSource.hidden = false;
      for (let content = match.element.closest(".tabs-content"); content; content = content.parentElement?.closest(".tabs-content")) {
        const input = content.previousElementSibling?.previousElementSibling;
        if (input?.matches("input.tabs-input")) input.checked = true;
      }
      match.element.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    previous.disabled = matched.length === 0;
    next.disabled = matched.length === 0;
    previous.onclick = () => show(-1);
    next.onclick = () => show(1);
    if (matched.length) {
      show(1);
    } else {
      const line = unmatched[0]?.startLine || file.deletedHunks?.[0]?.newAnchorLine || 1;
      openSource.href = sourceHref(file, line);
      openSource.hidden = false;
    }
  });
})();`;

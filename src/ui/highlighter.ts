import type { ReviewModel } from "../model.js";
import { normalizeVisibleText } from "../markdown.js";

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

export function createHighlighterData(review: ReviewModel): string {
  return safeJson({
    repositoryPath: review.repositoryPath,
    files: review.files.map((file) => ({
      ...file,
      sourceBase: createSourceBase(review.repositoryPath, file.path),
      blocks: file.blocks.map((block) => ({
          ...block,
          text: normalizeVisibleText(block.source, review.substitutions),
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
    for (const note of preview.contentDocument?.querySelectorAll(".deleted-inline") || []) {
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
      "main p, main h1, main h2, main h3, main h4, main h5, main h6, main li, main pre, main blockquote, main td, main th, article p, article h1, article h2, article h3, article h4, article h5, article h6, article li, article pre, article blockquote, article td, article th"
    )];
    const available = new Set(elements);
    const matched = [];
    const unmatched = [];
    const uniqueExact = (text) => {
      const candidates = elements.filter(
        (element) => available.has(element) &&
          normalize(element.textContent || "") === text
      );
      return candidates.length === 1 ? candidates[0] : null;
    };
    const uniqueTokenMatch = (text) => {
      const wanted = tokens(text);
      if (wanted.length < 3) return null;
      const candidates = elements.filter((element) => {
        if (!available.has(element)) return false;
        const actual = tokens(element.textContent || "");
        if (actual.length < wanted.length) return false;
        for (let start = 0; start <= actual.length - wanted.length; start++) {
          if (wanted.every((token, offset) => token === actual[start + offset])) {
            return true;
          }
        }
        return false;
      });
      return candidates.length === 1 ? candidates[0] : null;
    };
    for (const block of file.blocks || []) {
      const text = normalize(block.text || "");
      const element = text && (uniqueExact(text) || uniqueTokenMatch(text));
      if (!element) {
        unmatched.push(block);
        continue;
      }
      available.delete(element);
      element.dataset.docsReviewMark = block.kind;
      element.dataset.docsReviewLines = block.startLine + "-" + block.endLine;
      matched.push({ element, block });
    }
    for (const block of unmatched) {
      const item = document.createElement("li");
      item.textContent = "Lines " + block.startLine + "-" + block.endLine + ": " + block.source;
      unmatchedList.append(item);
    }
    unmatchedPanel.hidden = unmatched.length === 0;
    for (const hunk of file.deletedHunks || []) {
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

import type { ChangedFile } from "../model.js";
import { normalizeVisibleText } from "../markdown.js";

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function createHighlighterScript(file: ChangedFile | undefined): string {
  const payload = file
    ? {
        ...file,
        blocks: file.blocks.map((block) => ({
          ...block,
          text: normalizeVisibleText(block.source),
        })),
      }
    : null;
  return `(() => {
  "use strict";
  const file = ${safeJson(payload)};
  if (!file || document.getElementById("docs-review-toolbar")) return;
  const events = new EventSource("/api/events");
  events.addEventListener("refresh", () => window.location.reload());
  window.addEventListener("beforeunload", () => events.close(), { once: true });

  const normalize = (value) => value
    .normalize("NFKC")
    .replace(/\\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
  const tokens = (value) => normalize(value).match(/[\\p{L}\\p{N}]+/gu) || [];
  const elements = [...document.querySelectorAll(
    "main p, main h1, main h2, main h3, main h4, main h5, main h6, main li, main pre, main blockquote, main td, main th, article p, article h1, article h2, article h3, article h4, article h5, article h6, article li, article pre, article blockquote, article td, article th"
  )].filter((element) => !element.closest("#docs-review-toolbar"));
  const available = new Set(elements);
  const matched = [];
  const unmatched = [];

  const uniqueExact = (text) => {
    const candidates = elements.filter(
      (element) => available.has(element) && normalize(element.textContent || "") === text
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
        if (wanted.every((token, offset) => token === actual[start + offset])) return true;
      }
      return false;
    });
    return candidates.length === 1 ? candidates[0] : null;
  };

  for (const block of file.blocks) {
    const text = normalize(block.text);
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

  const toolbar = document.createElement("aside");
  toolbar.id = "docs-review-toolbar";
  toolbar.setAttribute("aria-label", "Documentation review controls");
  const controls = document.createElement("div");
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "Previous";
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next";
  const status = document.createElement("div");
  status.id = "docs-review-status";
  const unmatchedPanel = document.createElement("div");
  unmatchedPanel.id = "docs-review-unmatched";
  if (unmatched.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Unmatched (" + unmatched.length + ")";
    details.append(summary);
    for (const block of unmatched) {
      const item = document.createElement("pre");
      item.textContent = "Lines " + block.startLine + "-" + block.endLine + ": " + block.source;
      details.append(item);
    }
    unmatchedPanel.append(details);
  }
  const deletedPanel = document.createElement("div");
  deletedPanel.id = "docs-review-deleted";
  if (file.deletedHunks.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Deleted source (" + file.deletedHunks.length + ")";
    details.append(summary);
    for (const hunk of file.deletedHunks) {
      const item = document.createElement("pre");
      item.textContent = "Old lines " + hunk.oldStartLine + "-" + hunk.oldEndLine + "\\n" + hunk.source;
      details.append(item);
    }
    deletedPanel.append(details);
  }
  controls.append(previous, next);
  toolbar.append(controls, status, unmatchedPanel, deletedPanel);
  document.body.append(toolbar);

  let current = -1;
  const show = (offset) => {
    if (!matched.length) {
      status.textContent = "0 matched; " + unmatched.length + " Unmatched";
      previous.disabled = true;
      next.disabled = true;
      return;
    }
    current = (current + offset + matched.length) % matched.length;
    const match = matched[current];
    status.textContent = (current + 1) + " of " + matched.length + " matched, lines " +
      match.block.startLine + "-" + match.block.endLine +
      (unmatched.length ? "; " + unmatched.length + " Unmatched" : "");
    match.element.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  previous.addEventListener("click", () => show(-1));
  next.addEventListener("click", () => show(1));
  show(1);
})();`;
}

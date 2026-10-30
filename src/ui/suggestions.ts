import type { Suggestion } from "../suggestions.js";

export function suggestionsBootstrap(suggestions: Suggestion[]): string {
  return JSON.stringify({ suggestions }).replaceAll("<", "\\u003c");
}

export const suggestionPageStyles = `
[data-suggestion-mark] {
  background: rgba(37, 99, 235, .12);
  border-bottom: 2px dotted #2563eb;
  border-radius: 2px;
  cursor: pointer;
}
[data-suggestion-mark][data-suggestion-kind="delete"] {
  background: rgba(220, 38, 38, .12);
  border-bottom-color: #dc2626;
}
[data-suggestion-mark][data-suggestion-kind="instruction"] {
  background: rgba(236, 72, 153, .14);
  border-bottom-color: #db2777;
}
h1 [data-suggestion-mark],
h2 [data-suggestion-mark],
h3 [data-suggestion-mark],
h4 [data-suggestion-mark],
h5 [data-suggestion-mark],
h6 [data-suggestion-mark] {
  display: inline;
}
.suggestion-popover {
  position: absolute;
  z-index: 40;
  width: min(360px, calc(100vw - 32px));
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  color: #172033;
  background: #fff;
  box-shadow: 0 12px 30px rgb(15 23 42 / 18%);
  font: 13px/1.45 system-ui, sans-serif;
}
.suggestion-popover[hidden] { display: none !important; }
.suggestion-popover h4 {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #64748b;
}
.suggestion-popover .suggestion-original,
.suggestion-popover .suggestion-new {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.suggestion-popover .suggestion-original {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}
.suggestion-popover .suggestion-new {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}
.suggestion-popover[data-kind="instruction"] .suggestion-new {
  background: #fdf2f8;
  border-color: #fbcfe8;
}
.suggestion-popover[data-kind="delete"] .suggestion-new {
  background: #fef2f2;
  border-color: #fecaca;
}
.suggestion-popover .suggestion-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.suggestion-popover button {
  padding: 5px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: #fff;
  color: #172033;
  font: 12px/1.2 system-ui, sans-serif;
  cursor: pointer;
}
.suggestion-popover button.danger {
  border-color: #fca5a5;
  color: #991b1b;
  background: #fef2f2;
}
`.trim();

export const suggestionDashboardStyles = `
    .suggestions-panel {
      margin: 0;
      padding: 10px;
      border: 1px solid #dbe3ef;
      border-radius: 10px;
      background: #fff;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      box-sizing: border-box;
    }
    .suggestions-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .suggestions-panel-header h2 {
      margin: 0;
      font-size: 12px;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: #64748b;
    }
    .suggestions-count {
      color: #334155;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
    }
    .suggestions-actions {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
      min-width: 0;
    }
    .suggestions-actions button {
      flex: 1 1 0;
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      color: #172033;
      font: 600 12px/1.2 system-ui, sans-serif;
      cursor: pointer;
    }
    .suggestions-actions button.primary {
      border-color: #2563eb;
      color: #fff;
      background: #2563eb;
    }
    .suggestions-actions button:disabled {
      cursor: not-allowed;
      opacity: .5;
    }
    .suggestions-list {
      display: grid;
      gap: 6px;
      max-height: 220px;
      overflow: auto;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .suggestions-list:empty::after {
      content: "No suggestions yet. Select text in the preview to add one.";
      display: block;
      color: #64748b;
      font-size: 12px;
      line-height: 1.4;
    }
    .suggestion-item {
      display: block;
      width: 100%;
      max-width: 100%;
      padding: 8px 9px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      color: inherit;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
      overflow: hidden;
    }
    .suggestion-item:hover { background: #eff6ff; border-color: #bfdbfe; }
    .suggestion-item-path {
      display: block;
      margin-bottom: 2px;
      color: #334155;
      font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .suggestion-item-preview {
      display: block;
      color: #475569;
      font-size: 12px;
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .suggestion-item[data-missing="true"] {
      border-color: #fcd34d;
      background: #fffbeb;
    }
    .suggestion-item-kind {
      display: inline-block;
      margin-top: 4px;
      padding: 1px 6px;
      border-radius: 999px;
      background: #e2e8f0;
      color: #334155;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    .suggestion-editor {
      position: fixed;
      z-index: 80;
      width: min(420px, calc(100vw - 24px));
      padding: 12px;
      border: 1px solid #94a3b8;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 18px 40px rgb(15 23 42 / 22%);
    }
    .suggestion-editor[hidden] { display: none !important; }
    .suggestion-editor-meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      color: #64748b;
      font-size: 11px;
    }
    .suggestion-editor textarea {
      display: block;
      width: 100%;
      min-height: 96px;
      margin: 0 0 8px;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      resize: vertical;
      font: 13px/1.45 system-ui, sans-serif;
    }
    .suggestion-editor-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .suggestion-editor-save {
      padding: 6px 12px;
      border: 1px solid #2563eb;
      border-radius: 8px;
      color: #fff;
      background: #2563eb;
      font: 600 12px/1.2 system-ui, sans-serif;
      cursor: pointer;
    }
    .suggestion-editor-save:hover { background: #1d4ed8; }
    .suggestion-kind {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      background: #f8fafc;
    }
    .suggestion-kind label {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 999px;
      color: #475569;
      font-size: 12px;
      cursor: pointer;
    }
    .suggestion-kind input {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    .suggestion-kind label:has(input:checked) {
      color: #fff;
      background: #2563eb;
    }
    .suggestion-editor-hint {
      margin: 8px 0 0;
      color: #64748b;
      font-size: 11px;
    }
`;

export const suggestionScript = `
(() => {
  const preview = document.querySelector('iframe[name="docs-preview"]');
  const panelList = document.getElementById("suggestions-list");
  const countEl = document.getElementById("suggestions-count");
  const copyAll = document.getElementById("suggestions-copy-all");
  const clearAll = document.getElementById("suggestions-clear-all");
  const editor = document.getElementById("suggestion-editor");
  const editorText = document.getElementById("suggestion-editor-text");
  const editorMeta = document.getElementById("suggestion-editor-meta");
  const suggestToggle = document.getElementById("suggest-edits");
  const bootstrap = document.getElementById("suggestions-data");
  if (!preview || !panelList || !countEl || !copyAll || !clearAll || !editor || !editorText || !suggestToggle || !bootstrap) return;

  let suggestions = [];
  try {
    suggestions = JSON.parse(bootstrap.textContent || "{}").suggestions || [];
  } catch {
    suggestions = [];
  }

  let activeQuote = null;
  let editingId = null;
  let popover = null;
  let popoverSuggestionId = null;
  let ignoreSelectionUntil = 0;

  const enabled = () => suggestToggle.checked !== false;

  const clearFrameSelection = () => {
    try {
      preview.contentDocument?.getSelection?.()?.removeAllRanges();
    } catch {
      // Ignore cross-document selection errors.
    }
  };

  const kindLabel = (kind) =>
    kind === "delete" ? "Delete" : kind === "instruction" ? "Instruction" : "Replace";

  const truncate = (value, max = 72) => {
    const text = (value || "").replace(/\\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  };

  const syncButtons = () => {
    const empty = suggestions.length === 0;
    copyAll.disabled = empty;
    clearAll.disabled = empty;
    countEl.textContent = suggestions.length + " suggestion" + (suggestions.length === 1 ? "" : "s");
  };

  const renderPanel = () => {
    panelList.replaceChildren();
    const byFile = new Map();
    for (const suggestion of suggestions) {
      const path = suggestion.location?.path || suggestion.route;
      const group = byFile.get(path) || [];
      group.push(suggestion);
      byFile.set(path, group);
    }
    for (const [path, group] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const suggestion of group) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "suggestion-item";
        item.dataset.suggestionId = suggestion.id;
        item.dataset.missing = String(suggestion.location?.found === false);
        const pathEl = document.createElement("span");
        pathEl.className = "suggestion-item-path";
        pathEl.textContent = path;
        const previewEl = document.createElement("span");
        previewEl.className = "suggestion-item-preview";
        previewEl.textContent = suggestion.kind === "delete"
          ? "Delete: " + truncate(suggestion.quote.exact)
          : truncate(suggestion.newText || suggestion.quote.exact);
        const kind = document.createElement("span");
        kind.className = "suggestion-item-kind";
        kind.textContent = kindLabel(suggestion.kind) + (suggestion.location?.found === false ? " · missing" : "");
        item.append(pathEl, previewEl, kind);
        item.addEventListener("click", () => jumpToSuggestion(suggestion));
        panelList.append(item);
      }
    }
    syncButtons();
  };

  const api = async (url, init) => {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    if ((response.headers.get("content-type") || "").includes("application/json")) {
      return response.json();
    }
    return response.text();
  };

  const setSuggestions = (next) => {
    suggestions = Array.isArray(next) ? next : suggestions;
    renderPanel();
    markPage();
  };

  const selectedKind = () => {
    const checked = editor.querySelector('input[name="suggestion-kind"]:checked');
    return checked?.value === "instruction" ? "instruction" : "replace";
  };

  const hideEditor = () => {
    editor.hidden = true;
    activeQuote = null;
    editingId = null;
  };

  const cancelEditor = () => {
    if (editor.hidden) return;
    clearFrameSelection();
    ignoreSelectionUntil = Date.now() + 500;
    hideEditor();
  };

  const positionEditor = (rect) => {
    const margin = 12;
    const width = Math.min(420, window.innerWidth - margin * 2);
    let left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    let top = rect.bottom + 8;
    editor.style.width = width + "px";
    editor.hidden = false;
    const height = editor.offsetHeight || 180;
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - height - 8);
    }
    editor.style.left = left + "px";
    editor.style.top = top + "px";
  };

  const openEditor = (quote, rect, existing) => {
    hidePopover();
    clearFrameSelection();
    ignoreSelectionUntil = Date.now() + 500;
    activeQuote = quote;
    editingId = existing?.id || null;
    editorText.value = existing
      ? (existing.kind === "delete" ? "" : existing.newText)
      : quote.exact;
    const kind = existing?.kind === "instruction" ? "instruction" : "replace";
    for (const input of editor.querySelectorAll('input[name="suggestion-kind"]')) {
      input.checked = input.value === kind;
    }
    editorMeta.textContent = existing ? "Edit suggestion" : "New suggestion";
    positionEditor(rect);
    editorText.focus();
    editorText.select();
  };

  const saveEditor = async () => {
    if (!activeQuote) return;
    const quote = activeQuote;
    const id = editingId;
    const text = editorText.value;
    const kind = text.trim() === "" ? "delete" : selectedKind();
    hideEditor();
    clearFrameSelection();
    ignoreSelectionUntil = Date.now() + 500;
    try {
      if (id) {
        const state = await api("/api/suggestions", {
          method: "PATCH",
          body: JSON.stringify({ id, kind, newText: kind === "delete" ? "" : text }),
        });
        setSuggestions(state.suggestions);
      } else {
        const state = await api("/api/suggestions", {
          method: "POST",
          body: JSON.stringify({
            route: quote.route,
            quote: { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix },
            kind,
            newText: kind === "delete" ? "" : text,
          }),
        });
        setSuggestions(state.suggestions);
      }
    } catch (error) {
      console.warn("Could not save suggestion", error);
    }
  };

  // Word-diff deletions and deleted-line notes are review UI, not page text.
  const skipVisible = ".docs-review-del, .deleted-inline, .word-diff-panel, script, style, .suggestion-popover, #pages-nav, nav";

  const visibleTextInRange = (range) => {
    const ancestor = range.commonAncestorContainer;
    const root = ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor
      : ancestor.parentElement;
    if (!root) return "";
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue) continue;
      if (node.parentElement?.closest?.(skipVisible)) continue;
      try {
        if (range.comparePoint(node, 0) > 0) continue;
        if (range.comparePoint(node, node.nodeValue.length) < 0) continue;
      } catch {
        continue;
      }
      let start = 0;
      let end = node.nodeValue.length;
      if (range.startContainer === node) start = range.startOffset;
      if (range.endContainer === node) end = range.endOffset;
      if (start < end) text += node.nodeValue.slice(start, end);
    }
    return text.replace(/\\s+/g, " ").trim();
  };

  const contextAround = (root, range) => {
    const scope = root.body || root.documentElement;
    const before = root.createRange();
    before.selectNodeContents(scope);
    before.setEnd(range.startContainer, range.startOffset);
    const after = root.createRange();
    after.selectNodeContents(scope);
    after.setStart(range.endContainer, range.endOffset);
    const exact = visibleTextInRange(range);
    const prefixEnd = visibleTextInRange(before);
    const suffixStart = visibleTextInRange(after);
    return {
      exact,
      prefix: prefixEnd.slice(-32),
      suffix: suffixStart.slice(0, 32),
    };
  };

  const pageRoute = () => {
    try {
      const url = new URL(preview.contentWindow.location.href);
      if (url.pathname === "/" && url.searchParams.has("preview")) return "/";
      return url.pathname.replace(/\\/$/, "") || "/";
    } catch {
      return "/";
    }
  };

  const contentRoot = (doc) =>
    doc.querySelector("article, main, [role='main']") || doc.body || doc.documentElement;

  const collectTextNodes = (root) => {
    const nodes = [];
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue) continue;
      if (node.parentElement?.closest?.(skipVisible + ", noscript")) continue;
      nodes.push(node);
    }
    return nodes;
  };

  const buildTextIndex = (nodes) => {
    let haystack = "";
    const map = [];
    let pendingSpace = false;
    for (const textNode of nodes) {
      const raw = textNode.nodeValue;
      for (let index = 0; index < raw.length; index++) {
        if (/\\s/.test(raw[index])) {
          pendingSpace = haystack.length > 0;
          continue;
        }
        if (pendingSpace) {
          haystack += " ";
          map.push({ node: textNode, offset: index });
          pendingSpace = false;
        }
        haystack += raw[index];
        map.push({ node: textNode, offset: index });
      }
    }
    return { haystack, map };
  };

  const findQuoteRange = (doc, quote) => {
    const root = contentRoot(doc);
    if (!root) return null;
    const { haystack, map } = buildTextIndex(collectTextNodes(root));
    const exact = (quote.exact || "").replace(/\\s+/g, " ").trim();
    if (!exact || !map.length) return null;
    const matches = [];
    let from = 0;
    while (from <= haystack.length) {
      const index = haystack.indexOf(exact, from);
      if (index === -1) break;
      matches.push(index);
      from = index + Math.max(1, exact.length);
    }
    if (!matches.length) return null;
    const prefix = (quote.prefix || "").replace(/\\s+/g, " ");
    const suffix = (quote.suffix || "").replace(/\\s+/g, " ");
    matches.sort((left, right) => {
      const score = (start) => {
        let value = 0;
        const before = haystack.slice(Math.max(0, start - prefix.length - 8), start);
        const after = haystack.slice(start + exact.length, start + exact.length + suffix.length + 8);
        if (prefix && before.endsWith(prefix)) value += 2;
        else if (prefix && before.includes(prefix)) value += 1;
        if (suffix && after.startsWith(suffix)) value += 2;
        else if (suffix && after.includes(suffix)) value += 1;
        return value;
      };
      return score(right) - score(left) || left - right;
    });
    const start = matches[0];
    const end = start + exact.length;
    const startPoint = map[start];
    const endPoint = map[Math.min(end, map.length) - 1];
    if (!startPoint || !endPoint) return null;
    const range = doc.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset + 1);
    return range;
  };

  const wrapRange = (range, suggestion) => {
    const doc = preview.contentDocument;
    if (!doc) return [];
    const segments = [];
    for (const textNode of collectTextNodes(contentRoot(doc))) {
      if (!textNode.nodeValue) continue;
      try {
        if (range.comparePoint(textNode, 0) > 0) continue;
        if (range.comparePoint(textNode, textNode.nodeValue.length) < 0) continue;
      } catch {
        continue;
      }
      let start = 0;
      let end = textNode.nodeValue.length;
      if (range.startContainer === textNode) start = range.startOffset;
      else if (range.startContainer.nodeType === Node.TEXT_NODE
        && range.startContainer.parentElement?.contains(textNode)
        && range.startContainer !== textNode) {
        // Text node is fully inside the range.
      }
      if (range.endContainer === textNode) end = range.endOffset;
      if (start >= end) continue;
      segments.push({ node: textNode, start, end });
    }
    const marks = [];
    for (const segment of segments.reverse()) {
      let target = segment.node;
      if (segment.end < target.nodeValue.length) target.splitText(segment.end);
      if (segment.start > 0) target = target.splitText(segment.start);
      if (!target.nodeValue) continue;
      const mark = doc.createElement("span");
      mark.dataset.suggestionMark = suggestion.id;
      mark.dataset.suggestionKind = suggestion.kind;
      target.parentNode.insertBefore(mark, target);
      mark.append(target);
      marks.push(mark);
    }
    return marks.reverse();
  };

  const clearMarks = () => {
    const doc = preview.contentDocument;
    if (!doc) return;
    for (const mark of [...doc.querySelectorAll("[data-suggestion-mark]")]) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize?.();
    }
    hidePopover();
  };

  const hidePopover = () => {
    popover?.remove();
    popover = null;
    popoverSuggestionId = null;
  };

  const showPopover = (mark, suggestion) => {
    const doc = preview.contentDocument;
    if (!doc) return;
    if (popover && popoverSuggestionId === suggestion.id) {
      hidePopover();
      return;
    }
    hidePopover();
    popoverSuggestionId = suggestion.id;
    popover = doc.createElement("div");
    popover.className = "suggestion-popover";
    popover.dataset.kind = suggestion.kind;
    const title = doc.createElement("h4");
    title.textContent = kindLabel(suggestion.kind);
    const original = doc.createElement("div");
    original.className = "suggestion-original";
    original.textContent = suggestion.quote.exact;
    const next = doc.createElement("div");
    next.className = "suggestion-new";
    next.textContent = suggestion.kind === "delete"
      ? "(delete)"
      : suggestion.newText;
    const actions = doc.createElement("div");
    actions.className = "suggestion-actions";
    const edit = doc.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = mark.getBoundingClientRect();
      const frame = preview.getBoundingClientRect();
      openEditor({
        route: suggestion.route,
        exact: suggestion.quote.exact,
        prefix: suggestion.quote.prefix,
        suffix: suggestion.quote.suffix,
      }, {
        left: frame.left + rect.left,
        top: frame.top + rect.top,
        bottom: frame.top + rect.bottom,
        right: frame.left + rect.right,
      }, suggestion);
      hidePopover();
    });
    const remove = doc.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const state = await api("/api/suggestions/delete", {
          method: "POST",
          body: JSON.stringify({ id: suggestion.id }),
        });
        setSuggestions(state.suggestions);
      } catch (error) {
        console.warn("Could not delete suggestion", error);
      }
    });
    actions.append(edit, remove);
    popover.append(title, original, next, actions);
    (doc.body || doc.documentElement).append(popover);
    const rect = mark.getBoundingClientRect();
    const width = Math.min(360, (doc.documentElement.clientWidth || 360) - 24);
    popover.style.width = width + "px";
    popover.style.left = Math.min(
      Math.max(12, rect.left),
      (doc.documentElement.clientWidth || width) - width - 12,
    ) + "px";
    popover.style.top = Math.max(12, rect.bottom + 8 + (doc.defaultView?.scrollY || 0)) + "px";
  };

  const markPage = () => {
    clearMarks();
    const doc = preview.contentDocument;
    if (!doc?.body) return;
    const route = pageRoute();
    for (const suggestion of suggestions) {
      const suggestionRoute = (suggestion.route || "").replace(/\\/$/, "") || "/";
      if (suggestionRoute !== route && suggestion.route !== route) continue;
      const range = findQuoteRange(doc, suggestion.quote);
      if (!range) continue;
      wrapRange(range, suggestion);
    }
  };

  const jumpToSuggestion = async (suggestion) => {
    const href = suggestion.route === "/" ? "/?preview=1" : suggestion.route;
    if (pageRoute() !== ((suggestion.route || "").replace(/\\/$/, "") || "/")) {
      preview.src = href;
      await new Promise((resolve) => preview.addEventListener("load", resolve, { once: true }));
    }
    markPage();
    const mark = preview.contentDocument?.querySelector('[data-suggestion-mark="' + suggestion.id + '"]');
    if (mark) {
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
      showPopover(mark, suggestion);
    }
  };

  const onSelection = () => {
    if (!enabled() || !preview.contentDocument) return;
    if (!editor.hidden) return;
    if (Date.now() < ignoreSelectionUntil) return;
    const selection = preview.contentDocument.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!preview.contentDocument.body?.contains(range.commonAncestorContainer)) return;
    if (range.commonAncestorContainer.parentElement?.closest?.("[data-suggestion-mark], .suggestion-popover, a[href]")) {
      return;
    }
    const quote = contextAround(preview.contentDocument, range);
    if (!quote.exact) return;
    const clientRects = range.getClientRects();
    const rect = clientRects[clientRects.length - 1] || range.getBoundingClientRect();
    const frame = preview.getBoundingClientRect();
    openEditor({
      route: pageRoute(),
      exact: quote.exact,
      prefix: quote.prefix,
      suffix: quote.suffix,
    }, {
      left: frame.left + rect.left,
      top: frame.top + rect.top,
      bottom: frame.top + rect.bottom,
      right: frame.left + rect.right,
    });
  };

  const onFrameClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("a[href]")) {
      hidePopover();
      return;
    }
    const mark = target.closest("[data-suggestion-mark]");
    if (mark) {
      event.preventDefault();
      event.stopPropagation();
      const suggestion = suggestions.find((item) => item.id === mark.dataset.suggestionMark);
      if (suggestion) showPopover(mark, suggestion);
      return;
    }
    if (popover && !popover.contains(target)) hidePopover();
  };

  const bindFrame = () => {
    const doc = preview.contentDocument;
    if (!doc) return;
    doc.addEventListener("mousedown", () => {
      // Clicks land in the iframe, not the parent. Cancel without saving.
      cancelEditor();
    }, true);
    doc.addEventListener("mouseup", () => setTimeout(onSelection, 0));
    doc.addEventListener("keyup", (event) => {
      if (event.key === "Shift" || event.key.startsWith("Arrow")) setTimeout(onSelection, 0);
    });
    doc.addEventListener("click", onFrameClick, true);
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (popover) hidePopover();
        cancelEditor();
      }
    });
    markPage();
  };

  preview.addEventListener("load", bindFrame);
  if (preview.contentDocument?.readyState === "complete") bindFrame();

  editorText.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditor();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveEditor();
    }
  });

  // Replace/Instruction only change the type. Keep focus in the textarea.
  editor.addEventListener("mousedown", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('input[name="suggestion-kind"], .suggestion-kind label')) {
      event.preventDefault();
      const input = event.target.closest("label")?.querySelector("input")
        || (event.target instanceof HTMLInputElement ? event.target : null);
      if (input) input.checked = true;
    }
  });

  document.addEventListener("mousedown", (event) => {
    if (popover && !preview.contains(event.target) && !editor.contains(event.target)) {
      hidePopover();
    }
    if (editor.hidden) return;
    if (editor.contains(event.target)) return;
    cancelEditor();
  });

  document.getElementById("suggestion-editor-save")?.addEventListener("click", (event) => {
    event.preventDefault();
    void saveEditor();
  });

  copyAll.addEventListener("click", async () => {
    try {
      const markdown = await api("/api/suggestions/export");
      await navigator.clipboard.writeText(markdown);
      copyAll.textContent = "Copied " + suggestions.length;
      setTimeout(() => {
        copyAll.textContent = "Copy all";
      }, 1500);
    } catch (error) {
      console.warn("Could not copy suggestions", error);
      copyAll.textContent = "Copy failed";
      setTimeout(() => {
        copyAll.textContent = "Copy all";
      }, 1500);
    }
  });

  clearAll.addEventListener("click", async () => {
    if (!suggestions.length) return;
    if (!window.confirm("Clear all suggestions?")) return;
    try {
      const state = await api("/api/suggestions/clear", {
        method: "POST",
        body: "{}",
      });
      setSuggestions(state.suggestions);
    } catch (error) {
      console.warn("Could not clear suggestions", error);
    }
  });

  renderPanel();
})();
`;

export function suggestionsPanelMarkup(suggestions: Suggestion[]): string {
  const count = suggestions.length;
  return `<section class="suggestions-panel" aria-label="Edit suggestions">
      <div class="suggestions-panel-header">
        <h2>Suggestions</h2>
        <span class="suggestions-count" id="suggestions-count">${count} suggestion${count === 1 ? "" : "s"}</span>
      </div>
      <div class="suggestions-actions">
        <button type="button" class="primary" id="suggestions-copy-all"${count === 0 ? " disabled" : ""}>Copy all</button>
        <button type="button" id="suggestions-clear-all"${count === 0 ? " disabled" : ""}>Clear all</button>
      </div>
      <div class="suggestions-list" id="suggestions-list"></div>
    </section>
    <div class="suggestion-editor" id="suggestion-editor" hidden>
      <div class="suggestion-editor-meta" id="suggestion-editor-meta">New suggestion</div>
      <textarea id="suggestion-editor-text" aria-label="Suggested replacement or instruction"></textarea>
      <div class="suggestion-editor-toolbar">
        <div class="suggestion-kind" role="radiogroup" aria-label="Suggestion type">
          <label><input type="radio" name="suggestion-kind" value="replace" checked><span>Replace</span></label>
          <label><input type="radio" name="suggestion-kind" value="instruction"><span>Instruction</span></label>
        </div>
        <button type="button" class="suggestion-editor-save" id="suggestion-editor-save" title="⌘↩ or Ctrl+Enter">Save</button>
      </div>
      <p class="suggestion-editor-hint">Replace/Instruction sets the type. Save or press ⌘↩ (Ctrl+Enter) to keep. Escape cancels. Clear the text to delete.</p>
    </div>`;
}

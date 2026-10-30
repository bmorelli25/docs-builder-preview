import type { ChangedFile, ReviewModel } from "../model.js";
import { sourcePathToRoute } from "../routes.js";
import type { DocsBuilderStatus } from "../server.js";
import {
  createHighlighterData,
  parentHighlighterScript,
} from "./highlighter.js";
import { reviewCheckScript, reviewCheckStyles } from "./review-checks.js";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function previewHref(route: string): string {
  return route === "/" ? "/?preview=1" : route;
}

function statusLabel(status: ChangedFile["status"]): string {
  return status[0].toUpperCase() + status.slice(1);
}

function lineCountLabel(count: number, kind: "added" | "deleted"): string {
  return `${count} ${count === 1 ? "line" : "lines"} ${kind}`;
}

function pathLabel(path: string): string {
  const slash = path.lastIndexOf("/");
  const directory = slash === -1 ? "" : path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  return `${directory ? `<span class="file-dir"><bdi>${escapeHtml(directory)}</bdi></span>` : ""}<span class="file-name">${escapeHtml(name)}</span>`;
}

function copyPathButton(path: string): string {
  return `<button type="button" class="copy-path" data-copy-path="${escapeHtml(path)}" aria-label="Copy path ${escapeHtml(path)}" title="Copy path">Copy path</button>`;
}

function fileSummary(file: ChangedFile, copyButton = true): string {
  const previous = file.previousPath
    ? `<span class="previous-path" title="${escapeHtml(file.previousPath)}">from ${escapeHtml(file.previousPath)}</span>`
    : "";
  return `<div class="file-summary">
    <div class="file-heading">
      <span class="file-path" title="${escapeHtml(file.path)}">${pathLabel(file.path)}</span>
      ${previous}
    </div>
    ${copyButton ? copyPathButton(file.path) : ""}
    <div class="file-meta">
      <span class="status-badge status-${file.status}">${statusLabel(file.status)}</span>
      <span class="diff-stat additions">+${file.addedLines}</span>
      <span class="diff-stat deletions">−${file.deletedLines}</span>
    </div>
  </div>`;
}

function itemAttributes(file: ChangedFile, extraSearch = ""): string {
  const search = `${file.path} ${file.previousPath ?? ""} ${extraSearch}`
    .toLocaleLowerCase();
  return `data-review-item data-status="${file.status}" data-search="${escapeHtml(search)}"`;
}

function reviewCheckControl(file: ChangedFile, reviewed: boolean): string {
  return `<label class="review-check" title="Mark as reviewed">
      <input type="checkbox" data-review-check="${escapeHtml(file.path)}" aria-label="Mark ${escapeHtml(file.path)} as reviewed"${reviewed ? " checked" : ""}>
    </label>`;
}

function reviewProgress(reviewed: number, total: number): string {
  return `<div class="review-progress">
      <span class="review-progress-count" id="review-progress-count" role="status">${reviewed} of ${total} reviewed</span>
      <button type="button" class="review-clear" id="clear-review-checks"${reviewed === 0 ? " disabled" : ""}>Clear checks</button>
    </div>`;
}

function pageItem(file: ChangedFile, reviewed: boolean): string {
  const href = previewHref(file.route!);
  const status = statusLabel(file.status);
  const accessibleLabel = `${file.path}, ${status}, ${lineCountLabel(file.addedLines, "added")}, ${lineCountLabel(file.deletedLines, "deleted")}`;
  const tooltip = `${file.path} — ${status} — +${file.addedLines} −${file.deletedLines}`;
  return `<li ${itemAttributes(file)} data-path="${escapeHtml(file.path)}" data-lines-changed="${file.addedLines + file.deletedLines}" data-review-check-item data-reviewed="${reviewed}">
    <a class="review-link" href="${escapeHtml(href)}" target="docs-preview" data-source-file="${escapeHtml(file.path)}" aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(tooltip)}">
      ${fileSummary(file, false)}
      <span class="mapping-status" data-mapping="pending">Not mapped</span>
    </a>
    ${copyPathButton(file.path)}
    ${reviewCheckControl(file, reviewed)}
  </li>`;
}

function snippetItem(file: ChangedFile): string {
  const consumers = (file.consumers ?? [])
    .map((consumer) => {
      const route = sourcePathToRoute(consumer);
      if (!route) return "";
      const separator = route.includes("?") ? "&" : "?";
      const href = `${route}${separator}review-source=${encodeURIComponent(file.path)}`;
      return `<li>
        <a class="review-link consumer-link" href="${escapeHtml(href)}" target="docs-preview" data-source-file="${escapeHtml(file.path)}">
          <span>${escapeHtml(consumer)}</span>
          <span class="consumer-label">Preview consumer</span>
          <span class="mapping-status" data-mapping="pending">Not mapped</span>
        </a>
      </li>`;
    })
    .filter(Boolean)
    .join("");
  return `<li ${itemAttributes(file, (file.consumers ?? []).join(" "))}>
    ${fileSummary(file)}
    <ul class="consumer-list" aria-label="Consumers of ${escapeHtml(file.path)}">
      ${consumers}
    </ul>
  </li>`;
}

function staticItem(file: ChangedFile): string {
  return `<li ${itemAttributes(file)}>${fileSummary(file)}</li>`;
}

function group(
  id: "pages" | "snippets" | "deleted" | "supporting",
  title: string,
  items: string[],
  lead = "",
): string {
  if (items.length === 0) return "";
  return `<section class="review-group" data-review-group="${id}" aria-labelledby="group-${id}">
    <div class="group-heading">
      <h2 id="group-${id}">${title}</h2>
      <span>${items.length}</span>
    </div>
    ${lead}
    <ul>${items.join("")}</ul>
  </section>`;
}

export function createDashboard(
  review: ReviewModel,
  docsBuilderStatus: DocsBuilderStatus = { state: "starting", logs: [] },
  reviewedPaths: ReadonlySet<string> = new Set(),
): string {
  const previewable = review.files.filter(
    (file) => file.route && file.status !== "deleted",
  );
  const snippets = review.files.filter(
    (file) => !file.route && (file.consumers?.length ?? 0) > 0,
  );
  const deleted = review.files.filter(
    (file) => file.route && file.status === "deleted",
  );
  const supporting = review.files.filter(
    (file) => !file.route && (file.consumers?.length ?? 0) === 0,
  );
  previewable.sort((left, right) => left.path.localeCompare(right.path));
  const previewPathnames = new Set(previewable.map((file) => file.route!));
  for (const file of snippets) {
    for (const consumer of file.consumers ?? []) {
      const route = sourcePathToRoute(consumer);
      if (route) previewPathnames.add(route);
    }
  }
  const groups = [
    group(
      "pages",
      "Previewable pages",
      previewable.map((file) => pageItem(file, reviewedPaths.has(file.path))),
      reviewProgress(
        previewable.filter((file) => reviewedPaths.has(file.path)).length,
        previewable.length,
      ),
    ),
    group("snippets", "Snippets and consumers", snippets.map(snippetItem)),
    group("deleted", "Deleted pages", deleted.map(staticItem)),
    group("supporting", "Supporting files", supporting.map(staticItem)),
  ].join("");
  const warnings = review.warnings.map(
    (warning) => `<li>${escapeHtml(warning)}</li>`,
  );
  const warningPanel = warnings.length
    ? `<details class="warnings">
        <summary>${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}</summary>
        <ul>${warnings.join("")}</ul>
      </details>`
    : "";
  const docsBuilderLabel =
    docsBuilderStatus.state === "ready"
      ? "docs-builder ready"
      : docsBuilderStatus.state === "failed"
        ? "Failed"
        : "Starting docs-builder";
  const docsBuilderDetail =
    docsBuilderStatus.state === "failed" && docsBuilderStatus.error
      ? `<p>${escapeHtml(docsBuilderStatus.error)}</p>`
      : "";
  const docsBuilderLogs = docsBuilderStatus.logs.length
    ? `<pre>${escapeHtml(docsBuilderStatus.logs.join("\n"))}</pre>`
    : "";
  const docsBuilderPanel = `<section class="builder-status builder-${docsBuilderStatus.state}" aria-live="polite" data-docs-builder-state="${docsBuilderStatus.state}">
    <strong>${docsBuilderLabel}</strong>
    ${docsBuilderDetail}
    ${docsBuilderLogs}
  </section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Documentation review</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #172033;
      background: #eef1f5;
    }
    * { box-sizing: border-box; }
    body { height: 100dvh; margin: 0; overflow: hidden; }
    button, input, select { font: inherit; }
    .app-shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100dvh;
    }
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      min-height: 68px;
      padding: 12px 22px;
      border-bottom: 1px solid #d8dee8;
      background: #fff;
      box-shadow: 0 1px 3px rgb(15 23 42 / 6%);
      z-index: 2;
    }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      border-radius: 10px;
      color: #fff;
      background: #1f4b99;
      font-weight: 800;
    }
    h1 { margin: 0; font-size: 17px; line-height: 1.2; }
    .base-ref { margin: 3px 0 0; color: #64748b; font-size: 12px; }
    .base-ref code { color: #334155; font-size: inherit; }
    .metrics { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 13px; }
    .metric {
      padding: 7px 10px;
      border: 1px solid #dbe2ea;
      border-radius: 999px;
      white-space: nowrap;
      background: #f8fafc;
    }
    .metric strong { color: #172033; }
    .workspace {
      display: grid;
      grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
      min-height: 0;
    }
    .workspace.sidebar-collapsed {
      grid-template-columns: 84px minmax(0, 1fr);
    }
    .sidebar {
      display: flex;
      min-height: 0;
      flex-direction: column;
      border-right: 1px solid #d8dee8;
      background: #f8fafc;
    }
    .sidebar-toggle {
      min-height: 38px;
      margin: 10px 14px 0;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      color: #334155;
      background: #fff;
      cursor: pointer;
    }
    .sidebar-toggle:hover { border-color: #94a3b8; background: #f8fafc; }
    .sidebar-tools {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-bottom: 1px solid #e2e8f0;
      background: #fff;
    }
    .search-wrap { position: relative; }
    .search-wrap svg {
      position: absolute;
      top: 50%;
      left: 11px;
      width: 16px;
      color: #64748b;
      transform: translateY(-50%);
      pointer-events: none;
    }
    input, select {
      width: 100%;
      min-height: 38px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      color: #172033;
      background: #fff;
    }
    input { padding: 8px 10px 8px 34px; }
    select { padding: 8px 10px; }
    input:focus, select:focus, button:focus-visible, .review-link:focus-visible {
      outline: 3px solid rgb(37 99 235 / 24%);
      outline-offset: 1px;
      border-color: #2563eb;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .warnings { margin: 0; color: #854d0e; font-size: 12px; }
    .warnings summary { cursor: pointer; font-weight: 650; }
    .warnings ul { margin: 6px 0 0; padding-left: 18px; }
    .builder-status { padding: 9px; border: 1px solid #dbe2ea; border-radius: 8px; font-size: 12px; background: #f8fafc; }
    .builder-status p { margin: 4px 0 0; }
    .builder-status pre { max-height: 110px; margin: 7px 0 0; overflow: auto; white-space: pre-wrap; }
    .builder-failed { color: #991b1b; border-color: #fecaca; background: #fef2f2; }
    .builder-ready { color: #166534; border-color: #bbf7d0; background: #f0fdf4; }
    .file-list {
      min-height: 0;
      padding: 8px 8px 28px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .review-group { margin: 0 0 12px; }
    .group-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 8px;
      color: #64748b;
    }
    .group-heading h2 {
      margin: 0;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .07em;
      text-transform: uppercase;
    }
    .group-heading span { font-size: 11px; }
    .review-group ul { margin: 0; padding: 0; list-style: none; }
    .review-group > ul > li {
      margin-bottom: 4px;
      border: 1px solid transparent;
      border-radius: 9px;
    }
    .review-group > ul > li:not(:has(> .review-link)) {
      padding: 10px;
      border-color: #e2e8f0;
      background: #fff;
    }
    .review-link {
      display: block;
      padding: 10px;
      border: 1px solid transparent;
      border-radius: 9px;
      color: inherit;
      text-decoration: none;
    }
    .review-link:hover { border-color: #cbd5e1; background: #fff; }
    .review-link.selected, .review-link[aria-current="page"] {
      border-color: #93b4ef;
      background: #eaf1ff;
      box-shadow: inset 3px 0 #2563eb;
    }
    .file-summary { position: relative; display: grid; gap: 7px; min-width: 0; }
    .file-heading { display: grid; gap: 2px; min-width: 0; }
    .file-path {
      display: grid;
      min-width: 0;
      font: 600 12.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .file-dir {
      direction: rtl;
      text-align: left;
      overflow: hidden;
      color: #64748b;
      font-size: 11px;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-name { overflow-wrap: anywhere; }
    .copy-path {
      position: absolute;
      right: 8px;
      bottom: 8px;
      padding: 2px 7px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      color: #334155;
      background: #fff;
      font-size: 11px;
      cursor: pointer;
      opacity: 0;
    }
    .file-summary > .copy-path { right: 0; bottom: 0; }
    li:hover > .copy-path,
    li:hover > .file-summary > .copy-path,
    .copy-path:focus-visible,
    .copy-path[data-copied] { opacity: 1; }
    .copy-path:hover { background: #f1f5f9; }
    .copy-path[data-copied] { border-color: #86efac; color: #15803d; }
    .sidebar-collapsed .copy-path { display: none; }
    .previous-path {
      overflow: hidden;
      color: #64748b;
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-meta { display: flex; align-items: center; gap: 6px; }
    .status-badge {
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 750;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    .status-added { color: #166534; background: #dcfce7; }
    .status-modified { color: #854d0e; background: #fef3c7; }
    .status-renamed, .status-copied { color: #1e40af; background: #dbeafe; }
    .status-deleted { color: #991b1b; background: #fee2e2; }
    .diff-stat { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .additions { color: #15803d; }
    .deletions { color: #b91c1c; }
    .consumer-list { display: grid; gap: 4px; margin-top: 9px !important; }
    .consumer-link {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 8px;
      color: #1d4ed8;
      background: #f8fafc;
      font-size: 12px;
    }
    .consumer-link span:first-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .consumer-label { flex: none; color: #64748b; font-size: 10px; }
    .mapping-status {
      display: block;
      margin-top: 5px;
      color: #64748b;
      font-size: 10px;
    }
    .mapping-status[data-mapping="matched"] { color: #15803d; }
    .mapping-status[data-mapping="partial"] { color: #a16207; }
    .mapping-status[data-mapping="unmatched"] { color: #b91c1c; }
    .consumer-link .mapping-status { margin: 0 0 0 auto; }
    .sidebar-collapsed .sidebar-toggle { margin: 8px; }
    .sidebar-collapsed .sidebar-tools,
    .sidebar-collapsed .review-group:not([data-review-group="pages"]),
    .sidebar-collapsed .review-group[data-review-group="pages"] .group-heading,
    .sidebar-collapsed .file-heading,
    .sidebar-collapsed .mapping-status {
      display: none;
    }
    .sidebar-collapsed .file-list { padding: 8px 6px 24px; }
    .sidebar-collapsed .review-group { margin: 0; }
    .sidebar-collapsed .review-link { padding: 8px 5px; }
    .sidebar-collapsed .file-summary { display: block; }
    .sidebar-collapsed .file-meta {
      justify-content: center;
      flex-wrap: wrap;
      gap: 3px;
    }
    .sidebar-collapsed .status-badge {
      width: 100%;
      padding-inline: 3px;
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
    }
    .sidebar-collapsed .diff-stat { font-size: 10px; }
    .no-results {
      margin: 28px 14px;
      color: #64748b;
      text-align: center;
      font-size: 13px;
    }
    .preview-pane { position: relative; min-width: 0; min-height: 0; background: #fff; }
    .preview-pane iframe { width: 100%; height: 100%; border: 0; background: #fff; }
    .preview-toolbar {
      position: absolute;
      z-index: 3;
      right: 16px;
      bottom: 16px;
      width: min(420px, calc(100% - 32px));
      padding: 11px;
      border: 1px solid #334155;
      border-radius: 9px;
      color: #f8fafc;
      background: #0f172a;
      box-shadow: 0 10px 30px rgb(15 23 42 / 30%);
      font-size: 12px;
    }
    .toolbar-row { display: flex; align-items: center; gap: 7px; }
    .deleted-control {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 9px;
      cursor: pointer;
    }
    .deleted-control input {
      width: auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      accent-color: #60a5fa;
    }
    .preview-toolbar button, .preview-toolbar a {
      padding: 5px 8px;
      border: 1px solid #64748b;
      border-radius: 5px;
      color: inherit;
      background: #1e293b;
      text-decoration: none;
    }
    .preview-toolbar button:disabled { cursor: not-allowed; opacity: .45; }
    #mapping-counts { margin-left: auto; }
    #unmatched-panel, #deleted-fallback {
      max-height: 130px;
      margin-top: 8px;
      overflow: auto;
    }
    #unmatched-list { margin: 6px 0 0; padding-left: 18px; }
    #deleted-fallback pre {
      margin: 6px 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .preview-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      padding: 24px;
      color: #64748b;
      text-align: center;
      background: #fff;
      pointer-events: none;
    }
    .preview-empty svg { width: 42px; margin: 0 auto 12px; color: #94a3b8; }
    .preview-empty strong { color: #334155; font-size: 15px; }
    .preview-empty p { max-width: 360px; margin: 5px 0 0; font-size: 13px; }
    [hidden] { display: none !important; }
    @media (max-width: 760px) {
      body { height: auto; min-height: 100dvh; overflow: auto; }
      .app-shell { height: auto; min-height: 100dvh; }
      .app-header { align-items: flex-start; flex-direction: column; gap: 10px; }
      .metrics { flex-wrap: wrap; }
      .workspace { grid-template-columns: 1fr; grid-template-rows: auto minmax(520px, 65vh); }
      .sidebar { max-height: 46vh; border-right: 0; border-bottom: 1px solid #d8dee8; }
      .workspace.sidebar-collapsed {
        grid-template-columns: 84px minmax(0, 1fr);
        grid-template-rows: minmax(520px, 65vh);
      }
      .sidebar-collapsed .sidebar {
        max-height: none;
        border-right: 1px solid #d8dee8;
        border-bottom: 0;
      }
    }
  </style>
  <style>${reviewCheckStyles}</style>
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">D</span>
        <div>
          <h1>Documentation review</h1>
          <p class="base-ref">Comparing against <code>${escapeHtml(review.baseRef)}</code></p>
        </div>
      </div>
      <div class="metrics" aria-label="Review summary">
        <span class="metric"><strong>${review.files.length}</strong> changed files</span>
        <span class="metric"><strong>${previewPathnames.size}</strong> preview pages</span>
      </div>
    </header>
    <main class="workspace">
      <aside class="sidebar" aria-label="Changed documentation">
        <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-expanded="true" aria-label="Collapse sidebar" title="Collapse sidebar">‹</button>
        <div class="sidebar-tools">
          <div class="search-wrap">
            <label class="visually-hidden" for="review-search">Search changed files</label>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input id="review-search" type="search" placeholder="Search changed files" autocomplete="off">
          </div>
          <div>
            <label class="visually-hidden" for="status-filter">Filter by status</label>
            <select id="status-filter" aria-label="Filter files by status">
              <option value="all">All statuses</option>
              <option value="added">Added</option>
              <option value="modified">Modified</option>
              <option value="renamed">Renamed</option>
              <option value="copied">Copied</option>
              <option value="deleted">Deleted</option>
            </select>
          </div>
          <div>
            <label class="visually-hidden" for="page-sort">Sort previewable pages</label>
            <select id="page-sort" aria-label="Sort previewable pages">
              <option value="path">Path</option>
              <option value="lines-changed">Lines changed</option>
            </select>
          </div>
          ${docsBuilderPanel}
          ${warningPanel}
        </div>
        <nav class="file-list" aria-label="Review files">
          ${groups || '<p class="no-results">No changed documentation files.</p>'}
          <p class="no-results" id="filter-empty" hidden>No files match these filters.</p>
        </nav>
      </aside>
      <section class="preview-pane" aria-label="Page preview">
        <iframe name="docs-preview" title="Documentation preview" sandbox="allow-same-origin"></iframe>
        <aside class="preview-toolbar" id="preview-toolbar" aria-label="Review mapping controls" hidden>
          <div class="toolbar-row">
            <button type="button" id="review-previous">Previous</button>
            <button type="button" id="review-next">Next</button>
            <a id="open-source" href="#" target="_blank" rel="noreferrer" hidden>Open source</a>
            <span id="mapping-counts">0 matched · 0 unmatched</span>
          </div>
          <label class="deleted-control" for="hide-deleted-lines">
            <input id="hide-deleted-lines" type="checkbox">
            <span>Hide deleted lines</span>
          </label>
          <details id="unmatched-panel" hidden>
            <summary>Unmatched source blocks</summary>
            <ul id="unmatched-list"></ul>
          </details>
          <div id="deleted-fallback" aria-label="Deleted source without a nearby surviving block"></div>
        </aside>
        <div class="preview-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5Z"/><path d="M4 17h14M8 7h6M8 11h7"/></svg>
          <strong>Select a page to preview</strong>
          <p>Choose a previewable page or snippet consumer from the review list.</p>
        </div>
      </section>
    </main>
  </div>
  <script type="application/json" id="review-data">${createHighlighterData(review)}</script>
  <script>
    const reviewEvents = new EventSource("/api/events");
    reviewEvents.addEventListener("refresh", () => {
      window.persistReviewState?.();
      window.location.reload();
    });
    window.addEventListener("pagehide", () => reviewEvents.close(), { once: true });
  </script>
  <script>
    const search = document.getElementById("review-search");
    const statusFilter = document.getElementById("status-filter");
    const pageSort = document.getElementById("page-sort");
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const hideDeleted = document.getElementById("hide-deleted-lines");
    const workspace = document.querySelector(".workspace");
    const items = [...document.querySelectorAll("[data-review-item]")];
    const groups = [...document.querySelectorAll("[data-review-group]")];
    const pageList = document.querySelector("[data-review-group=\\"pages\\"] > ul");
    const pageEntries = pageList
      ? [...pageList.children].map((item) => ({
          item,
          path: item.dataset.path,
          linesChanged: Number(item.dataset.linesChanged),
        }))
      : [];
    const filterEmpty = document.getElementById("filter-empty");
    const previewEmpty = document.querySelector(".preview-empty");
    const preview = document.querySelector('iframe[name="docs-preview"]');
    const fileList = document.querySelector(".file-list");
    const previewLinks = [...document.querySelectorAll(".review-link")];
    let activeHref = null;
    const applyPageSort = () => {
      const sorted = [...pageEntries].sort((left, right) => {
        if (pageSort.value === "lines-changed") {
          const changedDifference =
            right.linesChanged - left.linesChanged;
          if (changedDifference) return changedDifference;
        }
        return left.path.localeCompare(right.path);
      });
      for (const entry of sorted) pageList?.append(entry.item);
    };
    const setSidebarCollapsed = (collapsed) => {
      workspace.classList.toggle("sidebar-collapsed", collapsed);
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
      sidebarToggle.setAttribute("aria-label", label);
      sidebarToggle.title = label;
      sidebarToggle.textContent = collapsed ? "›" : "‹";
    };
    const applyFilters = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const status = statusFilter.value;
      let visible = 0;
      for (const item of items) {
        const matchesQuery = !query || item.dataset.search.includes(query);
        const matchesStatus = status === "all" || item.dataset.status === status;
        item.hidden = !(matchesQuery && matchesStatus);
        if (!item.hidden) visible++;
      }
      for (const group of groups) {
        group.hidden = ![...group.querySelectorAll("[data-review-item]")]
          .some((item) => !item.hidden);
      }
      filterEmpty.hidden = visible !== 0 || items.length === 0;
    };
    const selectLink = (link) => {
      for (const candidate of previewLinks) {
        candidate.classList.remove("selected");
        candidate.removeAttribute("aria-current");
      }
      link?.classList.add("selected");
      link?.setAttribute("aria-current", "page");
    };
    const previewTarget = (href) => {
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return null;
        if (url.pathname === "/" && !url.search) return null;
        return url.pathname.replace(/(.)\\/$/, "$1") + url.search;
      } catch {
        return null;
      }
    };
    const framePreviewHref = () => {
      try {
        const href = preview.contentWindow?.location.href ?? "";
        return href.startsWith(window.location.origin + "/") ? previewTarget(href) : null;
      } catch {
        return null;
      }
    };
    const activateLink = (link, navigate) => {
      selectLink(link);
      if (link) {
        activeHref = link.getAttribute("href");
        previewEmpty.hidden = true;
        if (navigate) preview.setAttribute("src", activeHref);
      } else {
        activeHref = null;
        preview.removeAttribute("src");
        previewEmpty.hidden = false;
      }
    };
    const persistState = () => {
      try {
        sessionStorage.setItem("docs-review-state", JSON.stringify({
          activeHref,
          search: search.value,
          status: statusFilter.value,
          hideDeleted: hideDeleted.checked,
          pageSort: pageSort.value,
          sidebarCollapsed: workspace.classList.contains("sidebar-collapsed"),
          scrollTop: fileList.scrollTop,
        }));
      } catch {
        // Storage can be disabled without breaking the review UI.
      }
    };
    window.persistReviewState = persistState;
    search.addEventListener("input", () => {
      applyFilters();
      persistState();
    });
    statusFilter.addEventListener("change", () => {
      applyFilters();
      persistState();
    });
    pageSort.addEventListener("change", () => {
      applyPageSort();
      persistState();
    });
    hideDeleted.addEventListener("change", persistState);
    sidebarToggle.addEventListener("click", () => {
      setSidebarCollapsed(
        !workspace.classList.contains("sidebar-collapsed"),
      );
      persistState();
    });
    fileList.addEventListener("scroll", persistState, { passive: true });
    window.addEventListener("pagehide", persistState, { once: true });
    for (const link of previewLinks) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        activateLink(link, true);
        persistState();
      });
    }
    preview.addEventListener("load", () => {
      const shown = framePreviewHref();
      if (!shown || shown === previewTarget(activeHref ?? "")) return;
      const link = previewLinks.find(
        (candidate) => previewTarget(candidate.getAttribute("href")) === shown,
      );
      selectLink(link);
      activeHref = link ? link.getAttribute("href") : shown;
      persistState();
    });
    let state;
    try {
      state = JSON.parse(sessionStorage.getItem("docs-review-state") ?? "null");
    } catch {
      state = null;
    }
    if (state && typeof state === "object") {
      if (typeof state.search === "string") search.value = state.search;
      if (
        typeof state.status === "string" &&
        [...statusFilter.options].some((option) => option.value === state.status)
      ) {
        statusFilter.value = state.status;
      }
      if (
        typeof state.pageSort === "string" &&
        [...pageSort.options].some((option) => option.value === state.pageSort)
      ) {
        pageSort.value = state.pageSort;
      }
      hideDeleted.checked = state.hideDeleted === true;
      setSidebarCollapsed(state.sidebarCollapsed === true);
      applyPageSort();
      applyFilters();
      if (Number.isFinite(state.scrollTop)) fileList.scrollTop = state.scrollTop;
      const activeLink = typeof state.activeHref === "string"
        ? previewLinks.find(
            (link) => link.getAttribute("href") === state.activeHref,
          )
        : undefined;
      const restoredHref = typeof state.activeHref === "string"
        ? previewTarget(state.activeHref)
        : null;
      if (activeLink) {
        activateLink(activeLink, false);
        preview.setAttribute("src", state.activeHref);
      } else if (restoredHref) {
        activeHref = restoredHref;
        previewEmpty.hidden = true;
        preview.setAttribute("src", restoredHref);
      } else {
        activateLink(null, false);
      }
    } else {
      setSidebarCollapsed(false);
      applyPageSort();
      applyFilters();
    }
  </script>
  <script>
    (() => {
      const copyText = async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          const field = document.createElement("textarea");
          field.value = text;
          field.setAttribute("readonly", "");
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.append(field);
          field.select();
          const copied = document.execCommand("copy");
          field.remove();
          return copied;
        }
      };
      document.addEventListener("click", async (event) => {
        const button = event.target instanceof Element && event.target.closest("[data-copy-path]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const copied = await copyText(button.dataset.copyPath || "");
        button.textContent = copied ? "Copied" : "Copy failed";
        button.dataset.copied = "";
        clearTimeout(button.copyTimer);
        button.copyTimer = setTimeout(() => {
          button.textContent = "Copy path";
          delete button.dataset.copied;
        }, 1500);
      });
    })();
  </script>
  <script>${parentHighlighterScript}</script>
  <script>${reviewCheckScript}</script>
</body>
</html>`;
}

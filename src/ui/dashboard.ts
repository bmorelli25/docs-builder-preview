import type { ChangedFile, ReviewModel } from "../model.js";
import { sourcePathToRoute } from "../routes.js";

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

function fileSummary(file: ChangedFile): string {
  const previous = file.previousPath
    ? `<span class="previous-path">from ${escapeHtml(file.previousPath)}</span>`
    : "";
  return `<div class="file-summary">
    <div class="file-heading">
      <span class="file-path">${escapeHtml(file.path)}</span>
      ${previous}
    </div>
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

function pageItem(file: ChangedFile): string {
  const href = previewHref(file.route!);
  return `<li ${itemAttributes(file)}>
    <a class="review-link" href="${escapeHtml(href)}" target="docs-preview">
      ${fileSummary(file)}
    </a>
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
        <a class="review-link consumer-link" href="${escapeHtml(href)}" target="docs-preview">
          <span>${escapeHtml(consumer)}</span>
          <span class="consumer-label">Preview consumer</span>
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
): string {
  if (items.length === 0) return "";
  return `<section class="review-group" data-review-group="${id}" aria-labelledby="group-${id}">
    <div class="group-heading">
      <h2 id="group-${id}">${title}</h2>
      <span>${items.length}</span>
    </div>
    <ul>${items.join("")}</ul>
  </section>`;
}

export function createDashboard(review: ReviewModel): string {
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
  const previewPathnames = new Set(previewable.map((file) => file.route!));
  for (const file of snippets) {
    for (const consumer of file.consumers ?? []) {
      const route = sourcePathToRoute(consumer);
      if (route) previewPathnames.add(route);
    }
  }
  const groups = [
    group("pages", "Previewable pages", previewable.map(pageItem)),
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
    .sidebar {
      display: flex;
      min-height: 0;
      flex-direction: column;
      border-right: 1px solid #d8dee8;
      background: #f8fafc;
    }
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
    input:focus, select:focus, .review-link:focus-visible {
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
    .file-summary { display: grid; gap: 7px; min-width: 0; }
    .file-heading { display: grid; gap: 2px; min-width: 0; }
    .file-path {
      overflow: hidden;
      font: 600 12.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
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
    .no-results {
      margin: 28px 14px;
      color: #64748b;
      text-align: center;
      font-size: 13px;
    }
    .preview-pane { position: relative; min-width: 0; min-height: 0; background: #fff; }
    .preview-pane iframe { width: 100%; height: 100%; border: 0; background: #fff; }
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
    }
  </style>
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
          ${warningPanel}
        </div>
        <nav class="file-list" aria-label="Review files">
          ${groups || '<p class="no-results">No changed documentation files.</p>'}
          <p class="no-results" id="filter-empty" hidden>No files match these filters.</p>
        </nav>
      </aside>
      <section class="preview-pane" aria-label="Page preview">
        <iframe name="docs-preview" title="Documentation preview" sandbox="allow-scripts"></iframe>
        <div class="preview-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5Z"/><path d="M4 17h14M8 7h6M8 11h7"/></svg>
          <strong>Select a page to preview</strong>
          <p>Choose a previewable page or snippet consumer from the review list.</p>
        </div>
      </section>
    </main>
  </div>
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
    const items = [...document.querySelectorAll("[data-review-item]")];
    const groups = [...document.querySelectorAll("[data-review-group]")];
    const filterEmpty = document.getElementById("filter-empty");
    const previewEmpty = document.querySelector(".preview-empty");
    const preview = document.querySelector('iframe[name="docs-preview"]');
    const fileList = document.querySelector(".file-list");
    const previewLinks = [...document.querySelectorAll(".review-link")];
    let activeHref = null;
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
    const activateLink = (link, navigate) => {
      for (const candidate of previewLinks) {
        candidate.classList.remove("selected");
        candidate.removeAttribute("aria-current");
      }
      if (link) {
        activeHref = link.getAttribute("href");
        link.classList.add("selected");
        link.setAttribute("aria-current", "page");
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
    fileList.addEventListener("scroll", persistState, { passive: true });
    window.addEventListener("pagehide", persistState, { once: true });
    for (const link of previewLinks) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        activateLink(link, true);
        persistState();
      });
    }
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
      applyFilters();
      if (Number.isFinite(state.scrollTop)) fileList.scrollTop = state.scrollTop;
      const activeLink = typeof state.activeHref === "string"
        ? previewLinks.find(
            (link) => link.getAttribute("href") === state.activeHref,
          )
        : undefined;
      if (activeLink) {
        activateLink(activeLink, false);
        preview.setAttribute("src", state.activeHref);
      } else {
        activateLink(null, false);
      }
    }
  </script>
</body>
</html>`;
}

export const reviewCheckStyles = `
    .review-progress {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0 0 6px;
      padding: 6px 6px 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      color: #334155;
      background: #fff;
      font-size: 12px;
    }
    .review-progress-count { font-variant-numeric: tabular-nums; }
    .review-clear {
      padding: 4px 9px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      color: #172033;
      background: #fff;
      font-size: 12px;
      cursor: pointer;
    }
    .review-clear:hover:not(:disabled) { background: #f1f5f9; }
    .review-clear:disabled { cursor: not-allowed; opacity: .5; }
    .review-clear:focus-visible {
      outline: 3px solid rgb(37 99 235 / 24%);
      outline-offset: 1px;
    }
    .sidebar-collapsed .review-check { display: none; }
    .sidebar-collapsed [data-review-check-item] > .review-link { padding-right: 5px; }
    .sidebar-collapsed [data-review-check-item][data-reviewed="true"] > .review-link .file-meta::after {
      content: "✓";
    }
    [data-review-check-item] { position: relative; }
    [data-review-check-item] > .review-link { padding-right: 44px; }
    .review-check {
      position: absolute;
      top: 6px;
      right: 6px;
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      border-radius: 7px;
      cursor: pointer;
    }
    .review-check:hover { background: #e2e8f0; }
    .review-check input {
      width: 17px;
      height: 17px;
      min-height: 0;
      margin: 0;
      padding: 0;
      accent-color: #15803d;
      cursor: pointer;
    }
    .review-check input:focus-visible {
      outline: 3px solid rgb(37 99 235 / 24%);
      outline-offset: 2px;
    }
    [data-review-check-item][data-reviewed="true"] > .review-link:not(.selected) {
      border-color: #d7e6dc;
      background: #f2f6f3;
    }
    [data-review-check-item][data-reviewed="true"] > .review-link .file-path { color: #64748b; }
    [data-review-check-item][data-reviewed="true"] > .review-link .status-badge,
    [data-review-check-item][data-reviewed="true"] > .review-link .diff-stat { opacity: .6; }
    [data-review-check-item][data-reviewed="true"] > .review-link .file-meta::after {
      content: "✓ Reviewed";
      color: #15803d;
      font-size: 10px;
      font-weight: 750;
      letter-spacing: .03em;
      text-transform: uppercase;
    }
`;

export const reviewCheckScript = `
(() => {
  const checks = [...document.querySelectorAll("input[data-review-check]")];
  const count = document.getElementById("review-progress-count");
  const clearButton = document.getElementById("clear-review-checks");
  if (!count || !clearButton) return;
  let latestRequest = 0;
  const render = (reviewed) => {
    const reviewedPaths = new Set(reviewed);
    for (const check of checks) {
      const isReviewed = reviewedPaths.has(check.dataset.reviewCheck);
      check.checked = isReviewed;
      check.closest("[data-review-check-item]").dataset.reviewed = String(isReviewed);
    }
    const done = checks.filter((check) => check.checked).length;
    count.textContent = done + " of " + checks.length + " reviewed";
    clearButton.disabled = done === 0;
  };
  const checkedPaths = () =>
    checks.filter((check) => check.checked).map((check) => check.dataset.reviewCheck);
  const sync = async (url, body) => {
    const requestId = ++latestRequest;
    const init = body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        };
    try {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const state = await response.json();
      if (requestId === latestRequest && Array.isArray(state?.reviewed)) {
        render(state.reviewed);
      }
    } catch (error) {
      console.warn("Could not sync review checks", error);
      if (body !== undefined && requestId === latestRequest) {
        void sync("/api/review-checks");
      }
    }
  };
  for (const check of checks) {
    check.addEventListener("change", () => {
      render(checkedPaths());
      void sync("/api/review-checks", {
        path: check.dataset.reviewCheck,
        reviewed: check.checked,
      });
    });
  }
  clearButton.addEventListener("click", () => {
    render([]);
    void sync("/api/review-checks/clear", {});
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void sync("/api/review-checks");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync("/api/review-checks");
  });
})();
`;

import type { ReviewModel } from "../model.js";
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

export function createDashboard(review: ReviewModel): string {
  const files = review.files
    .map((file) => {
      const path = escapeHtml(file.path);
      const label = `${path} (${file.status}, +${file.addedLines} −${file.deletedLines})`;
      const route = file.route === "/" ? "/?preview=1" : file.route;
      if (file.route) {
        return `<li><a href="${escapeHtml(route!)}">${label}</a></li>`;
      }
      const consumers = (file.consumers ?? [])
        .map((consumer) => {
          const consumerRoute = sourcePathToRoute(consumer);
          if (!consumerRoute) return "";
          const separator = consumerRoute.includes("?") ? "&" : "?";
          const href = `${consumerRoute}${separator}review-source=${encodeURIComponent(file.path)}`;
          return `<li><a href="${escapeHtml(href)}">${escapeHtml(consumer)}</a></li>`;
        })
        .filter(Boolean)
        .join("");
      return consumers
        ? `<li>${label}<ul>${consumers}</ul></li>`
        : `<li>${label} <span>no preview route</span></li>`;
    })
    .join("\n");
  const warnings = review.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Documentation review</title>
  <style>
    body{max-width:960px;margin:40px auto;padding:0 20px;font:16px/1.5 system-ui,sans-serif;color:#172033}
    a{color:#0759b8} li{margin:.5rem 0} .warnings{color:#9a3412}
  </style>
</head>
<body>
  <h1>Documentation review</h1>
  <p>Base: <code>${escapeHtml(review.baseRef)}</code></p>
  ${warnings ? `<ul class="warnings">${warnings}</ul>` : ""}
  <ul>${files || "<li>No changed documentation files.</li>"}</ul>
  <script>
    const reviewEvents = new EventSource("/api/events");
    reviewEvents.addEventListener("refresh", () => window.location.reload());
    window.addEventListener("pagehide", () => reviewEvents.close(), { once: true });
  </script>
</body>
</html>`;
}

import type { ReviewModel } from "../model.js";

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
      return file.route
        ? `<li><a href="${escapeHtml(route!)}">${label}</a></li>`
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
</body>
</html>`;
}

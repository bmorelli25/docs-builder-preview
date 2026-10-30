export const reviewStyles = `
[data-docs-review-mark="added"] {
  background: rgba(34, 197, 94, .24) !important;
  outline: 2px solid #16a34a;
  outline-offset: 2px;
}
[data-docs-review-mark="modified"] {
  background: rgba(234, 179, 8, .27) !important;
  outline: 2px solid #ca8a04;
  outline-offset: 2px;
}
tr[data-docs-review-mark] > td,
tr[data-docs-review-mark] > th {
  background: transparent !important;
}
.deleted-inline {
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid #fca5a5;
  border-left: 4px solid #dc2626;
  border-radius: 4px;
  color: #7f1d1d;
  background: #fef2f2;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.frontmatter-change {
  display: block;
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 4px;
  color: #172033;
}
.frontmatter-change-title {
  margin-bottom: 4px;
  font: 600 12px/1.4 system-ui, sans-serif;
  letter-spacing: .03em;
  text-transform: uppercase;
}
.frontmatter-change pre {
  margin: 4px 0 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.frontmatter-change pre.deleted-inline {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid #fca5a5;
  border-left: 4px solid #dc2626;
  background: #fef2f2;
}
`.trim();

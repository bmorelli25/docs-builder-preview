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
#docs-review-toolbar {
  position: fixed;
  z-index: 2147483647;
  right: 16px;
  bottom: 16px;
  width: min(390px, calc(100vw - 32px));
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid #475569;
  border-radius: 8px;
  color: #f8fafc;
  background: #0f172a;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
}
#docs-review-toolbar button {
  margin-right: 6px;
  padding: 4px 9px;
  border: 1px solid #94a3b8;
  border-radius: 4px;
  color: inherit;
  background: #1e293b;
  cursor: pointer;
}
#docs-review-status { margin: 8px 0 0; }
#docs-review-unmatched, #docs-review-deleted {
  max-height: 150px;
  margin-top: 8px;
  overflow: auto;
}
#docs-review-unmatched:empty, #docs-review-deleted:empty { display: none; }
#docs-review-toolbar details pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
`.trim();

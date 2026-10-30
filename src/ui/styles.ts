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
label[data-docs-review-tab="added"] {
  outline: 2px solid #16a34a;
  outline-offset: -2px;
}
label[data-docs-review-tab="modified"] {
  outline: 2px solid #ca8a04;
  outline-offset: -2px;
}
ins.docs-review-ins {
  color: inherit;
  background: rgba(34, 197, 94, .38);
  text-decoration: underline 2px #15803d;
  text-underline-offset: 2px;
  border-radius: 2px;
}
del.docs-review-del {
  color: #991b1b;
  background: rgba(220, 38, 38, .14);
  text-decoration: line-through 2px #dc2626;
  border-radius: 2px;
}
del.docs-review-del[hidden] {
  display: none !important;
}
[data-docs-review-word-diff="panel"] {
  cursor: help;
}
.word-diff-panel {
  display: none;
  margin: 6px 0;
  padding: 8px 10px;
  border: 1px solid #ca8a04;
  border-radius: 4px;
  color: #172033;
  background: #fffbeb;
  font: 13px/1.5 system-ui, sans-serif;
  white-space: normal;
  cursor: auto;
}
.word-diff-panel.open,
.word-diff-panel:hover,
[data-docs-review-word-diff="panel"]:hover > .word-diff-panel,
[data-docs-review-word-diff="panel"]:hover + .word-diff-panel,
tr[data-docs-review-word-diff="panel"]:hover .word-diff-panel {
  display: block;
}
.word-diff-panel-title {
  margin-bottom: 2px;
  font: 600 11px/1.4 system-ui, sans-serif;
  letter-spacing: .03em;
  text-transform: uppercase;
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
.applies-block .review-applies-badge,
.applies-inline .review-applies-badge {
  display: inline-block;
  margin: 0 6px 4px 0;
  padding: 1px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #334155;
  background: #f8fafc;
  font: 600 12px/1.6 system-ui, sans-serif;
  white-space: nowrap;
}
.review-applies-badge[data-lifecycle="preview"],
.review-applies-badge[data-lifecycle="beta"] {
  border-color: #93c5fd;
  color: #1e3a8a;
  background: #eff6ff;
}
.review-applies-badge[data-lifecycle="deprecated"],
.review-applies-badge[data-lifecycle="removed"] {
  border-color: #fca5a5;
  color: #7f1d1d;
  background: #fef2f2;
}
`.trim();

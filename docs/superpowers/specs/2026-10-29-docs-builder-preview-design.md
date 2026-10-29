# Docs Builder Preview design

## Goal

Provide one local command that shows every documentation page changed on the current branch, links each page to a local docs-builder preview, and highlights changed blocks in the rendered page.

## Audience and distribution

The tool lives in `bmorelli25/docs-builder-preview` as a standalone TypeScript CLI. It can run against any Elastic documentation repository that uses `docs-builder`.

## Command

The primary command is:

```sh
docs-builder-preview [repository-path]
```

If no path is provided, the tool uses the current directory.

Useful options:

- `--base <ref>`: Override the comparison base.
- `--docs-port <port>`: Use an existing docs-builder server.
- `--port <port>`: Set the review app port.
- `--no-fetch`: Do not refresh the base branch.
- `--no-open`: Do not open the browser automatically.

## Comparison baseline

By default, the tool reviews all committed and uncommitted changes on the current branch against its main-branch merge base.

1. Detect the Git repository and current branch.
2. Determine the base branch from the current GitHub pull request when `gh` is available. Otherwise use `origin/main`, then `main`.
3. Fetch the base branch unless `--no-fetch` is set.
4. Compute the merge base and collect added, copied, modified, renamed, and deleted files.
5. Include uncommitted and staged changes in the same review.

The UI shows the selected base and warns when it could not refresh the remote reference.

## Runtime architecture

The CLI runs two local services:

1. **docs-builder**
   - Reuse a healthy docs-builder server when one is already listening on the configured port.
   - Otherwise launch `docs-builder serve` as a child process in the target repository.
   - Stream startup and build errors into the review app.

2. **Review proxy**
   - Listen on localhost only.
   - Reverse-proxy docs-builder HTML and assets under the same origin as the review UI.
   - Inject a small review client into rendered HTML responses.
   - Expose JSON endpoints for changed files, page diff metadata, and diagnostics.
   - Watch Git and changed source files, then notify the browser through server-sent events.

The CLI owns and stops only the docs-builder process that it launched.

## User interface

The default route is a changed-pages dashboard.

### Sidebar

The sidebar lists:

- Changed standalone Markdown pages.
- Added and deleted line counts.
- File status: added, modified, renamed, or deleted.
- Changed snippets and the pages that include them.
- Supporting changes such as images, navigation files, redirects, and configuration.
- Mapping status for rendered highlights.

Filters support filename search and file status. The sidebar displays the comparison base and refresh state.

### Rendered page

Selecting a page opens its proxied docs-builder output without leaving the review app. The injected client:

- Highlights added rendered blocks in green.
- Highlights modified rendered blocks in yellow.
- Provides previous-change and next-change controls.
- Shows the source path and line range for the active block.
- Opens the source file in the configured editor when possible.

Deleted text cannot appear in the rendered page. Deleted hunks appear in an expandable source panel beside the nearest surviving block. Deleted pages appear in the sidebar without a preview.

## Highlight mapping

docs-builder does not expose source line metadata in rendered HTML, so the first version uses explicit, observable matching rather than pretending every hunk maps perfectly.

1. Parse zero-context Git hunks into added, modified, and deleted line ranges.
2. Segment the changed Markdown into block candidates, preserving source line ranges. The segmenter recognizes headings, paragraphs, lists, tables, code fences, MyST directives, and stepper content.
3. Build normalized text fingerprints for each changed block. Remove Markdown syntax while retaining visible text, link labels, code text, and image alt text.
4. Scan semantic rendered elements such as headings, paragraphs, list items, table rows, code blocks, figures, and admonitions.
5. Match source and rendered blocks using normalized exact matching first, then token similarity with conservative thresholds.
6. Highlight only confident matches.
7. Mark ambiguous or unmatched blocks in the sidebar and provide their source diff instead.

The UI reports the number of mapped and unmapped changed blocks for every page.

## URL mapping

The tool mirrors docs-actions preview URL behavior:

- Remove `.md`.
- Collapse a trailing `/index.md` to the directory route.
- Skip standalone preview links for `_snippets`.
- Preserve page anchors when opening a selected change.

Changed snippets are resolved to consuming pages by scanning MyST include directives. A snippet can therefore produce multiple affected-page entries.

## Failure handling

- **docs-builder missing:** Show the documented install command and exit.
- **docs-builder startup failure:** Keep the dashboard available and show captured stderr.
- **Port conflict:** Reuse a healthy compatible service or select another free port.
- **No Git repository:** Explain that the command must run in a Git-backed docs repository.
- **No changed pages:** Show a clean empty state with the selected base.
- **Stale or unavailable remote:** Continue with the local base ref and show a warning.
- **Unmapped rendered block:** Never guess. Show the source hunk and mark it unmapped.
- **Unsupported file:** List it under supporting changes instead of dropping it.

## Security

- Bind to `127.0.0.1` by default.
- Do not expose repository files through arbitrary paths.
- Normalize and validate all requested file paths against the repository root.
- Do not execute content from changed documentation.
- Use subprocess argument arrays rather than shell interpolation.

## Technology

- Node.js 20 or later.
- TypeScript.
- A small HTTP server and proxy layer.
- Git commands through a typed subprocess wrapper.
- Lightweight static browser UI with no framework for the first version.
- Vitest for unit and integration tests.
- Playwright for the rendered-review workflow.

## Testing

Unit tests cover:

- Git name-status and hunk parsing.
- Merge-base selection.
- Markdown-to-route conversion.
- Markdown block segmentation and fingerprints.
- Rendered element matching.
- Include-consumer discovery.
- Path traversal rejection.

Integration tests use a fixture Git repository and a fake docs-builder server to verify:

- Changed-page enumeration.
- Proxying and review-client injection.
- Added, modified, deleted, and renamed files.
- Snippet consumers.
- Live refresh events.
- Startup and shutdown behavior.

Playwright verifies the dashboard, page selection, highlights, navigation between changes, deleted-hunk panel, and unmapped-block state.

## Initial release boundary

The first release supports local branch review against the merge base, rendered block highlights, snippet consumers, live refresh, and source diffs for deletions or unmapped blocks.

It does not include GitHub review comments, remote PR previews, collaborative sessions, or a browser extension.

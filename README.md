# docs-builder-preview

Review every documentation change on the current branch in a local
docs-builder preview. The dashboard highlights what changed in the rendered
pages, tracks which pages you’ve checked, and lets you leave inline edit
suggestions you can copy for an LLM or a follow-up PR.

## Requirements

- Node.js 20 or later
- Git
- `docs-builder` on `PATH`, unless you use `--docs-port`

## Install

From this repository:

```sh
npm install
npm run build
npm link
```

This installs the `docs-builder-preview` command globally through npm.

## Usage

Run the command in a docs repository:

```sh
docs-builder-preview
```

Or pass the repository path:

```sh
docs-builder-preview /path/to/docs-content
```

The command starts the review dashboard first, then starts or reuses
docs-builder on port 3000. It recognizes a running docs-builder by its HTML
live-reload marker. If another service occupies port 3000, it launches
docs-builder on a free port instead.

The review app listens on `127.0.0.1` and opens in the default browser. If its
requested port is occupied, it selects a free localhost port and prints the
actual URL. The dashboard stays available while docs-builder starts and after
a startup or build failure, where it shows recent builder output and preview
requests return HTTP 503.

The command watches the repository, rebuilds review data after changes, and
refreshes connected previews while keeping scroll position when possible.
Press Ctrl+C to stop services started by the command. A docs-builder server
that was already running is never stopped.

Pass `--docs-port` only to use an existing compatible docs-builder server on a
specific port. The dashboard reports a clear failure if that server is absent
or incompatible. The command never launches a new docs-builder process when
this option is present.

### Options

```text
--base <ref>        Compare against this Git ref
--docs-port <port>  Require an existing docs-builder server on this port
--port <port>       Run the review app on this port (default: 4173)
--no-fetch          Do not refresh the selected remote base
--no-open           Do not open a browser
-h, --help          Show command help
```

By default, the comparison base is the current pull request base when `gh` can
resolve it, then `origin/main`, then `main`.

## Dashboard

The left sidebar lists every changed docs file on the branch:

- Filter by status (added, modified, renamed, copied, deleted) and sort by path
  or most changed
- Collapse or resize the sidebar
- Copy a source path from the list
- See snippet consumers when a shared include changed
- Mark previewable pages as reviewed (checks live in server memory only for
  this session; they are not written to the repo)

The preview pane loads the real docs-builder HTML (scripts stripped, same-origin
sandbox) and overlays review highlighting from the parent page.

Toolbar toggles:

- **Hide deleted lines** — hide red deleted-line panels in the preview
- **Suggest edits** — enable text selection to create inline suggestions

## Change highlighting

Against the selected base, the preview marks:

- Added and modified blocks (including tables, lists, headings, admonitions,
  tabsets, and content inside colon/`:::` directives)
- Word-level diffs inside modified blocks (red strikethrough deletions, green
  insertions)
- Deleted hunks as nearby panels (optional via **Hide deleted lines**)
- Frontmatter changes at the top of the page
- `applies_to` / product badges when those lines change
- Changed pages in the in-preview docs navigation
- Include/snippet and step-title matches when the visible text differs from the
  raw Markdown source

Docset substitutions such as `{{kib}}` are expanded when matching rendered
text to source.

## Inline suggestions

With **Suggest edits** on, select text in the preview to open the suggestion
editor:

| Type | Meaning |
| --- | --- |
| **Replace** | New wording for the selection (⌘R / Ctrl+R saves as Replace) |
| **Instruction** | Free-form rewrite guidance (⌘I / Ctrl+I saves as Instruction) |
| **Delete** | Clear the editor text and save to mark the span for removal |

Save with the **Save** button or ⌘↩ / Ctrl+Enter. Escape or click away
cancels without saving. Replace/Instruction only set the type; they do not
save by themselves.

Selections that cover word-diff markup use the current (green) text only, not
red strikethrough deletions.

Saved suggestions:

- Appear as blue (replace), pink (instruction), or red-tinted (delete) marks in
  the preview — click a mark or a sidebar item to open the popover
- Show the same colored kind pills in the sidebar list and in popovers
- Support Edit, Delete, and Okay; click away also dismisses the popover
- Persist under `~/.docs-builder-preview/suggestions/` (outside the docs repo),
  keyed by repository and branch

The Suggestions panel offers:

- **Copy** — clipboard export as Markdown for an LLM or reviewer
- **Preview** — show that same export in a modal before copying
- **Clear** — remove all suggestions for this branch

The export lists each suggestion with file path, line range, section heading
(preserving `{{substitutions}}`), type, rendered original text, source excerpt,
and new text or instruction. The preamble tells the model to map preview wording
back into source syntax and to keep substitutions, links, and directives unless
the suggestion says otherwise.

## Testing

Run the unit and integration suite:

```sh
npm test
```

Install Playwright's Chromium build once, then run the real-browser dashboard
tests:

```sh
npx playwright install chromium
npm run test:e2e
```

Run static verification and the production build:

```sh
npm run typecheck
npm run build
```

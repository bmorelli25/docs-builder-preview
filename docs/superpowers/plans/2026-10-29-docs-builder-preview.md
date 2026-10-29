# Docs Builder Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and install a TypeScript CLI that lists changed documentation pages, proxies docs-builder, and highlights changed rendered blocks.

**Architecture:** A Git analysis module produces a serializable review model. A localhost HTTP server exposes that model, serves a dashboard, and proxies docs-builder pages after injecting a browser highlighter. The CLI coordinates Git analysis, docs-builder startup, watching, browser launch, and shutdown.

**Tech Stack:** Node.js 20+, TypeScript, `commander`, `chokidar`, `http-proxy`, Vitest, and Playwright.

## Global Constraints

- Bind the review server to `127.0.0.1`.
- Compare committed, staged, and unstaged changes with the merge base of the selected base ref.
- Default base selection order is GitHub pull request base, `origin/main`, then `main`.
- Highlight only confident rendered-block matches; expose unmatched changes instead of guessing.
- Added blocks are green and modified blocks are yellow.
- Deleted content appears in a source panel.
- Snippet changes list their consuming pages.
- Validate file paths against the repository root.
- Use subprocess argument arrays, never interpolated shell commands.
- The CLI owns and stops only child processes it launches.

---

### Task 1: Project scaffold and CLI options

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts`
- Create: `src/options.ts`
- Create: `test/options.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: `parseOptions(argv: string[]): CliOptions`
- Produces: `CliOptions` with `repositoryPath`, `base`, `docsPort`, `port`, `fetch`, and `open`.

- [ ] Write `test/options.test.ts` first with cases for defaults, an explicit repository path, `--base`, `--docs-port`, `--port`, `--no-fetch`, and `--no-open`.
- [ ] Run `npm test -- test/options.test.ts` and verify it fails because `src/options.ts` does not exist.
- [ ] Add the package manifest, TypeScript config, ignore rules, CLI entry point, and the minimal option parser needed by the tests.
- [ ] Run `npm test -- test/options.test.ts` and verify all option tests pass.

### Task 2: Git review model

**Files:**
- Create: `src/git.ts`
- Create: `src/model.ts`
- Create: `src/routes.ts`
- Create: `test/git.test.ts`
- Create: `test/routes.test.ts`

**Interfaces:**
- Consumes: `CliOptions`.
- Produces: `buildReview(repositoryPath: string, baseOverride?: string, fetch?: boolean): Promise<ReviewModel>`.
- Produces: `ReviewModel`, `ChangedFile`, `ChangedBlock`, and `DeletedHunk`.
- Produces: `sourcePathToRoute(path: string): string | null`.

- [ ] Write failing tests using temporary Git repositories for modified, added, deleted, renamed, staged, and unstaged Markdown files.
- [ ] Write failing route tests for `.md`, `/index.md`, snippets, spaces, and URL encoding.
- [ ] Run the focused tests and verify failures are caused by missing modules.
- [ ] Implement an argument-array Git runner, base selection, merge-base resolution, name-status parsing, zero-context hunk parsing, and route conversion.
- [ ] Run the focused tests and verify they pass.

### Task 3: Markdown blocks and snippet consumers

**Files:**
- Create: `src/markdown.ts`
- Create: `src/snippets.ts`
- Create: `test/markdown.test.ts`
- Create: `test/snippets.test.ts`

**Interfaces:**
- Produces: `segmentMarkdown(source: string): SourceBlock[]`.
- Produces: `normalizeVisibleText(source: string): string`.
- Produces: `findSnippetConsumers(repositoryPath: string, snippetPaths: string[]): Promise<Map<string, string[]>>`.

- [ ] Write failing tests for headings, paragraphs, lists, code fences, directives, links, image alt text, and include directives.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement conservative segmentation and normalization, then scan Markdown files for MyST `{include}` and `{literalinclude}` paths resolved relative to the consumer.
- [ ] Run the focused tests and verify they pass.

### Task 4: Review server, proxy, and browser highlighter

**Files:**
- Create: `src/server.ts`
- Create: `src/docs-builder.ts`
- Create: `src/ui/dashboard.ts`
- Create: `src/ui/highlighter.ts`
- Create: `src/ui/styles.ts`
- Create: `test/server.test.ts`
- Create: `test/docs-builder.test.ts`

**Interfaces:**
- Consumes: `ReviewModel`.
- Produces: `startReviewServer(options: ServerOptions): Promise<RunningServer>`.
- Produces: `ensureDocsBuilder(options: DocsBuilderOptions): Promise<DocsBuilderHandle>`.

- [ ] Write failing integration tests with a fake upstream server for `/`, `/api/review`, proxied assets, HTML injection, path traversal rejection, and shutdown ownership.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement the localhost server, API, dashboard, reverse proxy, HTML injection, SSE endpoint, and docs-builder readiness/startup logic.
- [ ] Implement browser-side normalized text matching, green/yellow highlights, navigation controls, deleted-source panel, and explicit unmatched states.
- [ ] Run the focused tests and verify they pass.

### Task 5: CLI orchestration, live refresh, install, and end-to-end verification

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Create: `test/cli.test.ts`

**Interfaces:**
- Consumes all prior task interfaces.
- Produces the installed `docs-builder-preview` executable.

- [ ] Write a failing CLI test that starts the command against a fixture repository, receives a dashboard response, modifies a Markdown file, and observes a refresh event.
- [ ] Run the CLI test and confirm the missing orchestration causes the failure.
- [ ] Wire repository validation, Git analysis, docs-builder startup, server startup, file watching, browser opening, signal handling, and useful terminal output.
- [ ] Document installation and all options in `README.md`.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Run `npm link`, invoke `docs-builder-preview --help`, and smoke-test the command against `/Users/brandonmorelli/docs-content`.

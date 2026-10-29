# Task 5 report

Status: DONE

Commit: recorded in the final task response

## Implementation

- `src/cli.ts` now coordinates option parsing, Git review analysis, snippet
  consumer discovery, docs-builder startup or reuse, the review server,
  repository watching, browser launch, and graceful shutdown.
- Chokidar waits until its initial scan is ready, debounces changes, serializes
  rebuilds, and closes before the server. Shutdown also removes both signal
  listeners and waits for an active rebuild.
- Refreshed review data replaces the server's current model before the server
  broadcasts the SSE `refresh` event.
- Every changed file receives a serializable `consumers` list from
  `findSnippetConsumers`.
- Browser opening uses `open` on macOS, `cmd /c start` on Windows, and
  `xdg-open` on Linux. `--no-open` skips it.
- The review server still stops docs-builder only when `ensureDocsBuilder`
  reports that this process owns it.
- `README.md` documents requirements, installation, behavior, shutdown, and
  every command option.

## Red

Focused command:

```text
npm test -- test/cli.test.ts
```

Expected failure:

```text
TypeError: runCli is not a function
Test Files  1 failed (1)
Tests  1 failed (1)
```

The fixture integration test initialized a real Git repository, ran a fake
docs-builder server, and called the missing production CLI runtime.

The installed executable check also exposed a symlink entry-point bug: after
`npm link`, `docs-builder-preview --help` exited with no help output. The
entry-point check now supports npm's linked executable path.

## Green

Focused command:

```text
npm test -- test/cli.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests  1 passed (1)
```

The test verifies the dashboard response, snippet consumer attachment, a live
Markdown edit, an SSE refresh event, rebuilt API data, signal-listener cleanup,
and preservation of a reused docs-builder server.

## Final verification

Command:

```text
npm test && npm run typecheck && npm run build && git diff --check && docs-builder-preview --help
```

Result:

```text
Test Files  9 passed (9)
Tests  75 passed (75)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
Installed CLI help: exit 0, all options listed
```

`npm link` completed successfully.

## Smoke-test decision

The deterministic fixture integration test ran first and passed. The real
`/Users/brandonmorelli/docs-content` repository exists, and `docs-builder` is
installed, but no docs-builder service was listening on port 3000. Starting a
full docs-content build is the long smoke test the task explicitly allows
skipping when it may block, so it was not started.

## Self-review

- Initial and refreshed models use the canonical Git root returned by
  `buildReview`.
- Refresh builds disable remote fetching, avoiding a network fetch on every
  file save.
- Watcher startup failures close the owned review server and docs-builder.
  Runtime watcher errors and rebuild errors are reported without creating
  overlapping rebuilds.
- Runtime shutdown is idempotent. It closes the watcher, SSE clients, review
  server, and only an owned docs-builder process.
- Browser launch failure is nonfatal and is reported on stderr.
- The server reads its current review model for the dashboard, API, and
  highlighter injection, so all routes switch to the rebuilt data together.

## Concerns

- The real docs-content build was not run, as described above.
- npm emits an existing `Unknown env config "devdir"` warning for each npm
  command. It does not affect tests, typechecking, linking, or the build.

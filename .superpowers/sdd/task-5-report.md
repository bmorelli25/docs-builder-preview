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

## Review findings follow-up

Status: DONE

### Red evidence

The new user-facing regression tests failed before implementation:

```text
npm test -- test/ui.test.ts test/server.test.ts test/docs-builder.test.ts test/cli.test.ts

Test Files  4 failed (4)
Tests  6 failed | 20 passed (26)
```

The failures showed that:

- snippet consumers were absent from the dashboard;
- `review-source` selectors were neither applied nor validated;
- the dashboard did not create an EventSource;
- explicit `--docs-port` launched docs-builder when no server was healthy;
- no independent, retry-safe cleanup coordinator existed.

A second CLI regression test then exposed that production review generation
discarded snippet blocks:

```text
AssertionError: expected the changed snippet to contain
source: "First change.", but blocks was []
```

### Fixes

- Dashboard entries for changed snippets now list each Markdown consumer as a
  proxied link with an encoded `review-source` selector.
- The proxy accepts a selector only when it names a changed review file and
  the requested route belongs to one of that file's consumers. It strips the
  internal selector before proxying and returns HTTP 400 for unknown,
  duplicated, or unrelated selectors.
- Markdown diff blocks are retained for snippets and other Markdown files
  without standalone routes, allowing the consumer preview to inject and
  highlight the changed included content.
- The dashboard subscribes to `/api/events`, reloads on `refresh`, and closes
  its EventSource during page teardown.
- Cleanup uses `Promise.allSettled` across the watcher, review server, and
  owned docs-builder. Successful resources stay complete; failed resources
  can be retried. Signal listeners are installed immediately after
  docs-builder acquisition and are removed in `finally`.
- `--docs-port` now requires a healthy existing service. It never launches a
  process when the option is supplied.
- README usage and option text now distinguish the default managed port 3000
  behavior from explicit existing-server mode.

### Green evidence

Focused verification:

```text
Test Files  4 passed (4)
Tests  28 passed (28)
```

Final verification:

```text
npm test && npm run typecheck && npm run build && git diff --check

Test Files  9 passed (9)
Tests  83 passed (83)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
```

The real `/Users/brandonmorelli/docs-content` smoke test was intentionally not
run. The parent agent will run it after review.

### Follow-up self-review

- The integration path now starts from a real Git fixture, verifies the
  generated consumer link, opens it through the proxy, and observes the
  snippet's changed source in the injected highlighter.
- Selector authorization is derived only from the current review model. A
  caller cannot select an arbitrary repository path or apply a snippet to an
  unrelated route.
- Review-server shutdown closes HTTP connections even if owned docs-builder
  cleanup fails, then retries only the failed docs-builder cleanup.
- CLI shutdown attempts all registered resources in parallel and reports
  aggregate failures without losing retry state.
- Reused docs-builder services remain unowned and are never registered for
  CLI cleanup.

## Large-repository watcher follow-up

Status: DONE

### Root cause

Chokidar recursively installed per-directory and per-file watches across the
real docs-content repository. On macOS this exhausted the process file
descriptor limit and emitted `EMFILE: too many open files, watch` before CLI
startup could become healthy.

### Red evidence

The regression tests were added before the watcher implementation changed:

```text
npm test -- test/cli.test.ts

Test Files  1 failed (1)
Tests  2 failed | 3 passed (5)
```

The failures showed that the watcher seam did not exist and an injected
startup `EMFILE` error was ignored, allowing `runCli` to resolve instead of
rejecting and cleaning up.

### Fix

- Replaced Chokidar with one native `node:fs.watch` call using
  `{ recursive: true }`. On macOS this uses the bounded native recursive watch
  facility instead of creating a descriptor for each repository entry.
- Added an injectable recursive-watch factory used by both focused watcher
  tests and CLI startup integration tests.
- Watch events from `.git` and `node_modules` path segments are ignored.
- Relevant events retain the 75 ms debounce and promise-chain serialization,
  so rebuilds never overlap.
- Startup yields one event-loop turn after registering the watcher error
  handler. A startup error rejects immediately, closes the watcher, and
  triggers the existing independent CLI resource cleanup.
- Runtime watch errors remain visible on stderr. Shutdown clears pending
  timers, closes the native watcher, and waits for queued rebuilds.
- Removed Chokidar and its transitive dependency from the package and lock
  files.

### Regression coverage

- Exactly one recursive watcher factory call is made for the repository root.
- `.git` and nested `node_modules` events produce no rebuild.
- Bursts debounce to one rebuild.
- A second burst during an active rebuild queues exactly one serialized
  rebuild.
- Runtime watcher errors are reported.
- Injected startup `EMFILE` rejects `runCli`, closes the watcher and review
  server, removes signal listeners, and leaves a reused docs-builder running.

### Green evidence

```text
npm test && npm run typecheck && npm run build && git diff --check

Test Files  9 passed (9)
Tests  85 passed (85)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
```

The real docs-content smoke test was not rerun in this subtask.

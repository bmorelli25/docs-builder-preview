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

## Dashboard-first startup follow-up

Status: DONE

### Red evidence

After the lower-level startup tests were red, the CLI integration suite
reported five failures:

```text
npm test -- test/cli.test.ts

Test Files  1 failed (1)
Tests  5 failed | 4 passed (9)
```

The injected docs-builder seam was unused, the dashboard was not available
during builder startup, builder failures rejected or disappeared, preview
status stayed unavailable after success, and CLI cleanup did not own the
injected child.

### Implementation

- Git analysis now completes first, then the review server and repository
  watcher start before docs-builder readiness begins.
- SIGINT and SIGTERM handlers are installed before server, watcher, or
  docs-builder startup. The shared startup AbortController is passed to
  `ensureDocsBuilder`.
- The review URL is printed and optionally opened as soon as the dashboard is
  listening, including the actual fallback port.
- Builder logs update bounded dashboard status while startup continues.
- Builder success switches the proxy to the validated local upstream.
- Builder startup, build, missing-command, and explicit-port compatibility
  failures switch status to `failed` but do not stop the dashboard or Git
  watcher.
- The watcher continues rebuilding review data and broadcasting refreshes
  after builder failure.
- Only an owned handle is registered with the CLI cleanup coordinator.
  Repeated runtime shutdown stops it exactly once; the review server never
  participates in docs-builder ownership.
- `README.md` now documents marker-based reuse, both port fallbacks,
  dashboard-first startup, visible logs, and HTTP 503 behavior.

### Focused coverage

- Dashboard responds from inside an injected, still-running builder startup.
- Signal handlers and AbortSignal exist before the builder call.
- Failure logs and error text render in the dashboard and 503 response.
- Git live refresh continues after builder failure.
- Explicit `--docs-port` incompatibility remains visible without launching a
  replacement process.
- Owned docs-builder cleanup runs exactly once.
- Existing compatible marker services remain unowned.

### Final verification

```text
npm test && npm run typecheck && npm run build && git diff --check

Test Files  9 passed (9)
Tests  109 passed (109)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
```

Concern: the real docs-content smoke test was not rerun during this follow-up.

## Drained runtime failure status follow-up

Status: DONE

- CLI monitoring still consumes the same owned-handle `exit` promise, but that
  promise now resolves only after child stdio drains.
- The deterministic integration fixture exits the owned process with code 13
  while a descendant keeps stderr open and writes
  `final stderr before close`.
- The first SSE refresh to failed state now occurs after that final line reaches
  the CLI log callback.
- The first fetched failed status includes both the code 13 error and the final
  stderr line. No second refresh or race-dependent retry is needed.
- Intentional stop remains marked before SIGTERM and is ignored by the runtime
  failure monitor.

Final verification:

```text
Test Files  9 passed (9)
Tests  121 passed (121)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
```

Concern: the real docs-content smoke test was not rerun during this follow-up.

## Runtime builder-exit monitoring follow-up

Status: DONE

### Behavior

- After an owned docs-builder becomes ready, the CLI monitors its exit promise.
- An unexpected numeric exit or signal changes dashboard state from `ready` to
  `failed` with the exact code or signal.
- Existing bounded builder logs remain attached to the failed state.
- Changing state to failed clears the upstream URL in the review server, so
  preview requests return the controlled HTTP 503 response instead of
  contacting a dead child and returning a stale 502.
- Dashboard, APIs, SSE, Git watching, and review refresh remain available.
- Intentional CLI cleanup and shutdown races are ignored by the runtime monitor.
- Existing unowned docs-builder services have no monitor and remain untouched.

### Deterministic coverage

- Injected code 9 exit updates status, preserves the final stderr line, emits
  SSE refresh, returns preview 503, and leaves the dashboard available.
- Injected SIGKILL exit reports the signal in dashboard status.
- Runtime cleanup still calls an owned handle's stop exactly once.
- Low-level child tests distinguish unexpected code, unexpected signal, and
  intentional stop.

### Final verification

```text
npm test && npm run typecheck && npm run build && git diff --check

Test Files  9 passed (9)
Tests  119 passed (119)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
```

Concern: the real docs-content smoke test was not rerun during this follow-up.

The real docs-content smoke test was not rerun in this subtask.

## Fatal runtime watcher follow-up

Status: DONE

### Red evidence

The runtime-failure tests were changed before production behavior:

```text
npm test -- test/cli.test.ts

Test Files  1 failed (1)
Tests  2 failed | 4 passed (6)
```

The CLI timed out waiting for fatal handling because a native watcher `error`
event only printed a warning. The focused watcher test also proved that the
fatal callback was never invoked.

### Fix

- A native watcher runtime error is now reported once and dispatched to a
  fatal handler. Repeated error events cannot start overlapping shutdowns.
- `runCli` handles the fatal event by setting exit status 1 and calling its
  existing cleanup coordinator. That coordinator independently closes the
  watcher, review server, and owned docs-builder.
- Signal listeners are removed by the same `stop()` path used for normal
  shutdown.
- Tests can inject `setExitCode` and `onFatal` callbacks, avoiding mutation of
  the Vitest process while still verifying executable behavior.
- Fatal callback failures are caught and reported through the warning channel;
  they cannot become unhandled promise rejections.

### Regression coverage

- A post-startup native watcher error is printed to stderr.
- Fatal handling requests exit code 1.
- The watcher and review server close before the injected fatal callback
  resolves.
- A reused docs-builder remains running.
- Process signal listeners return to their original counts.
- A rejecting fatal callback is reported without an unhandled rejection.

### Green evidence

```text
npm test && npm run typecheck && npm run build && git diff --check

Test Files  9 passed (9)
Tests  86 passed (86)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
```

## Bounded post-exit stdio drain follow-up

Status: DONE

### Red evidence

The held-stdio fixture failed before the production change:

```text
npm test -- test/cli.test.ts -t "keeps stdio"

Test Files  1 failed (1)
Tests  1 failed | 12 skipped (13)
Observed refresh time: 1233ms
Required maximum: 750ms
```

The owned process exited, but its descendant inherited stderr and kept the
pipe open. The public exit notification waited for `close`, so the dashboard
did not enter the failed state until the descendant exited.

### Fix

- Added the exported `DOCS_BUILDER_DRAIN_TIMEOUT_MS` constant, set to 250ms.
- The owned child's `exit` event now snapshots its code, signal, and
  intentional-stop state, then starts the bounded drain timer.
- A normal `close` publishes immediately after stdout/stderr drain and
  cancels the timer. If `close` does not arrive, the timer publishes the
  snapshot once.
- Existing readiness and stop paths still use the prompt child `exit` event.
  Intentional shutdown cannot be relabeled by delayed publication.

### Regression coverage

- The existing final-stderr fixture still proves that a normal delayed
  `close` includes the last stderr line in the first failed dashboard state.
- A deterministic descendant now holds inherited stderr for 1200ms. The
  dashboard transitions to failed, emits its refresh, and returns preview
  status 503 within the bounded interval.
- Existing tests retain unexpected code, unexpected signal, and intentional
  stop coverage.

### Green evidence

Focused verification:

```text
npm test -- test/docs-builder.test.ts test/cli.test.ts -t "drain|keeps stdio"

Test Files  2 passed (2)
Tests  3 passed | 23 skipped (26)
```

Final verification:

```text
npm test && npm run test:e2e && npm run typecheck && npm run build && git diff --check

Test Files  9 passed (9)
Tests  123 passed (123)
Playwright: 1 passed (1)
TypeScript typecheck: exit 0
Build: exit 0
git diff --check: exit 0
```

### Self-review and concerns

The timer is canceled on `close`, publication is guarded against duplicate
resolution, and the intentional flag is captured at child exit rather than
when the drain window ends. The real docs-content smoke test was not run in
this follow-up.

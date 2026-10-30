# Task 4 report

## Changed files

- `src/server.ts`: Added a localhost-only dashboard, review API, safe reverse proxy, HTML asset injection, SSE streaming, traversal rejection, and owned-process shutdown.
- `src/docs-builder.ts`: Added localhost readiness probing, existing-server reuse, argument-array process startup, readiness waiting, and owned-child termination.
- `src/ui/dashboard.ts`: Added the review dashboard and root-page preview routing.
- `src/ui/highlighter.ts`: Added generated, injection-safe browser JavaScript with shared Markdown normalization, unique exact/token matching, navigation, deleted-source display, and explicit unmatched states.
- `src/ui/styles.ts`: Added distinct green added-block and yellow modified-block styles.
- `test/server.test.ts`: Added real fake-upstream integration coverage for dashboard/API responses, proxying, injection, traversal, SSE, shutdown, and ownership.
- `test/docs-builder.test.ts`: Added real HTTP/process coverage for reuse, safe startup arguments, readiness, shutdown, and early child exit.
- `test/ui.test.ts`: Added generated-asset syntax, injection safety, root-route, shared-normalizer, and color coverage.

## Red

Initial focused command:

```text
npm test -- test/server.test.ts test/docs-builder.test.ts
```

Result: exit 1. Both suites failed during import because `src/server.ts` and `src/docs-builder.ts` did not exist.

First implementation command:

```text
npm test -- test/server.test.ts test/docs-builder.test.ts
```

Result: exit 1. Three failures exposed an invalid fake executable setup, client-side URL normalization hiding a raw traversal test, and an SSE test server retaining an open connection. The tests were corrected to use a real Node child with argument arrays, raw HTTP request targets, and explicit connection cleanup.

Edge-case command:

```text
npm test -- test/server.test.ts test/ui.test.ts
```

Result: exit 1. Two regressions failed as intended: a changed root index linked back to the dashboard, and review-server shutdown waited on an active SSE connection.

Shared-normalizer command:

```text
npm test -- test/ui.test.ts
```

Result: exit 1. Generated browser data did not include text produced by the existing Markdown normalizer.

Lifecycle command:

```text
npm test -- test/server.test.ts test/ui.test.ts
```

Result: exit 1. Invalid upstream validation did not stop an already-owned docs-builder handle.

## Green

Task-focused verification:

```text
npm test -- test/server.test.ts test/docs-builder.test.ts test/ui.test.ts
```

Result: exit 0, 3 test files passed and 14 tests passed.

Type and whitespace verification:

```text
npm run typecheck && git diff --check
```

Result: exit 0. TypeScript reported no errors and Git reported no whitespace errors.

Full-suite verification outside the restricted sandbox:

```text
npm test
```

Result: exit 0, 8 test files passed and 67 tests passed. The earlier sandboxed full run failed because macOS denied Git test fixture writes under the system temporary directory; the unrestricted run confirmed those pre-existing integration tests pass.

Build verification:

```text
npm run build
```

Result: exit 0.

## Self-review

- Both listeners bind to `127.0.0.1`; upstream URLs are restricted to loopback HTTP(S) without credentials.
- The proxy accepts only GET and HEAD, rejects malformed encodings, traversal segments, encoded separators used for traversal, backslashes, control bytes, and authority-confusion targets.
- HTML responses are requested uncompressed, capped at 10 MiB, and have content length recalculated after injection. Non-HTML and SSE responses stream directly.
- Generated browser data escapes script-ending and HTML-significant characters. Dashboard text and attributes are HTML-escaped.
- Browser matching reuses `normalizeVisibleText`, requires one unique exact match or one unique contiguous token match of at least three tokens, and reports ambiguity or absence as unmatched.
- A changed root index uses `/?preview=1`, leaving `/` available for the dashboard.
- Existing docs-builder servers are never stopped. Spawned children use an executable plus argument array with `shell: false`, and only owned children receive termination signals.
- Review shutdown force-closes active proxy/SSE sockets before stopping an owned docs-builder.

## Concerns

- The default docs-builder invocation is `docs-builder serve --port <port>` in the repository working directory. Callers can supply `command` and `args` if a local installation uses a different entry point.
- Token matching deliberately leaves blocks shorter than three tokens unmatched unless their full normalized text has one exact DOM match.
- npm emits the pre-existing `devdir` configuration warning.

## Findings fixes

### Red

Focused findings command:

```text
npm test -- test/server.test.ts test/docs-builder.test.ts
```

Result: exit 1, 3 tests failed and 11 passed. `/api/events` was proxied upstream instead of being app-owned, a 404 response was incorrectly reused as docs-builder, and a child terminated by `SIGTERM` timed out instead of reporting its signal.

SSE cleanup command:

```text
npm test -- test/server.test.ts
```

Result: exit 1, 2 tests failed and 7 passed. The broadcast methods did not return registered-recipient counts, so disconnect and shutdown cleanup were not observable.

Browser refresh command:

```text
npm test -- test/ui.test.ts
```

Result: exit 1, 1 test failed and 4 passed. The generated highlighter did not subscribe to app refresh events.

### Green

Focused verification:

```text
npm test -- test/server.test.ts test/docs-builder.test.ts test/ui.test.ts
```

Result: exit 0, 3 test files passed and 19 tests passed.

Type and whitespace verification:

```text
npm run typecheck && git diff --check
```

Result: exit 0. TypeScript reported no errors and Git reported no whitespace errors.

### Self-review

- `/api/events` is handled by the review app before proxy routing. Each connection receives `event: connected`, is registered for broadcasts, and is removed when its response closes.
- `broadcast()` and `refresh()` return the recipient count. Tests verify one active recipient, zero after disconnect, and zero after shutdown.
- Shutdown ends app-owned SSE responses before closing remaining server connections.
- Generated preview JavaScript subscribes with `EventSource`, reloads only for `refresh`, and closes its stream during page unload.
- Readiness now requires a 2xx response. Arbitrary 4xx services on the requested port are not reused.
- Startup checks both `exitCode` and `signalCode`, reporting a terminating signal before the readiness timeout.

## Integrated dashboard fix

### Red

Focused dashboard command:

```text
npm test -- test/ui.test.ts test/server.test.ts
```

Result: exit 1, 4 tests failed and 18 passed. The dashboard had no preview iframe, iframe-targeted links, app-shell controls, grouped file sections, status badges, or client-side selection/filter behavior.

### Green

Focused dashboard command:

```text
npm test -- test/ui.test.ts test/server.test.ts
```

Result: exit 0, 2 test files passed and 22 tests passed.

Type verification:

```text
npm run typecheck
```

Result: exit 0.

### Self-review and visual QA

- `/` now renders a fixed-height review shell with a header, scrollable sidebar, and same-origin `docs-preview` iframe. Links update the iframe without navigating the dashboard.
- The header shows changed-file and unique preview-URL counts plus the escaped base ref.
- The sidebar provides labeled search and status controls. Filtering hides nonmatching items and empty groups and displays a no-results state.
- Files are grouped as previewable pages, snippets and their consumers, deleted pages, and supporting files. Status badges, rename origins, and added/deleted line counts remain visible.
- Snippet consumer links retain the validated `review-source` query and target the preview iframe.
- File paths, previous paths, base refs, warnings, routes, search attributes, and accessible labels are HTML-escaped.
- The dashboard keeps its app-owned SSE refresh subscription.
- Browser QA confirmed the empty preview state, iframe navigation, selected/current state, desktop shell, scrollable narrow sidebar, and stacked 600-pixel responsive layout.

## Dashboard persistence and isolation fixes

### Red

Focused command:

```text
npm test -- test/ui.test.ts test/server.test.ts
```

Result: exit 1, 5 tests failed and 20 passed. The iframe lacked a sandbox, dashboard state was not stored or restored, selector-specific snippet URLs inflated the page count, refresh reloaded without first persisting state, and sandbox-origin SSE responses lacked CORS.

### Green

Focused command:

```text
npm test -- test/ui.test.ts test/server.test.ts
```

Result: exit 0, 2 test files passed and 25 tests passed.

Type verification:

```text
npm run typecheck
```

Result: exit 0.

### Self-review

- Dashboard state uses `sessionStorage` and includes the active href, search value, status value, and sidebar scroll position. Storage failures degrade to the empty/default UI.
- The SSE refresh listener persists state before reloading the dashboard. On startup, filters and scroll position are restored, and the iframe receives a fresh navigation to the saved href so its changed content reloads.
- Active state is restored only by exact href match against the new dashboard links. A removed or changed href leaves the iframe without `src` and displays the empty state.
- The preview iframe uses `sandbox="allow-scripts"` without `allow-same-origin`. Injected highlighting and EventSource code can run, but changed documentation executes with an opaque origin and cannot access the parent dashboard or same-origin APIs.
- `/api/events` returns `Access-Control-Allow-Origin: null` only when the request origin is the opaque sandbox origin. `/api/review` has no CORS header.
- Preview counts use unique route pathnames. Multiple changed snippets rendered through one consumer page count as one preview page even though their selector URLs differ.

## Sandboxed preview asset CORS fix

### Red

Focused command:

```text
npm test -- test/server.test.ts
```

Result: exit 1, 1 test failed and 12 passed. Proxied static assets and rendered pages had no CORS header, so stylesheets and fonts requested by an opaque-origin sandbox could be blocked.

### Green

Focused command:

```text
npm test -- test/server.test.ts
```

Result: exit 0, 1 test file passed and 13 tests passed.

Type verification:

```text
npm run typecheck
```

Result: exit 0.

### Self-review

- Every response returned by the fixed localhost docs-builder proxy, including injected HTML and streamed static assets, now receives `Access-Control-Allow-Origin: *`.
- Any upstream `Access-Control-Allow-Credentials` header is removed so it cannot conflict with wildcard CORS.
- Dashboard and app API responses do not pass through the proxy header helper. `/api/review` remains non-CORS, and `/api/events` keeps its separate opaque-origin-only policy.
- The iframe remains `sandbox="allow-scripts"` without `allow-same-origin`; no repository-file route or filesystem access was added.

## Parent-only preview runtime

### Red

Focused command:

```text
npm test -- test/ui.test.ts test/server.test.ts
```

Result: exit 1, 10 tests failed and 16 passed. Proxied HTML still received executable highlighter code, the iframe still allowed scripts, proxy and event responses still carried CORS, snippet links did not identify their source file, and no trusted parent runtime/data or mapping UI existed.

### Green

Focused command:

```text
npm test -- test/ui.test.ts test/server.test.ts
```

Result: exit 0, 2 test files passed and 26 tests passed.

Type verification:

```text
npm run typecheck
```

Result: exit 0.

### Self-review and browser QA

- Proxied docs-builder HTML and assets now stream without injected style or script content. Proxy and app API responses carry no CORS headers.
- The preview iframe is `sandbox="allow-same-origin"` with no `allow-scripts`, so stylesheets and fonts load naturally while inline and external changed-document scripts cannot execute.
- Review data is normalized server-side and embedded in a script-safe `application/json` element in the trusted dashboard. Snippet consumer links identify the snippet path through `data-source-file`.
- The parent runtime reads `iframe.contentDocument` after load, performs unique exact/token matching, applies green added and yellow modified highlights, and owns previous/next navigation and matched/unmatched counts.
- Each selected sidebar link receives matched, partial, or unmatched mapping status. The trusted Open source action uses the review model's canonical repository path, selected source file, and active block line.
- Deleted hunks are inserted after the nearest matched surviving block. Only hunks with no matched block appear in the parent toolbar fallback.
- The app-owned EventSource remains only in the parent dashboard.
- Browser QA loaded upstream HTML containing a malicious inline script and a same-origin stylesheet. The script did not execute, the stylesheet loaded, two blocks were highlighted, the deletion appeared inline, mapping showed `2 matched · 0 unmatched`, and Open source resolved to the canonical file and line.

Full verification:

```text
npm test && npm run typecheck && npm run build && git diff --check
```

Result: exit 0, 9 test files passed and 100 tests passed, TypeScript typecheck and build completed, and Git reported no whitespace errors. The first full run exposed one stale CLI assertion that expected snippet source injection into proxied HTML; the integration test now verifies that source remains in trusted dashboard data while the proxied page is unchanged.

## CSP-safe highlights and source URLs

### Red

Focused command:

```text
npm test -- test/server.test.ts test/ui.test.ts
```

Result: exit 1, 4 tests failed and 24 passed. The app had no dedicated highlight stylesheet endpoint, the parent still created an inline style element, review data had no encoded source base, and reserved-character Open source URLs were not safely constructed.

### Green

Focused command:

```text
npm test -- test/server.test.ts test/ui.test.ts
```

Result: exit 0, 2 test files passed and 28 tests passed.

Type verification:

```text
npm run typecheck
```

Result: exit 0.

### Self-review

- `/_review/highlight.css` is app-owned and returns the existing highlight/deletion CSS as `text/css; charset=utf-8` with `X-Content-Type-Options: nosniff` and no CORS.
- The parent inserts a same-origin `<link rel="stylesheet" href="/_review/highlight.css">` into the iframe document. It no longer creates inline style elements, so strict upstream `style-src 'self'` policies permit highlights.
- Proxied CSP headers remain intact, and the iframe still excludes `allow-scripts`.
- Open source bases are built from the canonical repository and file paths by encoding each slash-delimited segment independently. Spaces, `#`, `?`, `%`, and Unicode are encoded while separators remain `/`.
- Source lines are restricted to positive safe integers and otherwise fall back to line 1.

Full verification:

```text
npm test && npm run typecheck && npm run build && git diff --check
```

Result: exit 0, 9 test files passed and 104 tests passed, TypeScript typecheck and build completed, and Git reported no whitespace errors.

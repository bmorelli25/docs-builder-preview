# Task 3 report

## Changed files

- `src/markdown.ts`: Added conservative source-block segmentation and visible-text normalization for headings, paragraphs, list items, code fences, and MyST directives.
- `src/snippets.ts`: Added Git-root-aware discovery of Markdown consumers for MyST `{include}` and `{literalinclude}` directives.
- `test/markdown.test.ts`: Added block, line-range, normalization, directive, link, image-alt, table, quote, and fenced-code coverage.
- `test/snippets.test.ts`: Added real-repository coverage for consumer-relative paths, canonical changed paths, path containment, symlinks, and directive examples inside code fences.

## Red

Initial command:

```text
npm test -- test/markdown.test.ts test/snippets.test.ts
```

Result: exit 1. Both suites failed during import because `src/markdown.ts` and `src/snippets.ts` did not exist. No tests ran.

Code-fence normalization command:

```text
npm test -- test/markdown.test.ts
```

Result: exit 1, 1 test failed and 5 passed. Markdown-looking HTML, emphasis markers, and an entity inside a code fence normalized to `&` instead of remaining literal code text.

Consumer-scanning command:

```text
npm test -- test/snippets.test.ts
```

Result: exit 1, 1 test failed and 2 passed. A sample `{include}` nested inside a larger Markdown code fence was incorrectly treated as a real dependency.

## Green

Focused command:

```text
npm test -- test/markdown.test.ts test/snippets.test.ts
```

Result: exit 0, 2 test files passed and 9 tests passed.

Full verification:

```text
npm test && npm run build && git diff --check
```

Result: exit 0, 5 test files passed, 43 tests passed, TypeScript compilation completed successfully, and Git reported no whitespace errors.

## Self-review

- Segmentation intentionally emits candidates only for semantic block shapes that can be matched without a Markdown renderer. Include directives emit no visible candidate because their rendered text comes from another file.
- Normalization retains link labels, image alt text, inline code, and literal fenced-code content while removing source-only Markdown syntax and collapsing visible whitespace.
- Ambiguous block quotes and tables remain single conservative candidates. The highlighter can expose complex or unmatched Markdown rather than selecting a nearby DOM node.
- Consumer paths are resolved from each consumer file, converted to Git-root-relative POSIX paths, and discarded when they escape the canonical Git root.
- Git is executed with an executable and argument array. Repository paths, pathspecs, and changed paths are never shell-interpolated.
- Consumer scanning uses NUL-delimited Git output, includes tracked and untracked `.md` and `.mdx` files, ignores binary or invalid UTF-8 content, and does not read symlink targets.
- The scanner tracks Markdown fence boundaries so directive examples inside ordinary code fences do not create false consumers.
- No blocking concerns found. Complex nested inline Markdown can remain unmatched by design, and npm still emits the pre-existing `devdir` configuration warning.

## Findings fixes

### Red

Focused command:

```text
npm test -- test/markdown.test.ts test/snippets.test.ts
```

Result: exit 1, 2 test files failed, 5 tests failed, and 8 passed. The failures showed missing snippet paths retained without filesystem verification, internal and escaping symlinks compared lexically, thematic breaks emitted as candidates, intraword underscores stripped, and out-of-range numeric entities throwing `RangeError`.

### Green

Focused command:

```text
npm test -- test/markdown.test.ts test/snippets.test.ts
```

Result: exit 0, 2 test files passed and 13 tests passed.

Full verification:

```text
npm test && npm run build && git diff --check
```

Result: exit 0, 5 test files passed, 47 tests passed, TypeScript compilation completed successfully, and Git reported no whitespace errors.

### Self-review

- The Git root, changed snippet paths, and include targets are now canonicalized with `realpath`. Only existing regular files whose canonical location remains under the canonical root participate in matching.
- Internal symlink aliases resolve to one canonical repository-relative key. Symlinks that escape the repository, and missing changed paths, are omitted.
- CommonMark thematic breaks using `*`, `-`, or `_` are discarded before candidate construction. Setext headings retain their existing precedence when a hyphen line follows paragraph text.
- Underscore emphasis requires non-word boundaries, preserving intraword single and double underscores while still normalizing standalone emphasis.
- Numeric entities are decoded only for valid Unicode scalar values. Invalid, unsafe, null, surrogate, and out-of-range values remain unchanged, so normalization cannot throw on them.
- No new blocking concerns found. Complex inline Markdown remains intentionally conservative, and npm still emits the pre-existing `devdir` configuration warning.

## Final findings fixes

### Red

Focused command:

```text
npm test -- test/markdown.test.ts
```

Result: exit 1, 1 test file failed, 2 tests failed, and 9 passed. Inline-code contents were altered by HTML, entity, link, and emphasis normalization after delimiters were removed. A two-line Setext heading was split into a paragraph and a heading beginning on its second content line.

### Green

Focused command:

```text
npm test -- test/markdown.test.ts
```

Result: exit 0, 1 test file passed and 11 tests passed.

Full verification:

```text
npm test && npm run build && git diff --check
```

Result: exit 0, 5 test files passed, 49 tests passed, TypeScript compilation completed successfully, and Git reported no whitespace errors.

### Self-review

- Inline code is extracted before all block and inline normalization, represented by collision-resistant placeholders, and restored afterward. Literal HTML, entities, links, emphasis markers, and intraword underscores inside code spans are preserved.
- Backtick runs close only on an equal-length run. CommonMark code-span line endings and surrounding-space handling are applied before restoration.
- Setext detection scans contiguous paragraph content for its underline, then emits one heading with the full source range and all content lines as visible text.
- A hyphen underline after paragraph content remains a Setext heading, while standalone thematic breaks remain excluded.
- No new blocking concerns found. The normalizer remains intentionally conservative for complex Markdown, and npm still emits the pre-existing `devdir` configuration warning.

## ATX heading fix

### Red

Focused command:

```text
npm test -- test/markdown.test.ts
```

Result: exit 1, 1 test file failed, 1 test failed, and 11 passed. Valid whitespace-delimited closing hash sequences remained in normalized ATX heading text.

### Green

Focused command:

```text
npm test -- test/markdown.test.ts
```

Result: exit 0, 1 test file passed and 12 tests passed.

Full verification:

```text
npm test && npm run build && git diff --check
```

Result: exit 0, 5 test files passed, 50 tests passed, TypeScript compilation completed successfully, and Git reported no whitespace errors.

### Self-review

- ATX opening syntax is identified before line normalization. A trailing hash sequence is removed only from an ATX heading and only when it is separated from heading content by whitespace.
- Hashes embedded in words, followed by more heading text, escaped with a backslash, or protected inside inline code remain visible.
- Trailing spaces after a valid closing sequence are removed with that sequence.
- No new blocking concerns found. The pre-existing npm `devdir` configuration warning remains.

## Deleted snippets and nested links

### Red

Focused command:

```text
npm test -- test/markdown.test.ts test/snippets.test.ts
```

Result: exit 1, 2 test files failed, 3 tests failed, and 15 passed. Missing changed snippet paths were discarded, deleted include targets could not be matched, and nested parentheses left destination fragments visible while malformed links were normalized too aggressively.

### Green

Focused command:

```text
npm test -- test/markdown.test.ts test/snippets.test.ts
```

Result: exit 0, 2 test files passed and 18 tests passed.

Full verification:

```text
npm test && npm run build && git diff --check
```

Result: exit 0, 5 test files passed, 52 tests passed, TypeScript compilation completed successfully, and Git reported no whitespace errors.

### Self-review

- Missing changed snippet paths are retained after lexical containment under the canonical Git root. Existing paths still pass through `realpath` and regular-file checks, so symlink escapes remain excluded.
- Missing include targets are resolved through their nearest existing ancestor. The ancestor is canonicalized before the missing suffix is reapplied, which permits deleted snippets while rejecting paths through symlinked parents outside the repository.
- Inline links and images now use a scanner with balanced label brackets and destination parentheses. Escapes are respected while balancing, and nested destinations are removed without leaving suffix fragments.
- Malformed or unbalanced destinations remain unchanged. Bare destinations containing whitespace are also left unchanged rather than risking a false visible-text match.
- Reference-style links and images retain their visible label or alt text through the same scanner.
- No new blocking concerns found. Complex destinations with titles are left unmatched conservatively, and npm still emits the pre-existing `devdir` configuration warning.

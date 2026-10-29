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

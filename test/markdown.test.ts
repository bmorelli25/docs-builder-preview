import { describe, expect, it } from "vitest";

import {
  normalizeVisibleText,
  segmentMarkdown,
} from "../src/markdown.js";

describe("segmentMarkdown", () => {
  it("segments rendered semantic blocks with source line ranges", () => {
    const source = [
      "# Get started",
      "",
      "This paragraph spans",
      "two source lines.",
      "",
      "- First item",
      "  continues here",
      "- Second **item**",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      ":::{note}",
      ":class: compact",
      "",
      "Read the *warning*.",
      ":::",
    ].join("\n");

    expect(segmentMarkdown(source)).toEqual([
      {
        kind: "heading",
        startLine: 1,
        endLine: 1,
        source: "# Get started",
        text: "Get started",
      },
      {
        kind: "paragraph",
        startLine: 3,
        endLine: 4,
        source: "This paragraph spans\ntwo source lines.",
        text: "This paragraph spans two source lines.",
      },
      {
        kind: "list-item",
        startLine: 6,
        endLine: 7,
        source: "- First item\n  continues here",
        text: "First item continues here",
      },
      {
        kind: "list-item",
        startLine: 8,
        endLine: 8,
        source: "- Second **item**",
        text: "Second item",
      },
      {
        kind: "code",
        startLine: 10,
        endLine: 12,
        source: "```ts\nconst answer = 42;\n```",
        text: "const answer = 42;",
      },
      {
        kind: "directive",
        startLine: 14,
        endLine: 18,
        source:
          ":::{note}\n:class: compact\n\nRead the *warning*.\n:::",
        text: "Read the warning.",
      },
    ]);
  });

  it("keeps ambiguous block quotes and tables together as paragraphs", () => {
    const source = [
      "> Quoted **text**",
      "> remains together.",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| one | two |",
    ].join("\n");

    expect(segmentMarkdown(source)).toMatchObject([
      {
        kind: "paragraph",
        startLine: 1,
        endLine: 2,
        text: "Quoted text remains together.",
      },
      {
        kind: "paragraph",
        startLine: 4,
        endLine: 6,
        text: "Name Value one two",
      },
    ]);
  });

  it("does not create visible candidates for include directives", () => {
    const source = [
      "```{include} ../_snippets/shared.md",
      "```",
      "",
      ":::{literalinclude} ../examples/example.ts",
      ":::",
    ].join("\n");

    expect(segmentMarkdown(source)).toEqual([]);
  });

  it("preserves Markdown-looking syntax inside code fences", () => {
    const source = [
      "```html",
      '<main data-label="**literal**">',
      "  &amp;",
      "</main>",
      "```",
    ].join("\n");

    expect(segmentMarkdown(source)).toMatchObject([
      {
        kind: "code",
        text: '<main data-label="**literal**"> &amp; </main>',
      },
    ]);
    expect(normalizeVisibleText(source)).toBe(
      '<main data-label="**literal**"> &amp; </main>',
    );
  });

  it("does not emit visible candidates for thematic breaks", () => {
    const source = [
      "Before.",
      "",
      "---",
      "",
      "***",
      "",
      "___",
      "",
      "After.",
    ].join("\n");

    expect(segmentMarkdown(source).map(({ text }) => text)).toEqual([
      "Before.",
      "After.",
    ]);
  });

  it("segments multiline Setext headings as one source block", () => {
    const source = [
      "A heading with `literal_*_`",
      "that spans **two** content lines",
      "================================",
      "",
      "Following paragraph.",
    ].join("\n");

    expect(segmentMarkdown(source)).toEqual([
      {
        kind: "heading",
        startLine: 1,
        endLine: 3,
        source:
          "A heading with `literal_*_`\nthat spans **two** content lines\n================================",
        text: "A heading with literal_*_ that spans two content lines",
      },
      {
        kind: "paragraph",
        startLine: 5,
        endLine: 5,
        source: "Following paragraph.",
        text: "Following paragraph.",
      },
    ]);
  });

  it("removes only valid optional ATX closing hash sequences", () => {
    const source = [
      "# Release notes ###",
      "",
      "## C# reference",
      "",
      "### Hashes ### remain literal",
      "",
      "#### Use `# literal` ####   ",
      "",
      "##### Keep an escaped \\###",
    ].join("\n");

    expect(segmentMarkdown(source).map(({ text }) => text)).toEqual([
      "Release notes",
      "C# reference",
      "Hashes ### remain literal",
      "Use # literal",
      "Keep an escaped ###",
    ]);
  });
});

describe("normalizeVisibleText", () => {
  it("keeps link labels, image alt text, and inline code", () => {
    expect(
      normalizeVisibleText(
        "Read [the guide](../guide.md), inspect ![request flow](flow.png), and run `npm test`.",
      ),
    ).toBe("Read the guide, inspect request flow, and run npm test.");
  });

  it("handles balanced nested link destinations conservatively", () => {
    expect(
      normalizeVisibleText(
        "See [API](../fn_(one_(two)).md) and ![flow (dark)](img/flow_(dark).png). Keep [broken](path_(oops).",
      ),
    ).toBe(
      "See API and flow (dark). Keep [broken](path_(oops).",
    );
  });

  it("removes block syntax, directive options, and inline formatting", () => {
    const source = [
      "## **Important**",
      "> Use ~~old~~ *formatted* text.",
      ":class: compact",
      "<span>Visible</span>",
    ].join("\n");

    expect(normalizeVisibleText(source)).toBe(
      "Important Use old formatted text. Visible",
    );
  });

  it("preserves intraword underscores under CommonMark rules", () => {
    expect(
      normalizeVisibleText(
        "Keep snake_case and before__middle__after, but normalize _emphasis_.",
      ),
    ).toBe(
      "Keep snake_case and before__middle__after, but normalize emphasis.",
    );
  });

  it("leaves invalid numeric entities unchanged instead of throwing", () => {
    expect(() =>
      normalizeVisibleText("Invalid: &#999999999999; and &#x110000;."),
    ).not.toThrow();
    expect(
      normalizeVisibleText("Invalid: &#999999999999; and &#x110000;."),
    ).toBe("Invalid: &#999999999999; and &#x110000;.");
  });

  it("preserves literal inline-code contents while removing delimiters", () => {
    expect(
      normalizeVisibleText(
        "Use `<tag> **bold** snake_case &amp; [label](target)` or ``one ` tick``.",
      ),
    ).toBe(
      "Use <tag> **bold** snake_case &amp; [label](target) or one ` tick.",
    );
  });
});

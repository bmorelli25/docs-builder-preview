import { describe, expect, it } from "vitest";

import {
  normalizeVisibleText,
  segmentMarkdown,
} from "../src/markdown.js";

describe("segmentMarkdown", () => {
  it("skips frontmatter", () => {
    const blocks = segmentMarkdown(
      ["---", "applies_to:", "  stack: all", "---", "", "# Title"].join("\n"),
    );
    expect(blocks.map((block) => block.startLine)).toEqual([6]);
  });

  it("segments each table row as its own block", () => {
    const source = [
      "Intro text.",
      "| Feature | Hosted |",
      "| --- | --- |",
      "| **Agent Builder** | ✅ |",
      "| AI Assistant | ✅ (deprecated) |",
    ].join("\n");

    expect(
      segmentMarkdown(source).map(({ startLine, text }) => [startLine, text]),
    ).toEqual([
      [1, "Intro text."],
      [2, "Feature Hosted"],
      [4, "Agent Builder ✅"],
      [5, "AI Assistant ✅ (deprecated)"],
    ]);
  });

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
        kind: "paragraph",
        startLine: 17,
        endLine: 17,
        source: "Read the *warning*.",
        text: "Read the warning.",
      },
    ]);
  });

  it("segments the content of nested colon directives", () => {
    const source = [
      "::::{tab-set}",
      ":::{tab-item} Docker",
      "Run the **image**.",
      ":::",
      ":::{tab-item} Kubernetes",
      "- Apply the manifest.",
      ":::",
      "::::",
      "",
      "::::{admonition} Requirements",
      "Needs a {{stack}} subscription.",
      "::::",
    ].join("\n");

    expect(
      segmentMarkdown(source).map(({ kind, startLine, text }) => [kind, startLine, text]),
    ).toEqual([
      ["paragraph", 3, "Run the image."],
      ["list-item", 6, "Apply the manifest."],
      ["paragraph", 11, "Needs a \uFFFC subscription."],
    ]);
  });

  it("keeps block quotes together and splits tables into rows", () => {
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
      { kind: "paragraph", startLine: 4, endLine: 4, text: "Name Value" },
      { kind: "paragraph", startLine: 6, endLine: 6, text: "one two" },
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

  it("includes the final content line in an unclosed code fence", () => {
    const source = [
      "```ts",
      "const first = 1;",
      "const last = 2;",
    ].join("\n");

    expect(segmentMarkdown(source)).toEqual([
      {
        kind: "code",
        startLine: 1,
        endLine: 3,
        source,
        text: "const first = 1; const last = 2;",
      },
    ]);
  });

  it("includes the final content line in an unclosed colon directive", () => {
    const source = [
      ":::{note}",
      ":class: compact",
      "",
      "First line.",
      "Last *line*.",
    ].join("\n");

    expect(segmentMarkdown(source)).toEqual([
      {
        kind: "paragraph",
        startLine: 4,
        endLine: 5,
        source: "First line.\nLast *line*.",
        text: "First line. Last line.",
      },
    ]);
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

  it("does not reinterpret list items as Setext heading content", () => {
    const source = [
      "- First item",
      "---",
      "",
      "- Second item",
      "===",
      "",
      "Ordinary multiline",
      "heading content",
      "---",
    ].join("\n");

    expect(segmentMarkdown(source)).toEqual([
      {
        kind: "list-item",
        startLine: 1,
        endLine: 1,
        source: "- First item",
        text: "First item",
      },
      {
        kind: "list-item",
        startLine: 4,
        endLine: 4,
        source: "- Second item",
        text: "Second item",
      },
      {
        kind: "paragraph",
        startLine: 5,
        endLine: 5,
        source: "===",
        text: "===",
      },
      {
        kind: "heading",
        startLine: 7,
        endLine: 9,
        source: "Ordinary multiline\nheading content\n---",
        text: "Ordinary multiline heading content",
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
  it("marks empty link text that docs-builder fills with the page title", () => {
    expect(
      normalizeVisibleText(
        "| **[AI Assistant](/ai.md)** | ✅ | Refer to [](/compare.md). |",
      ),
    ).toBe("AI Assistant ✅ Refer to \uFFFC .");
  });

  it("expands known docset substitutions and leaves a gap for built-in ones", () => {
    expect(
      normalizeVisibleText(
        "{{agent-builder}} works with {{elastic-sec}} and {{product.observability}}.",
        {
          "agent-builder": "Elastic Agent Builder",
          "elastic-sec": "Elastic Security",
        },
      ),
    ).toBe(
      "Elastic Agent Builder works with Elastic Security and \uFFFC .",
    );
  });

  it("drops explicit heading anchors", () => {
    expect(
      normalizeVisibleText(
        "## {{kib}} product documentation for AI chat [air-gapped-kibana-product-documentation]",
        { kib: "Kibana" },
      ),
    ).toBe("Kibana product documentation for AI chat");
  });

  it("strips applies_to and icon roles without stripping ordinary inline code", () => {
    expect(
      normalizeVisibleText(
        "Use {{kib}} {applies_to}`stack: ga 9.1` {icon}`logo_kibana` with `inline code`.",
        { kib: "Kibana" },
      ),
    ).toBe("Use Kibana with inline code.");
  });

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

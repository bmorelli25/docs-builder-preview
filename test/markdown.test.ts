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
});

describe("normalizeVisibleText", () => {
  it("keeps link labels, image alt text, and inline code", () => {
    expect(
      normalizeVisibleText(
        "Read [the guide](../guide.md), inspect ![request flow](flow.png), and run `npm test`.",
      ),
    ).toBe("Read the guide, inspect request flow, and run npm test.");
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
});

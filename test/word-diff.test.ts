import { describe, expect, it } from "vitest";

import { normalizeVisibleText } from "../src/markdown.js";
import { diffWords } from "../src/word-diff.js";

describe("diffWords", () => {
  it("orders deletions before insertions within each change", () => {
    expect(diffWords("Kibana will prompt you", "Kibana might prompt you")?.parts)
      .toEqual([
        { kind: "equal", text: "Kibana" },
        { kind: "delete", text: "will", spaceBefore: true, spaceAfter: true },
        { kind: "insert", text: "might" },
        { kind: "equal", text: "prompt you" },
      ]);
  });

  it("splits punctuation from words but keeps version numbers whole", () => {
    expect(diffWords("✅ (deprecated) ✅", "✅ (deprecated in 9.4) ✅")?.parts)
      .toEqual([
        { kind: "equal", text: "✅ (deprecated" },
        { kind: "insert", text: "in 9.4" },
        { kind: "equal", text: ") ✅" },
      ]);
  });

  it("records whether a deleted run had surrounding whitespace", () => {
    expect(diffWords("Shared prompt, then more", "Shared, then more")?.parts)
      .toEqual([
        { kind: "equal", text: "Shared" },
        { kind: "delete", text: "prompt", spaceBefore: true, spaceAfter: false },
        { kind: "equal", text: ", then more" },
      ]);
  });

  it("diffs what readers see after substitutions and Markdown stripping", () => {
    const substitutions = { kib: "Kibana" };
    const diff = diffWords(
      normalizeVisibleText("{{kib}} **will** [prompt](/a.md) you", substitutions),
      normalizeVisibleText("Kibana *might* [prompt](/b.md) you", substitutions),
    );
    expect(diff?.parts.map(({ kind, text }) => [kind, text])).toEqual([
      ["equal", "Kibana"],
      ["delete", "will"],
      ["insert", "might"],
      ["equal", "prompt you"],
    ]);
  });

  it("folds a lone shared word into a larger rewrite", () => {
    expect(
      diffWords("one two three and four five six", "alpha beta and gamma delta")
        ?.parts,
    ).toBeUndefined();
    expect(
      diffWords(
        "Keep this one two three and four five six",
        "Keep this alpha beta and gamma delta",
      )?.parts.map(({ kind, text }) => [kind, text]),
    ).toEqual([
      ["equal", "Keep this"],
      ["delete", "one two three and four five six"],
      ["insert", "alpha beta and gamma delta"],
    ]);
  });

  it("keeps a lone shared token that sits between pure insertions", () => {
    expect(
      diffWords(
        "AI Assistant ✅ ✅",
        "AI Assistant ✅ (deprecated in 9.6) ✅ (deprecated) Use Agent Builder.",
      )?.parts.map(({ kind, text }) => [kind, text]),
    ).toEqual([
      ["equal", "AI Assistant ✅"],
      ["insert", "(deprecated in 9.6)"],
      ["equal", "✅"],
      ["insert", "(deprecated) Use Agent Builder."],
    ]);
  });

  it("returns nothing for empty sides, identical text, or no shared words", () => {
    expect(diffWords("", "New text")).toBeUndefined();
    expect(diffWords("Old text", "")).toBeUndefined();
    expect(diffWords("Same words.", "Same words.")).toBeUndefined();
    expect(diffWords("Entirely old", "Brand new")).toBeUndefined();
    expect(diffWords("Old .", "New .")).toBeUndefined();
  });

  it("reports similarity and overlap for pairing decisions", () => {
    expect(diffWords("AI Assistant ✅", "AI Assistant ✅ (deprecated)"))
      .toMatchObject({ similarity: 2 / 3, overlap: 1 });
  });

  it("shows generated link text in deleted words as an ellipsis", () => {
    expect(
      diffWords(
        normalizeVisibleText("Refer to old [](/old.md) page now."),
        "Refer to the guide now.",
      )?.parts,
    ).toContainEqual({
      kind: "delete",
      text: "old … page",
      spaceBefore: true,
      spaceAfter: true,
    });
  });
});

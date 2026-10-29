import { describe, expect, it } from "vitest";

import { sourcePathToRoute } from "../src/routes.js";

describe("sourcePathToRoute", () => {
  it("converts Markdown paths to preview routes", () => {
    expect(sourcePathToRoute("docs/getting-started.md")).toBe(
      "/docs/getting-started",
    );
  });

  it("collapses index pages to directory routes", () => {
    expect(sourcePathToRoute("docs/guide/index.md")).toBe("/docs/guide/");
    expect(sourcePathToRoute("index.md")).toBe("/");
  });

  it("does not create standalone routes for snippets", () => {
    expect(sourcePathToRoute("docs/_snippets/reusable.md")).toBeNull();
  });

  it("encodes spaces and URL-significant characters in each segment", () => {
    expect(sourcePathToRoute("docs/a page #1.md")).toBe(
      "/docs/a%20page%20%231",
    );
  });

  it("encodes Unicode without encoding path separators", () => {
    expect(sourcePathToRoute("docs/café/überblick.md")).toBe(
      "/docs/caf%C3%A9/%C3%BCberblick",
    );
  });

  it("ignores non-Markdown files", () => {
    expect(sourcePathToRoute("docs/navigation.yml")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { parseOptions } from "../src/options.js";

describe("parseOptions", () => {
  it("uses defaults", () => {
    expect(parseOptions([])).toEqual({
      repositoryPath: process.cwd(),
      base: undefined,
      docsPort: undefined,
      port: 4173,
      fetch: true,
      open: true,
    });
  });

  it("accepts an explicit repository path", () => {
    expect(parseOptions(["/tmp/docs"]).repositoryPath).toBe("/tmp/docs");
  });

  it("accepts a comparison base", () => {
    expect(parseOptions(["--base", "origin/release"]).base).toBe(
      "origin/release",
    );
  });

  it("accepts an existing docs-builder port", () => {
    expect(parseOptions(["--docs-port", "3000"]).docsPort).toBe(3000);
  });

  it("accepts a review app port", () => {
    expect(parseOptions(["--port", "8080"]).port).toBe(8080);
  });

  it("can disable fetching", () => {
    expect(parseOptions(["--no-fetch"]).fetch).toBe(false);
  });

  it("can disable opening the browser", () => {
    expect(parseOptions(["--no-open"]).open).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseOptions } from "../src/options.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function expectInvalidPort(option: "--docs-port" | "--port", value: string) {
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process exited");
  }) as never);

  expect(() => parseOptions([option, value])).toThrow("process exited");
  expect(stderr).toHaveBeenCalledWith(
    expect.stringContaining(
      `${option} must be a decimal integer between 1 and 65535`,
    ),
  );
}

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

  it.each(["--docs-port", "--port"] as const)(
    "accepts boundary values for %s",
    (option) => {
      expect(parseOptions([option, "1"])).toMatchObject({
        [option === "--port" ? "port" : "docsPort"]: 1,
      });
      expect(parseOptions([option, "65535"])).toMatchObject({
        [option === "--port" ? "port" : "docsPort"]: 65535,
      });
    },
  );

  it.each(["--docs-port", "--port"] as const)(
    "rejects non-decimal syntax for %s",
    (option) => {
      expectInvalidPort(option, "3000px");
    },
  );

  it.each(["--docs-port", "--port"] as const)(
    "rejects values below the valid range for %s",
    (option) => {
      expectInvalidPort(option, "0");
    },
  );

  it.each(["--docs-port", "--port"] as const)(
    "rejects values above the valid range for %s",
    (option) => {
      expectInvalidPort(option, "65536");
    },
  );

  it("can disable fetching", () => {
    expect(parseOptions(["--no-fetch"]).fetch).toBe(false);
  });

  it("can disable opening the browser", () => {
    expect(parseOptions(["--no-open"]).open).toBe(false);
  });
});

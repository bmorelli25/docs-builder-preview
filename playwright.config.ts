import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20_000,
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"], ["json", { outputFile: "test-results/browser-results.json" }]],
  use: { browserName: "chromium", channel: "chromium", headless: true, serviceWorkers: "allow", trace: "retain-on-failure" },
});

import { test as base, expect } from "@playwright/test";
import { startTestServer, type TestServer } from "../support/http";

export const test = base.extend<object, { harness: TestServer }>({
  harness: [async ({}, use) => {
    const harness = await startTestServer({ serveWeb: true });
    try { await use(harness); } finally { await harness.stop(); }
  }, { scope: "worker", timeout: 180_000 }],
  baseURL: async ({ harness }, use) => { await use(harness.url); },
});
export { expect };

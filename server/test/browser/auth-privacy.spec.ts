import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function login(page: Page, account: { phone: string; password: string }) {
  return page.evaluate(async credentials => {
    const response = await fetch("/api/auth/login", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    return response.status;
  }, { phone: account.phone, password: account.password });
}

test("M0(a): changing accounts never restores a cached identity or inventory", async ({ page, harness }) => {
  const a = await harness.account("Account A");
  const b = await harness.account("Account B");
  await harness.db.businessSnapshot.update({ where: { businessId: a.businessId },
    data: { state: { inventory: [{ id: "private-a", name: "A private stock", unit: "bag",
      aliases: [], price: 1000, cost: 500, qty: 5, lowAt: 1 }] } } });
  await page.goto("/__test/browser");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(done => navigator.serviceWorker.addEventListener("controllerchange", () => done(), { once: true }));
    }
  });
  expect(await login(page, a)).toBe(200);
  expect((await page.request.get("/api/inventory")).status(), "Inventory endpoint must exist before testing the worker").toBe(200);
  const original = await page.evaluate(async () => ({
    me: await (await fetch("/api/auth/me")).json() as { user: { id: string } },
    inventory: await (await fetch("/api/inventory")).json() as { inventory: { id: string }[] },
  }));
  expect(original.me.user.id).toBe(a.userId);
  expect(original.inventory.inventory[0]?.id).toBe("private-a");
  expect(await page.evaluate(async () => (await fetch("/api/auth/logout", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  })).status)).toBe(204);
  expect(await login(page, b)).toBe(200);
  await page.reload();
  const restored = await page.evaluate(async () => ({
    me: await (await fetch("/api/auth/me")).json() as { user: { id: string } },
    inventory: await (await fetch("/api/inventory")).json() as { inventory: { id: string }[] },
  }));
  console.log("M0(a)", JSON.stringify({ identityWasA: restored.me.user.id === a.userId,
    inventoryWasA: restored.inventory.inventory.some(product => product.id === "private-a") }));
  expect.soft(restored.me.user.id, "B must receive its own identity").toBe(b.userId);
  expect.soft(restored.inventory.inventory, "B must not receive A's stock").toEqual([]);
});

test("M0(b): two tabs refreshing expired access keep the session alive", async ({ context, page, harness }) => {
  const account = await harness.account("Refresh race");
  await page.goto("/__test/browser");
  expect(await login(page, account)).toBe(200);
  expect((await context.request.get(harness.url + "/api/inventory")).status()).toBe(200);
  const second = await context.newPage();
  await second.goto("/__test/browser");
  // Both tabs use the common client now used by auth and inventory.
  // The test server's 200ms refresh latency permits a realistic overlap.
  await Promise.all([page.evaluate(async () => {
    const path = "/__test/modules/lib/api/client.js";
    await import(path);
  }), second.evaluate(async () => {
    const path = "/__test/modules/lib/api/client.js";
    await import(path);
  })]);
  const cookies = await context.cookies();
  const access = cookies.find(cookie => cookie.name.endsWith("-access"));
  expect(access).toBeDefined();
  await context.addCookies([{ ...access!, expires: Math.floor(Date.now() / 1000) - 1 }]);
  const before = harness.refreshCount();
  const results = await Promise.all([
    page.evaluate(async () => {
      try {
        const path = "/__test/modules/lib/api/client.js";
        const module = await import(path) as {
          api: { request(path: string): Promise<unknown> } };
        await module.api.request("/api/auth/me");
        return 200;
      } catch (error: unknown) { return (error as { status?: number }).status ?? 0; }
    }),
    second.evaluate(async () => {
      try {
        const path = "/__test/modules/lib/api/client.js";
        const module = await import(path) as {
          apiRequest(path: string): Promise<unknown> };
        await module.apiRequest("/api/inventory");
        return 200;
      } catch (error: unknown) { return (error as { status?: number }).status ?? 0; }
    }),
  ]);
  const session = await harness.db.session.findFirstOrThrow({ where: { userId: account.userId } });
  const directMe = await context.request.get(harness.url + "/api/auth/me");
  console.log("M0(b)", JSON.stringify({ requestStatuses: results, sessionRevoked: Boolean(session.revokedAt),
    directMe: directMe.status() }));
  expect.soft(results).toEqual([200, 200]);
  expect.soft(session.revokedAt, "Refresh races must not revoke a legitimate session").toBeNull();
  expect.soft(directMe.status()).toBe(200);
  expect.soft(harness.refreshCount() - before, "Web Locks must avoid duplicate refreshes").toBe(1);
});

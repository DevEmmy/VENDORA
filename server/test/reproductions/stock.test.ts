import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { startTestServer } from "../support/http";

test("M0(c): ten concurrent online sales against five units accept only five and decrement stock", { timeout: 180_000 }, async () => {
  const harness = await startTestServer();
  try {
    const account = await harness.account("Concurrent stock");
    const productId = randomUUID();
    await harness.db.product.create({ data: { id: productId, businessId: account.businessId,
      name: "Rice", unitPrice: 100000n, costPrice: 50000n, stockQty: 5 } });
    const inventory = [{ id: productId, name: "Rice", aliases: [], unit: "bag",
      price: 1000, cost: 500, qty: 5, lowAt: 1 }];
    await harness.db.businessSnapshot.update({ where: { businessId: account.businessId }, data: { state: { inventory } } });
    const login = await fetch(harness.url + "/api/auth/login", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: account.phone, password: account.password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      fetch(harness.url + "/api/sales/sync", { method: "POST",
        headers: { cookie, "Content-Type": "application/json", "X-Business-ID": account.businessId },
        body: JSON.stringify({ sales: [{ id: randomUUID(), type: "sale",
          items: [{ productId, qty: 1, price: 1000 }], amount: 1000, paid: 1000,
          at: Date.now(), fromOffline: false }] }) })));
    assert(results.every(response => response.status === 200 || response.status === 409),
      "Reproduction must reach sale acceptance, not fail because an endpoint is missing");
    const response = await fetch(harness.url + "/api/inventory", { headers: { cookie, "X-Business-ID": account.businessId } });
    const saved = await response.json() as { inventory: { id: string; qty: number }[] };
    const observed = {
      accepted: results.filter(result => result.status === 200).length,
      rejected: results.filter(result => result.status === 409).length,
      remaining: saved.inventory.find(product => product.id === productId)?.qty,
    };
    console.log("M0(c)", JSON.stringify(observed));
    // M5 online policy: reject stock shortages. Offline overselling is a separate path.
    assert.deepEqual(observed, { accepted: 5, rejected: 5, remaining: 0 });
  } finally { await harness.stop(); }
});

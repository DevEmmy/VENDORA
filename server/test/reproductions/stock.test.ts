import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { startTestServer } from "../support/http";
import { apiActor } from "../support/api";

test("M0(c): ten concurrent online sales against five units accept only five and decrement stock", { timeout: 180_000 }, async () => {
  const harness = await startTestServer();
  try {
    const owner = await apiActor(harness, "Concurrent stock");
    const created = await owner.request<{ product: { id: string } }>("/api/products", "POST",
      { clientId: randomUUID(), name: "Rice", unit: "bag", unitPrice: "100000", openingQty: "5" });
    assert.equal(created.status, 201);
    const productId = created.data.product.id;
    // M0 archived the actual legacy /sales/sync failure. This retained regression
    // now targets the authoritative M5 protocol, with the same five/ten policy.
    const results = await Promise.all(Array.from({ length: 10 }, () => owner.request("/api/sales", "POST",
      { clientId: randomUUID(), items: [{ productId, quantity: "1" }], fromOffline: false })));
    assert(results.every(response => response.status === 201 || response.status === 409),
      "Reproduction must reach sale acceptance, not fail because an endpoint is missing");
    const saved = await owner.request<{ product: { currentQty: string } }>(`/api/products/${productId}`);
    const observed = {
      accepted: results.filter(result => result.status === 201).length,
      rejected: results.filter(result => result.status === 409).length,
      remaining: Number(saved.data.product.currentQty),
    };
    console.log("M0(c)", JSON.stringify(observed));
    // M5 online policy: reject stock shortages. Offline overselling is a separate path.
    assert.deepEqual(observed, { accepted: 5, rejected: 5, remaining: 0 });
  } finally { await harness.stop(); }
});

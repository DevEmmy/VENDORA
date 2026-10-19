import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { startTestServer } from "../support/http";
import { apiActor } from "../support/api";

interface Product { id: string; currentQty: string }
interface Sale {
  id: string; total: string; amountPaid: string; checkoutPaid: string; status: string;
  reversedSaleId: string | null; createdById: string; createdAt: string;
  customer: { id: string; name: string } | null;
  items: { productId: string; quantity: string; unitPrice: string; lineTotal: string }[];
  payments: { id: string; amount: string }[];
}
interface SaleReply { sale: Sale; duplicate?: boolean }
type Actor = Awaited<ReturnType<typeof apiActor>>;

async function product(owner: Actor, qty = "5", unitPrice = "100000") {
  const response = await owner.request<{ product: Product }>("/api/products", "POST", {
    clientId: randomUUID(), name: "Rice", unit: "bag", unitPrice, openingQty: qty, lowStockAt: "1",
  });
  assert.equal(response.status, 201);
  return response.data.product;
}
const sale = (productId: string, quantity = "1") => ({ clientId: randomUUID(),
  items: [{ productId, quantity }], fromOffline: false, source: "tap" });

test("M5 sales post atomically with explicit online/offline stock policies", { timeout: 240_000 }, async t => {
  const harness = await startTestServer();
  try {
    await t.test("ten online sales of one against five units accept five without negative stock", async () => {
      const owner = await apiActor(harness, "Online sale race");
      const sku = await product(owner);
      const results = await Promise.all(Array.from({ length: 10 }, () => owner.request<SaleReply & { code: string; details: { availableQuantity: string } }>(
        "/api/sales", "POST", sale(sku.id))));
      assert.equal(results.filter(result => result.status === 201).length, 5);
      assert.equal(results.filter(result => result.status === 409).length, 5);
      for (const result of results.filter(value => value.status === 409)) {
        assert.equal(result.data.code, "INSUFFICIENT_STOCK");
        assert.equal(result.data.details.availableQuantity, "0.000");
      }
      const current = await owner.request<{ product: Product }>(`/api/products/${sku.id}`);
      assert.equal(current.data.product.currentQty, "0.000");
      assert.equal(await harness.db.sale.count({ where: { businessId: owner.businessId } }), 5);
    });

    await t.test("duplicate checkout creates one sale and uses captured line prices", async () => {
      const owner = await apiActor(harness, "Idempotent checkout");
      const sku = await product(owner);
      const input = sale(sku.id, "0.5");
      const results = await Promise.all(Array.from({ length: 10 }, () => owner.request<SaleReply>("/api/sales", "POST", input)));
      assert(results.every(response => response.status === 200 || response.status === 201));
      assert.equal(new Set(results.map(result => result.data.sale.id)).size, 1);
      assert.equal(results[0]!.data.sale.total, "50000");
      assert.equal(results[0]!.data.sale.items[0]!.lineTotal, "50000");
      assert.equal(results[0]!.data.sale.createdById, owner.userId);
      assert.equal((await owner.request<{ product: Product }>(`/api/products/${sku.id}`)).data.product.currentQty, "4.500");
      assert.equal(await harness.db.sale.count({ where: { businessId: owner.businessId } }), 1);
      await owner.request(`/api/products/${sku.id}`, "PATCH", { clientId: randomUUID(), unitPrice: "500000" });
      const history = await owner.request<{ sales: Sale[] }>("/api/sales");
      assert.equal(history.status, 200);
      assert.equal(history.headers.get("cache-control"), "no-store");
      assert(history.headers.get("vary")?.toLowerCase().includes("cookie"));
      assert.equal(history.data.sales[0]!.items[0]!.unitPrice, "100000");
      assert.equal(history.data.sales[0]!.total, "50000");
    });

    await t.test("offline sale is accepted below zero and creates an oversold alert", async () => {
      const owner = await apiActor(harness, "Offline oversell");
      const sku = await product(owner, "1");
      const response = await owner.request<SaleReply>("/api/sales", "POST", { ...sale(sku.id, "3"), fromOffline: true });
      assert.equal(response.status, 201);
      assert.equal((await owner.request<{ product: Product }>(`/api/products/${sku.id}`)).data.product.currentQty, "-2.000");
      const movement = await harness.db.stockMovement.findFirstOrThrow({ where: { saleId: response.data.sale.id, type: "SALE" } });
      assert.equal(movement.oversold, true);
      const alerts = await owner.request<{ notifications: { type: string; message: string }[] }>("/api/notifications?unread=true");
      assert(alerts.data.notifications.some(alert => alert.type === "OVERSOLD" && alert.message.includes("Rice")));
      assert.equal((await owner.request(`/api/products/${sku.id}/restock`, "POST", { clientId: randomUUID(), quantity: "0.5" })).status, 200);
      assert.equal((await owner.request<{ product: Product }>(`/api/products/${sku.id}`)).data.product.currentQty, "-1.500");
    });

    await t.test("reversal restores stock exactly once, including a removed product", async () => {
      const owner = await apiActor(harness, "Sale reversal");
      const sku = await product(owner);
      const created = await owner.request<SaleReply>("/api/sales", "POST", sale(sku.id, "2"));
      assert.equal(created.status, 201);
      await owner.request(`/api/products/${sku.id}`, "DELETE", { clientId: randomUUID() });
      const input = { clientId: randomUUID(), reason: "Customer returned the goods" };
      const reversals = await Promise.all(Array.from({ length: 5 }, () => owner.request<{ sale: Sale; reversal: Sale }>(
        `/api/sales/${created.data.sale.id}/reverse`, "POST", input)));
      assert(reversals.every(result => result.status === 200));
      assert.equal(new Set(reversals.map(result => result.data.reversal.id)).size, 1);
      assert.equal(reversals[0]!.data.sale.status, "REVERSED");
      assert.equal(reversals[0]!.data.reversal.reversedSaleId, created.data.sale.id);
      assert.equal((await harness.db.product.findUniqueOrThrow({ where: { id: sku.id } })).stockQty.toString(), "5");
      assert.equal(await harness.db.stockMovement.count({ where: { productId: sku.id, type: "SALE_REVERSAL" } }), 1);
      assert.equal((await owner.request(`/api/sales/${created.data.sale.id}/reverse`, "POST", { clientId: randomUUID(), reason: "Again" })).status, 409);
    });

    await t.test("a queued physical sale of a removed item remains recorded without resurrecting it", async () => {
      const owner = await apiActor(harness, "Removed offline stock");
      const sku = await product(owner, "1");
      assert.equal((await owner.request(`/api/products/${sku.id}`, "DELETE", { clientId: randomUUID() })).status, 200);
      const posted = await owner.request<SaleReply>("/api/sales", "POST", { ...sale(sku.id, "2"), fromOffline: true });
      assert.equal(posted.status, 201);
      assert.equal((await owner.request(`/api/products/${sku.id}`)).status, 404);
      assert.equal((await harness.db.product.findUniqueOrThrow({ where: { id: sku.id } })).stockQty.toString(), "-1");
      assert.equal((await owner.request(`/api/products/${sku.id}/count`, "POST",
        { clientId: randomUUID(), countedQty: "0", observedQty: "-1" })).status, 200);
      const row = await harness.db.product.findUniqueOrThrow({ where: { id: sku.id } });
      assert(row.deletedAt);
      assert.equal(row.stockQty.toString(), "0");
    });

    await t.test("an offline batch and its replay apply each physical sale once", async () => {
      const owner = await apiActor(harness, "Offline batch");
      const sku = await product(owner, "2");
      const input = { clientId: randomUUID(), sales: Array.from({ length: 2 }, () => ({ ...sale(sku.id, "1.5"), fromOffline: true })) };
      const first = await owner.request<{ sales: Sale[] }>("/api/sales", "POST", input);
      assert.equal(first.status, 201);
      assert.equal(first.data.sales.length, 2);
      const replay = await owner.request<{ sales: Sale[] }>("/api/sales", "POST", input);
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.data.sales.map(value => value.id), first.data.sales.map(value => value.id));
      assert.equal((await harness.db.product.findUniqueOrThrow({ where: { id: sku.id } })).stockQty.toString(), "-1");
      assert.equal(await harness.db.sale.count({ where: { businessId: owner.businessId } }), 2);
    });

    await t.test("a failed multi-item sale and an online batch roll back all side effects", async () => {
      const owner = await apiActor(harness, "Atomic checkout");
      const a = await product(owner, "5");
      const b = await product(owner, "0");
      const before = (await harness.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).syncSeq;
      const input = { ...sale(a.id), items: [{ productId: a.id, quantity: "1" }, { productId: b.id, quantity: "1" }],
        customer: { clientId: randomUUID(), name: "No partial customer" } };
      assert.equal((await owner.request("/api/sales", "POST", input)).status, 409);
      assert.equal((await owner.request("/api/sales", "POST", { clientId: randomUUID(), sales: [sale(a.id), sale(b.id)] })).status, 409);
      assert.equal((await harness.db.product.findUniqueOrThrow({ where: { id: a.id } })).stockQty.toString(), "5");
      assert.equal(await harness.db.sale.count({ where: { businessId: owner.businessId } }), 0);
      assert.equal(await harness.db.customer.count({ where: { businessId: owner.businessId } }), 0);
      assert.equal((await harness.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).syncSeq, before);
    });

    await t.test("customers and subsequent repayments remain scoped and totalled in kobo", async () => {
      const owner = await apiActor(harness, "Credit sale");
      const other = await apiActor(harness, "Foreign customer");
      const sku = await product(owner);
      const response = await owner.request<SaleReply>("/api/sales", "POST", { ...sale(sku.id), amountPaid: "25000",
        customer: { clientId: randomUUID(), name: "Amina", phone: "08030000000" },
        payments: [{ clientId: randomUUID(), amount: "25000" }] });
      assert.equal(response.status, 201);
      assert.equal(response.data.sale.amountPaid, "50000");
      assert.equal(response.data.sale.checkoutPaid, "25000");
      assert.equal(response.data.sale.payments.length, 1);
      const payment = { clientId: randomUUID(), amount: "25000" };
      const repaid = await owner.request<SaleReply>(`/api/sales/${response.data.sale.id}/payments`, "POST", payment);
      assert.equal(repaid.status, 200);
      assert.equal(repaid.data.sale.amountPaid, "75000");
      assert.equal(repaid.data.sale.checkoutPaid, "25000");
      assert.equal((await owner.request<SaleReply>(`/api/sales/${response.data.sale.id}/payments`, "POST", payment)).data.sale.amountPaid, "75000");
      assert.equal((await other.request(`/api/sales/${response.data.sale.id}/payments`, "POST", { clientId: randomUUID(), amount: "1" })).status, 404);
      assert.equal((await owner.request(`/api/sales/${response.data.sale.id}/payments`, "POST", { clientId: randomUUID(), amount: "999999" })).status, 409);
    });

    await t.test("history pagination and Lagos day filters restore all original sales", async () => {
      const owner = await apiActor(harness, "History restore");
      const sku = await product(owner, "20");
      const at = Date.UTC(2026, 9, 15, 23, 0, 0); // 2026-10-16 midnight in Lagos, safely historical.
      for (const timestamp of [at - 1, at, at + 1000, at + 2000])
        assert.equal((await owner.request("/api/sales", "POST", { ...sale(sku.id), at: timestamp })).status, 201);
      const first = await owner.request<{ sales: Sale[]; nextCursor: string | null }>("/api/sales?limit=2&from=2026-10-16&to=2026-10-16");
      assert.equal(first.status, 200);
      assert.equal(first.data.sales.length, 2);
      assert(first.data.nextCursor);
      const second = await owner.request<{ sales: Sale[]; nextCursor: string | null }>(
        `/api/sales?limit=2&from=2026-10-16&to=2026-10-16&cursor=${encodeURIComponent(first.data.nextCursor)}`);
      assert.equal(second.data.sales.length, 1);
      assert.equal(new Set([...first.data.sales, ...second.data.sales].map(value => value.id)).size, 3);
      assert.equal(second.data.nextCursor, null);
      const restored = await owner.request<{ sales: Sale[] }>("/api/sales?limit=100");
      assert.equal(restored.data.sales.length, 4);
      assert.equal((await owner.request("/api/sales?from=2026-02-30")).status, 400);
    });

    await t.test("client IDs for sales, customers and payments are scoped to each business", async () => {
      const owners = await Promise.all([apiActor(harness, "Shared key A"), apiActor(harness, "Shared key B")]);
      const saleKey = randomUUID(), customerKey = randomUUID(), paymentKey = randomUUID();
      const saleIds: string[] = [];
      for (const owner of owners) {
        const sku = await product(owner);
        const result = await owner.request<SaleReply>("/api/sales", "POST", {
          ...sale(sku.id), clientId: saleKey, amountPaid: "0",
          customer: { clientId: customerKey, name: "Independent customer" },
          payments: [{ clientId: paymentKey, amount: "1" }],
        });
        assert.equal(result.status, 201);
        saleIds.push(result.data.sale.id);
      }
      assert.equal(new Set(saleIds).size, 2);
      const repaymentKey = randomUUID(), reversalKey = randomUUID();
      for (const [index, owner] of owners.entries()) {
        assert.equal((await owner.request(`/api/sales/${saleIds[index]}/payments`, "POST",
          { clientId: repaymentKey, amount: "1" })).status, 200);
        assert.equal((await owner.request(`/api/sales/${saleIds[index]}/reverse`, "POST",
          { clientId: reversalKey, reason: "Scoped reversal" })).status, 200);
      }
    });
  } finally { await harness.stop(); }
});

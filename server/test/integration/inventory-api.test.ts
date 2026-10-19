import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "../../src/generated/prisma/client";
import { applyStockMovement } from "../../src/services/inventory.service";
import { startTestServer } from "../support/http";
import { apiActor as actor } from "../support/api";

interface ProductView {
  id: string; name: string; unitPrice: string; currentQty: string;
  deletedAt: string | null; syncSeq: string;
}
interface Mutation { product: ProductView; duplicate?: boolean }
interface Change { seq: string; entity: string; entityId: string; data: { deletedAt?: string | null } }
interface Changes { changes: Change[]; nextCursor: string; hasMore: boolean }

function productInput(openingQty = "5", lowStockAt = "2") {
  return { clientId: randomUUID(), name: "Rice", unit: "bag", aliases: ["iresi"],
    unitPrice: "100000", costPrice: "60000", openingQty, lowStockAt };
}

test("M4 relational inventory is tenant-scoped, transactional and recoverable by cursor", { timeout: 240_000 }, async t => {
  const harness = await startTestServer();
  try {
    await t.test("CRUD uses idempotency keys, disallows direct counts and emits tombstones", async () => {
      const owner = await actor(harness, "CRUD owner");
      const input = productInput("5.5");
      const created = await owner.request<Mutation>("/api/products", "POST", input);
      assert.equal(created.status, 201);
      assert.equal(created.data.product.currentQty, "5.500");
      assert.equal(created.data.product.unitPrice, "100000");
      const preflight = await fetch(harness.url + "/api/products", { method: "OPTIONS", headers: {
        origin: harness.url, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type,x-business-id",
      } });
      assert.equal(preflight.status, 204);
      assert(preflight.headers.get("access-control-allow-methods")?.includes("PATCH"));
      assert(preflight.headers.get("access-control-allow-methods")?.includes("DELETE"));
      const productId = created.data.product.id;
      const replay = await owner.request<Mutation>("/api/products", "POST", input);
      assert.equal(replay.status, 200);
      assert.equal(replay.data.product.id, productId);
      assert.equal(replay.data.product.currentQty, "5.500");
      assert.equal((await owner.request("/api/products", "POST", { ...input, name: "Different payload" })).status, 409);
      assert.equal((await owner.request(`/api/products/${productId}`, "PATCH", { clientId: randomUUID(), currentQty: "99" })).status, 400);
      const changed = await owner.request<Mutation>(`/api/products/${productId}`, "PATCH", { clientId: randomUUID(), name: "Market rice" });
      assert.equal(changed.status, 200);
      assert.equal(changed.data.product.name, "Market rice");
      assert.equal(changed.data.product.currentQty, "5.500");
      assert.equal((await owner.request(`/api/products/${productId}`, "DELETE", { clientId: randomUUID() })).status, 200);
      assert.equal((await owner.request(`/api/products/${productId}`)).status, 404);
      const changes = await owner.request<Changes>("/api/sync/changes?since=0&limit=100");
      assert.equal(changes.status, 200);
      assert(changes.data.changes.some(change => change.entity === "product" && change.entityId === productId && change.data.deletedAt));
    });

    await t.test("parallel fractional movements and duplicate replays do not lose or multiply stock", async () => {
      const owner = await actor(harness, "Concurrent movements");
      const created = await owner.request<Mutation>("/api/products", "POST", productInput());
      assert.equal(created.status, 201);
      const id = created.data.product.id;
      const results = await Promise.all(Array.from({ length: 20 }, () =>
        owner.request<Mutation>(`/api/products/${id}/restock`, "POST", { clientId: randomUUID(), quantity: "0.25" })));
      assert(results.every(result => result.status === 200));
      const single = { clientId: randomUUID(), quantity: "0.5" };
      const replays = await Promise.all(Array.from({ length: 10 }, () =>
        owner.request<Mutation>(`/api/products/${id}/restock`, "POST", single)));
      assert(replays.every(result => result.status === 200));
      const stored = await owner.request<Mutation>(`/api/products/${id}`);
      assert.equal(stored.data.product.currentQty, "10.500");
      assert.equal(await harness.db.stockMovement.count({ where: { businessId: owner.businessId, productId: id } }), 22);
      const actors = await harness.db.stockMovement.findMany({ where: { productId: id }, select: { createdById: true } });
      assert(actors.every(movement => movement.createdById === owner.userId));
    });

    await t.test("count corrections apply a delta and retain intervening stock changes", async () => {
      const owner = await actor(harness, "Count owner");
      const created = await owner.request<Mutation>("/api/products", "POST", productInput("10"));
      assert.equal(created.status, 201);
      const id = created.data.product.id;
      assert.equal((await owner.request(`/api/products/${id}/restock`, "POST", { clientId: randomUUID(), quantity: "3" })).status, 200);
      const counted = await owner.request<Mutation>(`/api/products/${id}/count`, "POST",
        { clientId: randomUUID(), countedQty: "8", observedQty: "10", reason: "Physical count" });
      assert.equal(counted.status, 200);
      assert.equal(counted.data.product.currentQty, "11.000");
      const movements = await harness.db.stockMovement.findMany({ where: { productId: id, type: "COUNT_CORRECTION" } });
      assert.equal(movements.length, 1);
      assert.equal(movements[0]!.quantity.toString(), "-2");
      assert.equal(movements[0]!.quantityBefore.toString(), "13");
      assert.equal(movements[0]!.quantityAfter.toString(), "11");
    });

    await t.test("guessing another business product or forging context cannot authorize writes", async () => {
      const a = await actor(harness, "Tenant A");
      const b = await actor(harness, "Tenant B");
      const created = await b.request<Mutation>("/api/products", "POST", productInput());
      assert.equal(created.status, 201);
      const id = created.data.product.id;
      assert.equal((await a.request(`/api/products/${id}`)).status, 404);
      assert.equal((await a.request(`/api/products/${id}/restock`, "POST", { clientId: randomUUID(), quantity: "1" })).status, 404);
      assert.equal((await a.request(`/api/products/${id}`, "GET", undefined, b.businessId)).status, 403);
      assert.equal((await a.request("/api/products", "POST", { ...productInput(), businessId: b.businessId })).status, 400);
      await harness.db.membership.update({ where: { userId_businessId: { userId: a.userId, businessId: a.businessId } }, data: { permissions: [] } });
      assert.equal((await a.request("/api/products")).status, 403);
      assert.equal((await a.request("/api/products", "POST", productInput())).status, 403);
    });

    await t.test("the pure stock service preserves a sale made after the observed count", async () => {
      const owner = await actor(harness, "Intervening sale");
      const created = await owner.request<Mutation>("/api/products", "POST", productInput("10"));
      assert.equal(created.status, 201);
      const id = created.data.product.id;
      // Exercise the quantity primitive directly; atomic sale posting is M5.
      await applyStockMovement(harness.db, { businessId: owner.businessId, userId: owner.userId }, {
        clientId: randomUUID(), productId: id, type: "SALE", quantity: new Prisma.Decimal(-3), source: "test",
      });
      const counted = await owner.request<Mutation>(`/api/products/${id}/count`, "POST",
        { clientId: randomUUID(), countedQty: "8", observedQty: "10" });
      assert.equal(counted.status, 200);
      assert.equal(counted.data.product.currentQty, "5.000");
    });

    await t.test("low-stock crossings create one unread notification per product", async () => {
      const owner = await actor(harness, "Low stock owner");
      const created = await owner.request<Mutation>("/api/products", "POST", productInput());
      assert.equal(created.status, 201);
      const id = created.data.product.id;
      const count = (countedQty: string, observedQty: string) => owner.request(`/api/products/${id}/count`, "POST",
        { clientId: randomUUID(), countedQty, observedQty });
      assert.equal((await count("2", "5")).status, 200);
      assert.equal((await owner.request(`/api/products/${id}/restock`, "POST", { clientId: randomUUID(), quantity: "10" })).status, 200);
      assert.equal((await count("1", "12")).status, 200);
      const notifications = await owner.request<{ notifications: { id: string; productId: string }[] }>("/api/notifications?unread=true");
      assert.equal(notifications.status, 200);
      assert.equal(notifications.data.notifications.filter(item => item.productId === id).length, 1);
      const notification = notifications.data.notifications.find(item => item.productId === id)!;
      assert.equal((await owner.request(`/api/notifications/${notification.id}/read`, "POST", {})).status, 200);
    });

    await t.test("cursor pages include interleaved writes and tombstones without gaps", async () => {
      const owner = await actor(harness, "Cursor owner");
      const created = await owner.request<Mutation>("/api/products", "POST", productInput());
      const removed = await owner.request<Mutation>("/api/products", "POST", productInput("1"));
      assert.equal(created.status, 201);
      assert.equal(removed.status, 201);
      assert.equal((await owner.request(`/api/products/${removed.data.product.id}`, "DELETE", { clientId: randomUUID() })).status, 200);
      let cursor = "0";
      const seen: Change[] = [];
      for (let page = 0; page < 30; page++) {
        const response = await owner.request<Changes>(`/api/sync/changes?since=${cursor}&limit=2`);
        assert.equal(response.status, 200);
        seen.push(...response.data.changes);
        if (page === 0) assert.equal((await owner.request(`/api/products/${created.data.product.id}/restock`, "POST",
          { clientId: randomUUID(), quantity: "1" })).status, 200);
        cursor = response.data.nextCursor;
        if (page > 0 && !response.data.hasMore) break;
      }
      assert.equal(seen.length, await harness.db.syncChange.count({ where: { businessId: owner.businessId } }));
      assert.equal(new Set(seen.map(change => change.seq)).size, seen.length);
      assert(seen.every((change, index) => index === 0 || BigInt(change.seq) > BigInt(seen[index - 1]!.seq)));
      assert(seen.some(change => change.entityId === removed.data.product.id && change.data.deletedAt));
      assert.equal(cursor, (await harness.db.business.findUniqueOrThrow({ where: { id: owner.businessId } })).syncSeq.toString());
    });
  } finally { await harness.stop(); }
});

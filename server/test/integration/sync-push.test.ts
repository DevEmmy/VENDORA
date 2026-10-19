import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { apiActor } from '../support/api';
import { startTestServer } from '../support/http';

test('M7 ordered sync batches report each result and replay committed sales once', { timeout: 180_000 }, async () => {
  const h = await startTestServer();
  try {
    const owner = await apiActor(h, 'Ordered push');
    const product = await owner.request<{ product: { id: string } }>('/api/products', 'POST', {
      clientId: randomUUID(), name: 'Rice', unit: 'bag', unitPrice: '100000', openingQty: '5',
    });
    const operations = Array.from({ length: 10 }, () => ({ action: 'sale.create', body: {
      clientId: randomUUID(), items: [{ productId: product.data.product.id, quantity: '1' }],
    } }));
    const first = await owner.request<{ results: { clientId: string; status: number; body: { code?: string } }[] }>('/api/sync/push', 'POST', { operations });
    assert.equal(first.status, 200);
    assert.deepEqual(first.data.results.map(result => result.status), [201, 201, 201, 201, 201, 409, 409, 409, 409, 409]);
    assert(first.data.results.slice(5).every(result => result.body.code === 'INSUFFICIENT_STOCK'));
    const replay = await owner.request<{ results: { status: number; body: { duplicate?: boolean } }[] }>('/api/sync/push', 'POST', { operations });
    assert(replay.data.results.slice(0, 5).every(result => result.status === 200 && result.body.duplicate));
    assert.equal(await h.db.sale.count({ where: { businessId: owner.businessId } }), 5);
    assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: product.data.product.id } })).stockQty.toString(), '0');
    const other = await apiActor(h, 'Foreign push');
    assert.equal((await other.request('/api/sync/push', 'POST', { operations }, owner.businessId)).status, 403);
  } finally { await h.stop(); }
});

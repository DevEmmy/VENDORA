import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { apiActor } from '../support/api';
import { startTestServer } from '../support/http';
import { backfillBusiness } from '../../src/services/inventory-backfill.service';

test('M7 browser legacy mappings cannot duplicate a product, sale or movement already backfilled', { timeout: 180_000 }, async () => {
  const h = await startTestServer();
  try {
    const owner = await apiActor(h, 'Legacy browser import', 'SNAPSHOT');
    await h.db.businessSnapshot.update({ where: { businessId: owner.businessId }, data: { state: {
      inventory: [{ id: 'p_old', name: 'Rice', unit: 'bag', price: 1000, qty: 4.5 }],
      sales: [{ id: 't_old', type: 'sale', items: [{ productId: 'p_old', qty: 0.5, price: 1000 }], amount: 500, paid: 500, at: 1000 }],
      txns: [{ id: 't_restock', type: 'restock', items: [{ productId: 'p_old', qty: 1, price: 1000 }], at: 2000 }],
    } } });
    assert.equal((await backfillBusiness(h.db, owner.businessId)).status, 'applied');
    const response = await owner.request<{ product: { id: string } }>('/api/products', 'POST', {
      clientId: randomUUID(), legacyId: 'p_old', name: 'Rice', unit: 'bag', unitPrice: '100000', openingQty: '4.5',
    });
    assert.equal(response.status, 200);
    const repeated = await owner.request('/api/sales', 'POST', { clientId: randomUUID(), legacyId: 't_old',
      items: [{ productId: response.data.product.id, quantity: '0.5', unitPrice: '100000' }], amountPaid: '50000', fromOffline: true });
    assert.equal(repeated.status, 200);
    assert.equal((await owner.request(`/api/products/${response.data.product.id}/restock`, 'POST', {
      clientId: randomUUID(), legacyId: 'restock:t_restock:0', quantity: '1',
    })).status, 200);
    assert.equal(await h.db.product.count({ where: { businessId: owner.businessId } }), 1);
    assert.equal(await h.db.sale.count({ where: { businessId: owner.businessId } }), 1);
    assert.equal((await h.db.product.findUniqueOrThrow({ where: { id: response.data.product.id } })).stockQty.toString(), '4.5');
    assert.equal((await owner.request('/api/sales', 'POST', { clientId: randomUUID(), legacyId: 't_old',
      items: [{ productId: response.data.product.id, quantity: '2' }], fromOffline: true })).status, 409);
  } finally { await h.stop(); }
});

import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { apiActor } from '../support/api';

test('M7 a fresh device restores sales history as well as inventory', async ({ page, harness }) => {
  const owner = await apiActor(harness, 'Fresh device history');
  const sku = await owner.request<{ product: { id: string } }>('/api/products', 'POST', {
    clientId: randomUUID(), name: 'Rice', unit: 'bag', unitPrice: '100000', openingQty: '5',
  });
  expect(sku.status).toBe(201);
  expect((await owner.request('/api/sales', 'POST', { clientId: randomUUID(), items: [{ productId: sku.data.product.id, quantity: '0.5' }] })).status).toBe(201);
  await page.goto('/__test/browser');
  const count = await page.evaluate(async account => {
    await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: account.phone, password: account.password }) });
    const storePath = '/__test/modules/lib/store.js';
    const syncPath = '/__test/modules/features/sync/accountSync.js';
    const store = await import(storePath) as { activateAccount(userId: string, businessId: string): Promise<unknown>;
      getState(): { txns: { type: string }[] } };
    const sync = await import(syncPath) as { startAccountSync(scope: { userId: string; businessId: string }): (() => void) & { sync(): Promise<void> } };
    await store.activateAccount(account.userId, account.businessId);
    const stop = sync.startAccountSync(account);
    await stop.sync();
    const result = store.getState().txns.filter(txn => txn.type === 'sale').length;
    stop(); return result;
  }, { userId: owner.userId, businessId: owner.businessId, phone: owner.phone, password: owner.password });
  expect(count, 'Server sales must be restored on an empty device').toBe(1);
});

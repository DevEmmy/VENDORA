import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { apiActor } from '../support/api';
import { startTestServer } from '../support/http';

test('M8 cookie-origin enforcement and password change preserve authoritative account attribution', { timeout: 180_000 }, async () => {
  const h = await startTestServer();
  try {
    const owner = await apiActor(h, 'Hardening');
    const request = (path: string, body: object, headers: Record<string, string> = {}) => fetch(h.url + path, {
      method: 'POST', headers: { cookie: owner.cookie, 'Content-Type': 'application/json', 'X-Business-ID': owner.businessId, ...headers },
      body: JSON.stringify(body),
    });
    const product = { clientId: randomUUID(), name: 'Rice', unit: 'bag', unitPrice: '100000', openingQty: '5', metadata: { recordedBy: 'Tunde' } };
    assert.equal((await request('/api/products', product)).status, 403);
    assert.equal((await request('/api/products', product, { origin: 'https://evil.test', 'sec-fetch-site': 'same-site' })).status, 403);
    const created = await request('/api/products', product, { 'sec-fetch-site': 'same-origin' });
    assert.equal(created.status, 201);
    const saved = await h.db.product.findFirstOrThrow({ where: { businessId: owner.businessId } });
    assert.equal(saved.createdById, owner.userId);
    const opening = await h.db.stockMovement.findFirstOrThrow({ where: { productId: saved.id } });
    assert.equal(opening.createdById, owner.userId);
    assert.equal((opening.metadata as { recordedBy?: string }).recordedBy, 'Tunde');
    const change = { currentPassword: owner.password, password: 'market river new 2026' };
    assert.equal((await request('/api/auth/password/change', change)).status, 403);
    assert.equal((await request('/api/auth/password/change', { ...change, password: 'password123' }, { origin: h.url })).status, 400);
    assert.equal((await request('/api/auth/password/change', change, { origin: h.url })).status, 204);
    assert.equal((await fetch(h.url + '/api/auth/me', { headers: { cookie: owner.cookie } })).status, 401);
    const login = (password: string) => fetch(h.url + '/api/auth/login', { method: 'POST', headers: { origin: h.url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: owner.phone, password }) });
    assert.equal((await login(owner.password)).status, 401);
    assert.equal((await login(change.password)).status, 200);
  } finally { await h.stop(); }
});

import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { apiActor } from '../support/api';
import { randomUUID } from 'node:crypto';

async function login(page: Page, owner: { phone: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('Phone number', { exact: true }).fill(owner.phone);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced', { timeout: 20_000 });
}
async function cashSale(page: Page, quantity = '0.5') {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByRole('button', { name: 'Add Rice', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Quantity of Rice' }).fill(quantity);
  await page.getByRole('button', { name: 'Charge', exact: true }).click();
  await page.getByRole('button', { name: /^Cash received/ }).click();
  await expect(page.getByRole('heading', { name: 'Sale recorded' })).toBeVisible();
  await page.getByRole('button', { name: 'Next sale', exact: true }).click();
}

test('a synced production account checks quietly and still receives another device’s stock changes', async ({ page, harness }) => {
  const owner = await apiActor(harness, 'Quiet background check');
  await login(page, owner);
  let release: () => void = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const changes = /\/api\/sync\/changes\?/;
  await page.route(changes, async route => { await waiting; await route.continue(); });
  try {
    // Let the actual polling timer request updates, keeping the response in
    // flight long enough to inspect the user-visible status.
    await page.waitForRequest(request => new URL(request.url()).pathname === '/api/sync/changes', { timeout: 12_000 });
    await expect(page.getByRole('region', { name: 'Sync status' }).getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
    expect((await owner.request('/api/products', 'POST', { clientId: randomUUID(), name: 'Beans', unit: 'bag', unitPrice: '100000', openingQty: '5' })).status).toBe(201);
    release();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'My stock', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Beans', exact: true })).toContainText('5 bags');
  } finally { release(); await page.unroute(changes); }
});

test('M7 production UI queues three offline sales and a fractional restock, then converges exactly', async ({ page, context, harness }) => {
  test.setTimeout(90_000);
  const owner = await apiActor(harness, 'Offline UI');
  const result = await owner.request<{ product: { id: string } }>('/api/products', 'POST', {
    clientId: randomUUID(), name: 'Rice', unit: 'bag', unitPrice: '100025', openingQty: '10', lowStockAt: '1',
  });
  expect(result.status).toBe(201);
  await login(page, owner);
  await context.setOffline(true);
  for (let index = 0; index < 3; index++) await cashSale(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'My stock', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Restock quantity for Rice' }).fill('1.25');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('4 pending');
  await expect(page.getByRole('button', { name: 'Edit Rice' })).toContainText('9.75 bags');
  await context.setOffline(false);
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced', { timeout: 25_000 });
  const product = await harness.db.product.findUniqueOrThrow({ where: { id: result.data.product.id } });
  expect(product.stockQty.toString()).toBe('9.75');
  const sales = await harness.db.sale.findMany({ where: { businessId: owner.businessId } });
  expect(sales.length).toBe(3);
  expect(sales.map(sale => sale.total.toString())).toEqual(['50013', '50013', '50013']);
  expect(await harness.db.stockMovement.count({ where: { productId: product.id, type: 'RESTOCK' } })).toBe(1);
  await expect(page.getByRole('button', { name: 'Edit Rice' })).toContainText('9.75 bags');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: /Sales today/ })).toContainText('₦1,500.39');
});

test('M7 two independent devices post concurrent sales without losing either sale', async ({ page, browser, harness }) => {
  test.setTimeout(90_000);
  const owner = await apiActor(harness, 'Two device UI');
  const result = await owner.request<{ product: { id: string } }>('/api/products', 'POST', {
    clientId: randomUUID(), name: 'Rice', unit: 'bag', unitPrice: '100000', openingQty: '5',
  });
  const secondContext = await browser.newContext({ baseURL: harness.url });
  try {
    const second = await secondContext.newPage();
    await Promise.all([login(page, owner), login(second, owner)]);
    await Promise.all([cashSale(page, '2'), cashSale(second, '2')]);
    await expect.poll(() => harness.db.sale.count({ where: { businessId: owner.businessId } })).toBe(2);
    expect((await harness.db.product.findUniqueOrThrow({ where: { id: result.data.product.id } })).stockQty.toString()).toBe('1');
    for (const device of [page, second]) {
      await device.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'My stock', exact: true }).click();
      await expect(device.getByRole('button', { name: 'Edit Rice' })).toContainText('1 bag', { timeout: 15_000 });
    }
  } finally { await secondContext.close(); }
});

test('M7 a fresh production browser restores both stock and visible sale history', async ({ page, harness }) => {
  const owner = await apiActor(harness, 'Production restore');
  const product = await owner.request<{ product: { id: string } }>('/api/products', 'POST', {
    clientId: randomUUID(), name: 'Rice', unit: 'bag', unitPrice: '100000', openingQty: '5',
  });
  expect((await owner.request('/api/sales', 'POST', { clientId: randomUUID(),
    items: [{ productId: product.data.product.id, quantity: '0.5' }] })).status).toBe(201);
  await login(page, owner);
  await expect(page.getByText('0.5 bags Rice', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'My stock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Rice' })).toContainText('4.5 bags');
});

test('M7 offline records survive tab closure and an expired session, then sync after re-login', async ({ page, context, harness }) => {
  test.setTimeout(90_000);
  const owner = await apiActor(harness, 'Expired offline UI');
  const result = await owner.request<{ product: { id: string } }>('/api/products', 'POST', {
    clientId: randomUUID(), name: 'Rice', unit: 'bag', unitPrice: '100000', openingQty: '5',
  });
  await login(page, owner);
  await context.setOffline(true);
  await cashSale(page);
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('1 pending');
  await harness.db.session.updateMany({ where: { userId: owner.userId }, data: { idleExpiresAt: new Date(Date.now() - 60_000) } });
  await page.close();
  await context.setOffline(false);
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByLabel('Phone number', { exact: true })).toBeVisible();
  await reopened.getByLabel('Phone number', { exact: true }).fill(owner.phone);
  await reopened.getByLabel('Password', { exact: true }).fill(owner.password);
  await reopened.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(reopened.getByRole('region', { name: 'Sync status' })).toContainText('Synced', { timeout: 25_000 });
  expect(await harness.db.sale.count({ where: { businessId: owner.businessId } })).toBe(1);
  expect((await harness.db.product.findUniqueOrThrow({ where: { id: result.data.product.id } })).stockQty.toString()).toBe('4.5');
});

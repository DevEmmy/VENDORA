import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { randomInt } from 'node:crypto';

test.use({ actionTimeout: 15_000 });

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
async function sell(page: Page, quantity: string) {
  await nav(page, 'Sell');
  await page.getByRole('button', { name: 'Add Rice', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Quantity of Rice' }).fill(quantity);
  await page.getByRole('button', { name: 'Charge', exact: true }).click();
  await page.getByRole('button', { name: /^Cash received/ }).click();
  await expect(page.getByRole('heading', { name: 'Sale recorded' })).toBeVisible();
  await page.getByRole('button', { name: 'Next sale', exact: true }).click();
}

test('M9 whole production story: signup, product, sale, alert, restock, restore, offline sale and reversal', async ({ page, browser, harness }) => {
  test.setTimeout(120_000);
  const phone = '23480' + randomInt(10_000_000, 99_999_999);
  const password = 'market river story 2026';
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a new account', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Story Trader');
  await page.getByLabel('Phone number', { exact: true }).fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Business name', { exact: true }).fill('Story shop');
  await page.getByLabel('Business type', { exact: true }).selectOption('Foodstuff');
  await page.getByLabel('City', { exact: true }).fill('Lagos');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced', { timeout: 25_000 });
  const business = await harness.db.business.findUniqueOrThrow({ where: { phone } });
  expect(business.inventoryMode).toBe('RELATIONAL');

  await nav(page, 'My stock');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add an item', exact: true });
  await form.getByLabel('Item name', { exact: true }).fill('Rice');
  await form.getByLabel(/You buy at/).fill('800');
  await form.getByLabel(/You sell at/).fill('1000');
  await form.getByRole('spinbutton', { name: 'Count in the shop', exact: true }).fill('3');
  await form.getByRole('spinbutton', { name: 'Low stock threshold', exact: true }).fill('2');
  await form.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced');
  const product = await harness.db.product.findFirstOrThrow({ where: { businessId: business.id } });

  await sell(page, '1');
  await expect.poll(() => harness.db.sale.count({ where: { businessId: business.id, reversedSaleId: null } })).toBe(1);
  const original = await harness.db.sale.findFirstOrThrow({ where: { businessId: business.id } });
  await nav(page, 'Home');
  await expect(page.getByRole('region', { name: 'Stock alerts' })).toContainText('Low stock', { timeout: 20_000 });
  await nav(page, 'My stock');
  await page.getByRole('spinbutton', { name: 'Restock quantity for Rice' }).fill('2.5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced');
  await expect(page.getByRole('button', { name: 'Edit Rice', exact: true })).toContainText('4.5 bags');

  const secondContext = await browser.newContext({ baseURL: harness.url });
  try {
    const second = await secondContext.newPage();
    await second.goto('/');
    await second.getByLabel('Phone number', { exact: true }).fill(phone);
    await second.getByLabel('Password', { exact: true }).fill(password);
    await second.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(second.getByRole('region', { name: 'Sync status' })).toContainText('Synced');
    await expect(second.getByText('1 bag Rice', { exact: true })).toBeVisible();
    await nav(second, 'My stock');
    await expect(second.getByRole('button', { name: 'Edit Rice', exact: true })).toContainText('4.5 bags');
    await secondContext.setOffline(true);
    await sell(second, '0.5');
    await expect(second.getByRole('region', { name: 'Sync status' })).toContainText('1 pending');
    await secondContext.setOffline(false);
    await expect(second.getByRole('region', { name: 'Sync status' })).toContainText('Synced', { timeout: 20_000 });
    expect((await harness.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty.toString()).toBe('4');

    await nav(page, 'Home');
    await page.getByText('1 bag Rice', { exact: true }).click();
    await page.getByRole('button', { name: 'This was a mistake', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel record', exact: true }).click();
    await expect.poll(async () => (await harness.db.sale.findUniqueOrThrow({ where: { id: original.id } })).status).toBe('REVERSED');
    expect(await harness.db.sale.count({ where: { businessId: business.id, reversedSaleId: { not: null } } })).toBe(1);
    expect((await harness.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty.toString()).toBe('5');
    await nav(second, 'My stock');
    await expect(second.getByRole('button', { name: 'Edit Rice', exact: true })).toContainText('5 bags', { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  } finally { await secondContext.close(); }
});

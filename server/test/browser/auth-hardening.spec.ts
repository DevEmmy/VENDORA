import { test, expect } from './fixtures';
import { apiActor } from '../support/api';
import { smokeCookies } from '../../scripts/cookie-smoke';

test('M8 cookie smoke verifies real browser session transport', async ({ harness }) => {
  const account = await harness.account('Cookie smoke');
  expect(await smokeCookies({ frontend: harness.url, phone: account.phone, password: account.password }))
    .toEqual({ login: 200, me: 200, cookies: 2 });
});

test('M8 password screens change credentials and explain verified recovery', async ({ page, harness }) => {
  const account = await apiActor(harness, 'Password screen');
  await page.goto('/');
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByText(/Recovery requires a previously verified recovery destination/)).toBeVisible();
  await page.getByLabel('Phone number', { exact: true }).fill(account.phone);
  await page.getByRole('button', { name: 'Request recovery', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('If this account has a verified recovery destination');
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.getByLabel('Phone number', { exact: true }).fill(account.phone);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: /Change password Signs out/ }).click();
  await page.getByLabel('Current password', { exact: true }).fill(account.password);
  await page.getByLabel('New password', { exact: true }).fill('market river changed 2026');
  await page.getByLabel('Confirm new password', { exact: true }).fill('market river changed 2026');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByLabel('Phone number', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Your offline records are saved');
  await page.getByLabel('Phone number', { exact: true }).fill(account.phone);
  await page.getByLabel('Password', { exact: true }).fill('market river changed 2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced');
});

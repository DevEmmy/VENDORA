import { test, expect } from './fixtures';
import { seedVoiceProducts } from '../../scripts/voice-seed';

test('voice review, explicit confirm, clarification, history and manual microphone fallback', async ({ page, harness }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 700 });
  const account = await harness.account('Voice browser owner');
  await harness.db.business.update({ where: { id: account.businessId }, data: { inventoryMode: 'RELATIONAL' } });
  await seedVoiceProducts(harness.db, { businessId: account.businessId, userId: account.userId });
  const rice = await harness.db.product.findFirstOrThrow({ where: { businessId: account.businessId, name: 'Rice' } });
  let external = 0, readbackRequests = 0;
  page.on('request', request => { if (/\/api\/voice\/commands\/[^/]+\/readback$/.test(request.url())) readbackRequests++; });
  await page.route(/yarngpt\.ai|api\.anthropic\.com|api\.openai\.com/, route => { external++; return route.abort(); });
  await page.addInitScript(() => {
    Reflect.set(window, '__voiceSpoken', []);
    if (window.speechSynthesis) Object.defineProperty(window.speechSynthesis, 'speak', { configurable: true, value: (utterance: SpeechSynthesisUtterance) => {
      (Reflect.get(window, '__voiceSpoken') as string[]).push(utterance.text);
    } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    } });
  });
  await page.goto('/');
  await page.getByLabel('Phone number', { exact: true }).fill(account.phone);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sync status' })).toContainText('Synced', { timeout: 25000 });
  await page.getByRole('button', { name: /Talk to Vendora/ }).first().click();
  await expect(page.getByText('Voice inventory', { exact: true })).toBeVisible();
  await page.getByLabel('Demo typed transcript').fill('How many bags of rice remain?');
  await page.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rice: 6' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Review inventory command' })).toBeHidden();
  await page.getByLabel('Demo typed transcript').fill('I sold 2 bags of rice');
  await page.getByRole('button', { name: 'Review transcript', exact: true }).click();
  const card = page.getByRole('region', { name: 'Review inventory command' });
  await expect(card).toContainText('Sold 2 bags of Rice. Is that correct?');
  await expect(card.getByRole('heading', { name: 'Review stock change' })).toBeInViewport();
  await expect(card).toBeFocused();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__voiceSpoken') as string[])).toContain('Sold 2 bags of Rice. Is that correct?');
  expect((await harness.db.product.findUniqueOrThrow({ where: { id: rice.id } })).stockQty.toString()).toBe('6');
  await card.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Done.' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Done.' })).toBeInViewport();
  await expect(page.getByRole('alert').filter({ hasText: 'Low stock' })).toBeVisible();
  expect((await harness.db.product.findUniqueOrThrow({ where: { id: rice.id } })).stockQty.toString()).toBe('4');
  expect(await harness.db.stockMovement.count({ where: { productId: rice.id, source: 'voice' } })).toBe(1);
  await page.getByLabel('Demo typed transcript').fill('I sold 2 bags beans');
  await page.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Confirm Brown beans', exact: true }).click();
  await expect(card).toBeHidden();
  await page.getByLabel('Demo typed transcript').fill('gibberish spaceship');
  await page.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'manual entry' })).toBeVisible();
  await page.getByText('Record and upload a short clip instead', { exact: true }).click();
  await page.getByRole('button', { name: 'Record inventory command', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /permission was denied|No microphone/ })).toBeVisible();
  await expect(page.getByText('Manual add / sell', { exact: true })).toBeVisible();
  // Exercise the native MediaRecorder/upload path using a synthetic microphone.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(); oscillator.connect(destination); oscillator.start();
      destination.stream.getTracks()[0]!.addEventListener('ended', () => { oscillator.stop(); void context.close(); });
      return destination.stream;
    };
  });
  await page.getByRole('button', { name: 'Record inventory command', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Recording 1/15' })).toBeVisible();
  const audioRequestPromise = page.waitForRequest(request => request.url().endsWith('/api/voice/commands') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const audioRequest = await audioRequestPromise;
  expect(audioRequest.postDataBuffer()?.includes(Buffer.from('audio/wav'))).toBe(true);
  expect(audioRequest.postDataBuffer()?.includes(Buffer.from('RIFF'))).toBe(true);
  await expect(card).toContainText('Sold 2 bags of Rice. Is that correct?');
  await expect(card.getByRole('heading', { name: 'Review stock change' })).toBeInViewport();
  await expect(card).toBeFocused();
  expect(readbackRequests).toBe(0); // Mock UI uses device speech instead of the silent fixture.
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card).toBeHidden();
  // Real AudioWorklet PCM capture and authenticated SSE, with mock upstream ASR.
  const live = page.getByRole('region', { name: 'Live voice inventory' });
  const pcmRequest = page.waitForRequest(request => /\/api\/voice\/streams\/[^/]+\/audio$/.test(request.url()));
  await live.getByRole('button', { name: 'Start live microphone', exact: true }).click();
  const pcm = await pcmRequest;
  expect(pcm.postDataJSON().pcm.length).toBeGreaterThan(100);
  await live.getByRole('button', { name: 'Stop listening', exact: true }).click();
  await expect(card).toContainText('Sold 2 bags of Rice. Is that correct?');
  expect((await harness.db.product.findUniqueOrThrow({ where: { id: rice.id } })).stockQty.toString()).toBe('4');
  await card.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(card).toBeHidden();
  expect((await harness.db.product.findUniqueOrThrow({ where: { id: rice.id } })).stockQty.toString()).toBe('2');
  await page.getByRole('button', { name: 'Voice history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Voice history', exact: true })).toBeVisible();
  await expect(page.getByText('confirmed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('failed', { exact: true })).toBeVisible();
  expect(external).toBe(0);
});

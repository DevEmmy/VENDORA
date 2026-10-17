import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

export async function smokeCookies(input: { frontend: string; api?: string; phone: string; password: string }) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(input.frontend);
    const api = input.api || input.frontend;
    const statuses = await page.evaluate(async ({ api, phone, password }) => {
      const login = await fetch(api + '/api/auth/login', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
      const me = await fetch(api + '/api/auth/me', { credentials: 'include', cache: 'no-store' });
      return { login: login.status, me: me.status, cache: me.headers.get('cache-control'), vary: me.headers.get('vary') };
    }, { api, phone: input.phone, password: input.password });
    assert.equal(statuses.login, 200, 'Login failed through the configured frontend');
    assert.equal(statuses.me, 200, 'Browser did not send a usable session cookie');
    assert.equal(statuses.cache, 'no-store');
    assert.match(statuses.vary || '', /cookie/i);
    const cookies = (await context.cookies(api)).filter(cookie => /vendora.*(?:access|refresh)$/.test(cookie.name));
    assert.equal(cookies.length, 2);
    for (const cookie of cookies) {
      assert(cookie.httpOnly && cookie.sameSite === 'Strict');
      if (api.startsWith('https:')) assert(cookie.secure);
    }
    await page.evaluate(async api => { await fetch(api + '/api/auth/logout', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: '{}' }); }, api);
    return { login: statuses.login, me: statuses.me, cookies: cookies.length };
  } finally { await browser.close(); }
}

if (require.main === module) {
  const { SMOKE_FRONTEND_ORIGIN, PUBLIC_API_ORIGIN, SMOKE_PHONE, SMOKE_PASSWORD } = process.env;
  if (!SMOKE_FRONTEND_ORIGIN || !SMOKE_PHONE || !SMOKE_PASSWORD) {
    console.error('Set SMOKE_FRONTEND_ORIGIN, SMOKE_PHONE and SMOKE_PASSWORD for a disposable test account.');
    process.exitCode = 1;
  } else void smokeCookies({ frontend: SMOKE_FRONTEND_ORIGIN, ...(PUBLIC_API_ORIGIN ? { api: PUBLIC_API_ORIGIN } : {}), phone: SMOKE_PHONE, password: SMOKE_PASSWORD })
    .then(result => console.log('PASS browser cookie topology', result))
    .catch(() => { console.error('Cookie smoke failed. Check same-site topology, proxy routes, CORS and test-account credentials.'); process.exitCode = 1; });
}

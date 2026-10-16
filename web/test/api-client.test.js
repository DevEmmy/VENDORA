import assert from 'node:assert/strict';
import test from 'node:test';

test('auth and inventory callers share one refresh after concurrent 401 responses', async () => {
  const previousFetch = globalThis.fetch;
  let refreshed = false;
  let refreshes = 0;
  globalThis.fetch = async path => {
    if (path === '/api/auth/refresh') {
      refreshes++;
      await new Promise(done => setTimeout(done, 10));
      refreshed = true;
      return new Response(null, { status: 204 });
    }
    return Response.json(refreshed ? { inventory: [] } : { error: 'Authentication required' },
      { status: refreshed ? 200 : 401 });
  };
  try {
    const { api, apiRequest } = await import('../src/lib/api/client.js?single-flight');
    await Promise.all([api.request('/api/inventory'), apiRequest('/api/inventory')]);
    assert.equal(refreshes, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test('two isolated tab modules coordinate with Web Locks and recheck cookies before rotating', async () => {
  const fetchBefore = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let queue = Promise.resolve();
  let authorized = false;
  let refreshes = 0;
  const names = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (name, callback) => {
      names.push(name);
      const result = queue.then(callback);
      queue = result.catch(() => {});
      return result;
    },
  } } });
  globalThis.fetch = async path => {
    if (path === '/api/auth/refresh') {
      refreshes++;
      await new Promise(done => setTimeout(done, 5));
      authorized = true;
      return new Response(null, { status: 204 });
    }
    return Response.json({}, { status: authorized ? 200 : 401 });
  };
  try {
    const first = await import('../src/lib/api/client.js?locked-a');
    const second = await import('../src/lib/api/client.js?locked-b');
    await Promise.all([first.api.request('/api/inventory'), second.api.request('/api/inventory')]);
    assert.equal(refreshes, 1);
    assert.deepEqual(names, ['vendora-refresh', 'vendora-refresh']);
  } finally {
    globalThis.fetch = fetchBefore;
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('fallback lease coordinates tabs without Web Locks and stores no credentials', async () => {
  const fetchBefore = globalThis.fetch;
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const storageBefore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  } });
  let authorized = false;
  let refreshes = 0;
  globalThis.fetch = async path => {
    if (path === '/api/auth/refresh') {
      refreshes++;
      await new Promise(done => setTimeout(done, 10));
      authorized = true;
      return new Response(null, { status: 204 });
    }
    return Response.json({}, { status: authorized ? 200 : 401 });
  };
  try {
    const first = await import('../src/lib/api/client.js?fallback-a');
    const second = await import('../src/lib/api/client.js?fallback-b');
    await Promise.all([first.api.request('/api/inventory'), second.api.request('/api/inventory')]);
    assert.equal(refreshes, 1);
    assert.equal(values.size, 0);
  } finally {
    globalThis.fetch = fetchBefore;
    for (const [key, descriptor] of [['navigator', navigatorBefore], ['localStorage', storageBefore]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('a request retries at most once, then notifies expiration without deleting local data', async () => {
  const previousFetch = globalThis.fetch;
  let privateCalls = 0;
  let refreshes = 0;
  let expirations = 0;
  globalThis.fetch = async path => {
    if (path === '/api/auth/refresh') { refreshes++; return new Response(null, { status: 204 }); }
    if (path === '/api/inventory') privateCalls++;
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  };
  try {
    const client = await import('../src/lib/api/client.js?retry-limit');
    const unsubscribe = client.onSessionExpired(() => { expirations++; });
    await assert.rejects(client.api.request('/api/inventory'), { status: 401 });
    unsubscribe();
    assert.equal(privateCalls, 2);
    assert.equal(refreshes, 1);
    assert.equal(expirations, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test('network failures and invalid login never mark an authenticated session expired', async () => {
  const previousFetch = globalThis.fetch;
  let expirations = 0;
  try {
    const client = await import('../src/lib/api/client.js?public-errors');
    const unsubscribe = client.onSessionExpired(() => { expirations++; });
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(client.api.request('/api/inventory'), { status: 0 });
    globalThis.fetch = async () => Response.json({ error: 'Invalid credentials' }, { status: 401 });
    await assert.rejects(client.api.request('/api/auth/login', { auth: false, method: 'POST', body: {} }), { status: 401 });
    assert.equal(expirations, 0);
    unsubscribe();
  } finally { globalThis.fetch = previousFetch; }
});

test('retry preserves the original business when account selection changes during refresh', async () => {
  const previousFetch = globalThis.fetch;
  let selected = 'business-a';
  let authorized = false;
  const sent = [];
  globalThis.fetch = async (path, options) => {
    if (path === '/api/auth/refresh') {
      selected = 'business-b'; authorized = true;
      return new Response(null, { status: 204 });
    }
    if (path === '/api/inventory') sent.push(options.headers['X-Business-ID']);
    return Response.json({}, { status: authorized ? 200 : 401 });
  };
  try {
    const client = await import('../src/lib/api/client.js?business-binding');
    client.setBusinessContextResolver(() => selected);
    await client.api.request('/api/inventory');
    assert.deepEqual(sent, ['business-a', 'business-a']);
  } finally { globalThis.fetch = previousFetch; }
});

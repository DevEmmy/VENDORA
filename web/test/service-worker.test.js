import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function worker(headers = {}) {
  const handlers = {};
  const stores = new Map();
  const puts = [];
  const requests = [];
  const deleted = [];
  const origin = 'https://vendora.example';
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      match: async request => entries.get(new URL(typeof request === 'string' ? request : request.url, origin).href)?.clone(),
      put: async (request, response) => {
        const url = new URL(typeof request === 'string' ? request : request.url, origin).href;
        puts.push({ name, url });
        entries.set(url, response.clone());
      },
      addAll: async () => {},
    };
  };
  const caches = {
    open: async name => cache(name),
    keys: async () => [...stores.keys()],
    delete: async name => { deleted.push(name); return stores.delete(name); },
    match: async request => {
      for (const name of stores.keys()) {
        const hit = await cache(name).match(request);
        if (hit) return hit;
      }
    },
  };
  const context = {
    URL, Request, Response, Promise,
    location: { origin },
    self: {
      location: new URL('/sw.js', origin),
      registration: { scope: origin + '/' },
      addEventListener: (name, callback) => { handlers[name] = callback; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches,
    fetch: async (input, options) => {
      const request = new Request(typeof input === 'string' ? new URL(input, origin) : input, options);
      requests.push(request);
      return new Response('public asset', { headers });
    },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  return {
    stores, puts, requests, deleted, cache,
    async dispatch(name, extra = {}) {
      assert.equal(typeof handlers[name], 'function', `Missing worker ${name} handler`);
      const pending = [];
      let response;
      handlers[name]({ ...extra, waitUntil: promise => pending.push(promise),
        respondWith: promise => { response = promise; } });
      if (response) await response;
      await Promise.all(pending);
      await Promise.resolve();
    },
    async request(path, options = {}) {
      await this.dispatch('fetch', { request: new Request(new URL(path, origin), options) });
    },
  };
}

test('service worker never caches private API responses', async () => {
  const sw = worker();
  for (const path of ['/api/auth/me', '/api/inventory', '/api/sales', '/wema/accounts/123'])
    await sw.request(path, { credentials: 'include' });
  assert.deepEqual(sw.puts, []);
});

for (const headers of [{ 'Cache-Control': 'no-store' }, { 'Cache-Control': 'private, max-age=60' },
  { 'Set-Cookie': 'session=private' }, { Vary: 'Cookie' }]) {
  test(`service worker refuses unsafe response headers: ${JSON.stringify(headers)}`, async () => {
    const sw = worker(headers);
    await sw.request('/assets/index-abcdefgh.js', { credentials: 'omit' });
    assert.deepEqual(sw.puts, []);
  });
}

test('service worker only fetches public static assets without credentials', async () => {
  const sw = worker();
  await sw.request('/assets/index-abcdefgh.js', { credentials: 'include' });
  assert.equal(sw.requests[0]?.credentials, 'omit');
  assert.equal(sw.puts.length, 1);
  await sw.request('/unversioned-private-report.json');
  assert.equal(sw.puts.length, 1);
});

test('service worker ignores mutations', async () => {
  const sw = worker();
  await sw.request('/api/auth/logout', { method: 'POST' });
  assert.deepEqual(sw.puts, []);
  assert.deepEqual(sw.requests, []);
});

test('service worker upgrade deletes every old cache including leaked private entries', async () => {
  const sw = worker();
  await sw.cache('vendora-v1').put('/api/auth/me', new Response('account A'));
  await sw.cache('another-old-cache').put('/api/inventory', new Response('private inventory'));
  await sw.dispatch('activate');
  assert(sw.deleted.includes('vendora-v1'));
  assert(sw.deleted.includes('another-old-cache'));
});

test('service worker accepts a cache purge message on account changes', async () => {
  const sw = worker();
  await sw.cache('vendora-v1').put('/api/auth/me', new Response('account A'));
  await sw.dispatch('message', { data: { type: 'CLEAR_CACHES' } });
  assert.equal(sw.stores.size, 0);
});

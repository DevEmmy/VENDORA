import assert from 'node:assert/strict';
import test from 'node:test';
import { appendOperation, emptyReplica, createSyncEngine } from '../src/features/sync/outbox.js';

class MemoryRepository {
  data = new Map(); tail = Promise.resolve();
  async read(scope) { await this.tail; return structuredClone(this.data.get(scope) || emptyReplica()); }
  update(scope, change) {
    const result = this.tail.then(() => { const state = structuredClone(this.data.get(scope) || emptyReplica());
      change(state); this.data.set(scope, state); return structuredClone(state); });
    this.tail = result.catch(() => {}); return result;
  }
}
const op = (id, body = {}) => ({ id, action: 'sale.create', payload: body,
  request: { method: 'POST', path: '/api/sales', body: { ...body, clientId: id } } });
const pull = { changes: [], nextCursor: '0', hasMore: false };

test('outbox serializes concurrent writes, isolates scopes, and pushes in durable order', async () => {
  const repository = new MemoryRepository();
  await Promise.all(Array.from({ length: 5 }, (_, index) => appendOperation(repository, 'u:b', op(String(index)))));
  await appendOperation(repository, 'other:b', op('private'));
  const sent = [];
  const engine = createSyncEngine({ repository, scope: 'u:b', request: async (path, options) => {
    if (path.startsWith('/api/sync/changes')) return pull;
    sent.push(options.body.clientId); return { sale: { id: options.body.clientId, syncSeq: '0' } };
  } });
  await Promise.all([engine.sync(), engine.sync()]);
  assert.deepEqual(sent, ['0', '1', '2', '3', '4']);
  assert.equal((await repository.read('u:b')).outbox.length, 0);
  assert.equal((await repository.read('other:b')).outbox.length, 1);
});

test('an uncertain response retries the same payload with backoff and duplicate success is acknowledged', async () => {
  const repository = new MemoryRepository();
  await appendOperation(repository, 'u:b', op('physical-sale', { fromOffline: true }));
  let clock = 1000, failures = 1;
  const sent = [];
  const engine = createSyncEngine({ repository, scope: 'u:b', now: () => clock, request: async (path, options) => {
    if (path.startsWith('/api/sync/changes')) return pull;
    sent.push(structuredClone(options.body));
    if (failures--) throw Object.assign(new Error('Lost response'), { status: 0 });
    return { sale: { id: 'server-sale', syncSeq: '0' }, duplicate: true };
  } });
  await engine.sync();
  const pending = (await repository.read('u:b')).outbox[0];
  assert.equal(pending.status, 'pending');
  assert(pending.nextAttemptAt > clock);
  await engine.sync(); assert.equal(sent.length, 1);
  clock = pending.nextAttemptAt;
  await engine.sync();
  assert.deepEqual(sent[0], sent[1]);
  assert.equal((await repository.read('u:b')).outbox.length, 0);
});

test('session expiry keeps the outbox and a known rejection remains visible without blocking unrelated writes', async () => {
  const repository = new MemoryRepository();
  await appendOperation(repository, 'u:b', op('rejected'));
  await appendOperation(repository, 'u:b', op('accepted'));
  let expired = true;
  const engine = createSyncEngine({ repository, scope: 'u:b', request: async (path, options) => {
    if (expired) throw Object.assign(new Error('Sign in again'), { status: 401 });
    if (path.startsWith('/api/sync/changes')) return pull;
    if (options.body.clientId === 'rejected') throw Object.assign(new Error('Insufficient stock'),
      { status: 409, code: 'INSUFFICIENT_STOCK', details: { availableQuantity: '0.000' } });
    return { sale: { id: 'server-sale', syncSeq: '0' } };
  } });
  await engine.sync();
  assert.equal((await repository.read('u:b')).outbox.length, 2);
  assert.equal((await repository.read('u:b')).phase, 'expired');
  expired = false; await engine.sync();
  const state = await repository.read('u:b');
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].status, 'rejected');
  assert.equal(state.outbox[0].error.code, 'INSUFFICIENT_STOCK');
});

test('cursor/cache pages commit together and old idempotency responses never replace newer canonical values', async () => {
  const repository = new MemoryRepository();
  let page = 0;
  const engine = createSyncEngine({ repository, scope: 'u:b', request: async () => {
    page++;
    if (page === 1) return { changes: [{ entity: 'product', data: { id: 'p', syncSeq: '1', currentQty: '5.000' } }], nextCursor: '1', hasMore: true };
    return { changes: [{ entity: 'product', data: { id: 'p', syncSeq: '3', currentQty: '4.000' } }], nextCursor: '3', hasMore: false };
  } });
  await engine.sync();
  const state = await repository.read('u:b');
  assert.equal(state.cursor, '3');
  assert.equal(state.canonical.products.p.currentQty, '4.000');
});

test('ordered batches acknowledge duplicates and show individual rejections', async () => {
  const repository = new MemoryRepository();
  for (const id of ['one', 'two', 'three']) await appendOperation(repository, 'u:b', op(id));
  const batches = [];
  const engine = createSyncEngine({ repository, scope: 'u:b',
    request: async path => { assert(path.startsWith('/api/sync/changes')); return pull; },
    requestBatch: async operations => {
      batches.push(operations.map(item => item.id));
      assert(operations.every(item => item.wire.body.clientId === item.id));
      return { results: operations.map(item => ({ clientId: item.id,
        status: item.id === 'two' ? 409 : 200, body: item.id === 'two'
          ? { error: 'Insufficient stock', code: 'INSUFFICIENT_STOCK' }
          : { duplicate: true, sale: { id: item.id, syncSeq: '0' } } })) };
    },
  });
  await engine.sync();
  assert.deepEqual(batches, [['one', 'two', 'three']]);
  const state = await repository.read('u:b');
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].id, 'two');
  assert.equal(state.outbox[0].status, 'rejected');
});

test('a synced account checks quietly once and still restores another device’s changes', async () => {
  const repository = new MemoryRepository();
  await repository.update('u:b', state => { state.phase = 'synced'; state.lastSyncAt = 100; });
  const phases = [], requests = [];
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  const engine = createSyncEngine({ repository, scope: 'u:b', onChange: state => phases.push(state.phase),
    request: async path => {
      requests.push(path); started(); await waiting;
      return { changes: [{ entity: 'product', data: { id: 'rice', syncSeq: '1', currentQty: '4.500' } }], nextCursor: '1', hasMore: false };
    },
  });
  const syncing = engine.sync();
  await requested;
  try { assert(!phases.includes('syncing'), 'A background check must keep the previously synced status.'); }
  finally { release(); await syncing; }
  assert.equal(requests.length, 1, 'An idle check must not pull the same cursor twice.');
  const state = await repository.read('u:b');
  assert.equal(state.canonical.products.rice.currentQty, '4.500');
  assert.equal(state.phase, 'synced');
});

test('polling during upload backoff keeps pending status and does not retry early', async () => {
  const repository = new MemoryRepository();
  await appendOperation(repository, 'u:b', op('waiting-sale'));
  await repository.update('u:b', state => {
    state.phase = 'pending'; state.lastSyncAt = 100; state.outbox[0].nextAttemptAt = 5000;
  });
  const phases = [], requests = [];
  const engine = createSyncEngine({ repository, scope: 'u:b', now: () => 1000,
    onChange: state => phases.push(state.phase), request: async path => { requests.push(path); return pull; },
  });
  await engine.sync();
  assert(!phases.includes('syncing'), 'A deferred upload is pending, not actively syncing.');
  assert.equal(requests.length, 1);
  assert(requests[0].startsWith('/api/sync/changes'));
  assert.equal((await repository.read('u:b')).outbox[0].attempts, 0);
});

test('first restore and actual uploads still announce active sync', async () => {
  const repository = new MemoryRepository();
  const phases = [], requests = [];
  const engine = createSyncEngine({ repository, scope: 'u:b', onChange: state => phases.push(state.phase),
    request: async (path, options) => {
      requests.push(path);
      return path.startsWith('/api/sync/changes') ? pull : { sale: { id: options.body.clientId, syncSeq: '0' } };
    },
  });
  await engine.sync();
  assert(phases.includes('syncing'));
  phases.length = 0; requests.length = 0;
  await appendOperation(repository, 'u:b', op('new-sale'));
  await engine.sync();
  assert(phases.includes('syncing'));
  assert.equal(requests.filter(path => path === '/api/sales').length, 1);
  assert.equal(requests.filter(path => path.startsWith('/api/sync/changes')).length, 2);
  assert.equal((await repository.read('u:b')).outbox.length, 0);
});

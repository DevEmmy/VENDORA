export const emptyReplica = () => ({ version: 1, cursor: '0', nextSequence: 0,
  canonical: { products: {}, sales: {}, movements: {} }, mappings: { products: {}, sales: {}, customers: {} },
  outbox: [], domain: null, legacyImported: false, phase: 'pending', lastError: null, lastSyncAt: null });

export function queueOperation(state, operation) {
  const previous = state.outbox.find(item => item.id === operation.id);
  if (previous) return previous;
  const queued = { ...structuredClone(operation), sequence: ++state.nextSequence,
    status: 'pending', attempts: 0, nextAttemptAt: 0, wire: null, error: null };
  state.outbox.push(queued);
  return queued;
}
export const appendOperation = (repository, scope, operation) => repository.update(scope, state => { queueOperation(state, operation); });

function responseHead(value) {
  if (!value || typeof value !== 'object') return 0n;
  let head = typeof value.syncSeq === 'string' && /^\d+$/.test(value.syncSeq) ? BigInt(value.syncSeq) : 0n;
  for (const key of ['product', 'products', 'sale', 'sales', 'movement', 'movements', 'reversal']) {
    const item = value[key];
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item)) {
      for (const entity of item) { const candidate = responseHead(entity); if (candidate > head) head = candidate; }
      continue;
    }
    const candidate = responseHead(item); if (candidate > head) head = candidate;
  }
  return head;
}
export function mergeChange(state, change) {
  const collection = { product: 'products', sale: 'sales', movement: 'movements' }[change.entity];
  const value = change.data;
  if (!collection || !value?.id || !/^\d+$/.test(value.syncSeq)) throw new Error('Invalid sync change received.');
  const previous = state.canonical[collection][value.id];
  if (!previous || BigInt(value.syncSeq) >= BigInt(previous.syncSeq)) state.canonical[collection][value.id] = value;
  const localId = value.legacyId || value.clientId || value.id;
  if (collection !== 'movements') state.mappings[collection][localId] = value.id;
  if (collection === 'sales' && value.customer) {
    const customer = value.customer;
    state.mappings.customers[customer.legacyId || customer.clientId || customer.id] = customer.id;
  }
}
const failure = error => ({ message: error.message || 'Unable to synchronize records.',
  status: error.status || 0, code: error.code || null, details: error.details || null });

/** Storage and transport are injected so ordering, retries and expiry are testable. */
export function createSyncEngine({ repository, scope, request, requestBatch, businessId, now = Date.now,
  isOnline = () => globalThis.navigator?.onLine !== false,
  prepare = (_state, operation) => operation.request, accept = () => {}, project = () => {},
  bootstrap = () => {}, ensureReady, onChange = () => {} }) {
  let running = null, stopped = false;
  const controller = new AbortController();
  const options = { businessId, signal: controller.signal };
  const announce = state => { if (!stopped) onChange(state); };
  const update = async fn => { const state = await repository.update(scope, fn); announce(state); return state; };
  const pull = async () => {
    let more = true;
    while (more && !stopped) {
      const before = await repository.read(scope);
      let page;
      try { page = await request(`/api/sync/changes?since=${before.cursor}&limit=500`, options); }
      catch (error) {
        if (error.code !== 'INVENTORY_MIGRATION_REQUIRED' || !ensureReady) throw error;
        await ensureReady();
        page = await request(`/api/sync/changes?since=${before.cursor}&limit=500`, options);
      }
      if (!page || !Array.isArray(page.changes) || !/^\d+$/.test(page.nextCursor)) throw new Error('Invalid sync page received.');
      // Cursor and immutable canonical values commit together. Keep the last
      // complete projection until every page is present, including after crash.
      await repository.update(scope, state => {
        for (const change of page.changes) mergeChange(state, change);
        if (BigInt(page.nextCursor) > BigInt(state.cursor)) state.cursor = page.nextCursor;
      });
      more = page.hasMore === true;
      if (more && BigInt(page.nextCursor) <= BigInt(before.cursor)) throw new Error('Sync cursor did not advance.');
    }
    await update(state => {
      state.outbox = state.outbox.filter(operation => operation.status !== 'applied' || BigInt(operation.ackHead) > BigInt(state.cursor));
      bootstrap(state);
      project(state);
    });
  };
  const run = async () => {
    if (stopped) return;
    if (!isOnline()) { await update(state => { state.phase = 'offline'; }); return; }
    await update(state => { state.phase = 'syncing'; });
    try {
      await pull();
      for (let count = 0; count < 100 && !stopped; count++) {
        const state = await repository.read(scope);
        const operation = state.outbox.filter(item => item.status === 'pending').sort((a, b) => a.sequence - b.sequence)[0];
        if (!operation || operation.nextAttemptAt > now()) break;
        try {
          const ids = [];
          const prepared = await repository.update(scope, current => {
            const pending = current.outbox.filter(item => item.status === 'pending').sort((a, b) => a.sequence - b.sequence);
            let itemCount = 0;
            // Persist the exact wire request before I/O. A lost response must
            // retry the same clientId, offline policy and captured prices.
            for (const item of pending) {
              if (ids.length >= (requestBatch ? 25 : 1) || item.nextAttemptAt > now()) break;
              let wire;
              try { wire = item.wire || prepare(current, item); }
              catch (error) { if (ids.length) break; throw error; }
              const size = wire.body?.items?.length || 0;
              if (ids.length && itemCount + size > 1000) break;
              item.wire = wire; item.attempts++; ids.push(item.id); itemCount += size;
            }
          });
          const group = ids.map(id => prepared.outbox.find(value => value.id === id));
          if (!group.length) continue;
          let results;
          if (group.length > 1 && requestBatch) {
            const response = await requestBatch(group, options);
            results = response?.results;
            if (!Array.isArray(results) || results.length !== group.length || new Set(results.map(result => result.clientId)).size !== group.length ||
              results.some(result => !ids.includes(result.clientId) || !Number.isInteger(result.status) || result.status < 200 || result.status > 599))
              throw new Error('Invalid batch acknowledgment received. Records remain queued.');
          } else {
            const item = group[0];
            const body = await request(item.wire.path, { ...options, method: item.wire.method, body: item.wire.body });
            results = [{ clientId: item.id, status: 200, body }];
          }
          let retryLater = false, expired = false;
          await update(current => {
            for (const result of results) {
              const queued = current.outbox.find(value => value.id === result.clientId);
              if (!queued || queued.status !== 'pending') continue;
              if (result.status < 300) {
                queued.status = 'applied'; queued.ackHead = responseHead(result.body).toString(); queued.error = null;
                accept(current, queued, result.body);
              } else {
                queued.error = failure({ ...result.body, status: result.status, message: result.body?.error });
                if (result.status === 401) { expired = true; continue; }
                if (result.status === 408 || result.status === 429 || result.status >= 500) {
                  queued.nextAttemptAt = now() + Math.min(300_000, 1000 * 2 ** Math.min(queued.attempts, 8));
                  current.lastError = queued.error; retryLater = true;
                } else queued.status = 'rejected';
              }
            }
            project(current);
          });
          if (expired) throw Object.assign(new Error('Sign in again. Your records remain saved.'), { status: 401 });
          if (retryLater) break;
        } catch (error) {
          if (stopped || error.name === 'AbortError') return;
          if (error.status === 401) throw error;
          const transient = !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
          await update(current => {
            const item = current.outbox.find(value => value.id === operation.id);
            if (!item) return;
            item.error = failure(error);
            if (transient) {
              item.nextAttemptAt = now() + Math.min(300_000, 1000 * 2 ** Math.min(item.attempts, 8));
              current.lastError = item.error;
            } else { item.status = 'rejected'; project(current); }
          });
          if (transient) break;
        }
      }
      if (stopped) return;
      await pull();
      await update(state => {
        state.lastSyncAt = now();
        const pending = state.outbox.some(item => item.status === 'pending' || item.status === 'applied');
        state.phase = state.outbox.some(item => item.status === 'rejected') || state.migrationWarning ? 'needs-attention' : pending ? 'pending' : 'synced';
        if (!pending) state.lastError = null;
        project(state);
      });
    } catch (error) {
      if (stopped || error.name === 'AbortError') return;
      await update(state => { state.phase = error.status === 401 ? 'expired' :
        error.status >= 400 && error.status < 500 ? 'needs-attention' : isOnline() ? 'pending' : 'offline'; state.lastError = failure(error); });
    }
  };
  return {
    sync() {
      if (!running) {
        const invoke = () => run();
        running = (globalThis.navigator?.locks?.request ? navigator.locks.request(`vendora-sync:${scope}`, { ifAvailable: true }, lock => lock ? invoke() : undefined) : invoke())
          .finally(() => { running = null; });
      }
      return running;
    },
    stop() { stopped = true; controller.abort(); },
    async retry(id) { await update(state => { const item = state.outbox.find(value => value.id === id);
      if (item?.status === 'pending') item.nextAttemptAt = 0; }); return this.sync(); },
  };
}

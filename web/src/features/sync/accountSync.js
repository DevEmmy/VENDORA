import { apiRequest } from '../../lib/api/client.js';
import { getActiveReplicaScope, publishReplica, reportSyncFailure } from '../../lib/store.js';
import { createSyncEngine, mergeChange } from './outbox.js';
import { replicaRepository, replicaScope } from './replicaRepository.js';
import { prepareOperation, acceptOperation, projectReplica } from './domain.js';
import { bootstrapLegacy } from './bootstrap.js';

let activeSync = null;
export const getActiveSync = () => activeSync;

export function startAccountSync({ userId, businessId }) {
  const scope = replicaScope(userId, businessId);
  let stopped = false;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vendora-outbox') : null;
  const engine = createSyncEngine({ repository: replicaRepository, scope, businessId, request: apiRequest,
    requestBatch: (operations, options) => apiRequest('/api/sync/push', { ...options, method: 'POST', body: {
      operations: operations.map(operation => ({ action: operation.action, body: operation.wire.body,
        ...(!['product.create', 'sale.create'].includes(operation.action) ? { entityId: operation.wire.path.split('/')[3] } : {}) })),
    } }),
    prepare: prepareOperation, accept: acceptOperation, project: projectReplica, bootstrap: bootstrapLegacy,
    ensureReady: async () => {
      try { await apiRequest('/api/inventory/migrate', { method: 'POST', businessId, body: { dryRun: false } }); }
      catch (error) { throw Object.assign(new Error('This business needs migration review. Your local records remain saved.'),
        { status: error.status || 409, code: 'MIGRATION_REVIEW_REQUIRED', details: error.details }); }
    },
    onChange: state => { if (!stopped && getActiveReplicaScope() === scope) publishReplica(scope, state); },
  });
  const refresh = async () => {
    if (stopped || getActiveReplicaScope() !== scope) return;
    try {
      publishReplica(scope, await replicaRepository.read(scope));
      await engine.sync();
    } catch (error) { if (!stopped) reportSyncFailure(scope, error); }
  };
  const changed = event => {
    if (event.detail?.scope !== scope) return;
    channel?.postMessage({ scope }); void refresh();
  };
  const peerChanged = event => { if (event.data?.scope === scope) void refresh(); };
  const wake = () => { void refresh(); };
  const resumeOnline = async () => {
    try {
      await replicaRepository.update(scope, state => { for (const operation of state.outbox) if (operation.status === 'pending') operation.nextAttemptAt = 0; });
      await refresh();
    } catch (error) { if (!stopped) reportSyncFailure(scope, error); }
  };
  const timer = setInterval(wake, 5000);
  window.addEventListener('vendora-outbox', changed);
  window.addEventListener('online', resumeOnline);
  window.addEventListener('offline', wake);
  window.addEventListener('focus', wake);
  channel?.addEventListener('message', peerChanged);
  activeSync = { scope, async sync() {
    await replicaRepository.update(scope, state => { for (const operation of state.outbox) if (operation.status === 'pending') operation.nextAttemptAt = 0; });
    return engine.sync();
  }, retry: id => engine.retry(id),
    async acceptVoiceResult(result) {
      const state = await replicaRepository.update(scope, replica => {
        for (const product of result.products || []) mergeChange(replica, { entity: 'product', data: product });
        for (const movement of result.movements || []) mergeChange(replica, { entity: 'movement', data: movement });
        projectReplica(replica);
      });
      if (!stopped && getActiveReplicaScope() === scope) publishReplica(scope, state);
      channel?.postMessage({ scope });
      void refresh();
    },
    async acknowledgeMigrationWarning() {
      const state = await replicaRepository.update(scope, replica => { replica.migrationWarning = null; });
      publishReplica(scope, state); await engine.sync();
    },
    async discardRejected(id) {
      const state = await replicaRepository.update(scope, replica => {
        const operation = replica.outbox.find(value => value.id === id);
        if (operation?.status !== 'rejected') throw new Error('Only a confirmed rejection can be dismissed.');
        replica.outbox = replica.outbox.filter(value => value.id !== id);
        replica.rejections ||= [];
        replica.rejections.push({ ...operation, dismissedAt: Date.now() });
        projectReplica(replica);
      });
      publishReplica(scope, state);
    },
    async retryPhysicalSale(id) {
      const state = await replicaRepository.update(scope, replica => {
        const operation = replica.outbox.find(value => value.id === id);
        if (operation?.status !== 'rejected' || operation.error?.code !== 'INSUFFICIENT_STOCK' || operation.action !== 'sale.create')
          throw new Error('Only a known stock rejection can be recorded as a completed physical sale.');
        replica.rejections ||= []; replica.rejections.push({ ...operation, supersededAt: Date.now() });
        operation.id = crypto.randomUUID(); operation.payload.fromOffline = true;
        operation.status = 'pending'; operation.wire = null; operation.attempts = 0; operation.nextAttemptAt = 0; operation.error = null;
        projectReplica(replica);
      });
      publishReplica(scope, state); await engine.sync();
    },
    async pending() { return (await replicaRepository.read(scope)).outbox.length; },
    async discardForLogout() {
      const state = await replicaRepository.update(scope, replica => {
        replica.discarded ||= [];
        replica.discarded.push(...replica.outbox.map(operation => ({ ...operation, discardedAt: Date.now() })));
        replica.outbox = []; projectReplica(replica);
      });
      publishReplica(scope, state);
    },
  };
  void refresh();
  const stop = () => {
    stopped = true; engine.stop(); clearInterval(timer); channel?.close();
    window.removeEventListener('vendora-outbox', changed); window.removeEventListener('online', resumeOnline);
    window.removeEventListener('offline', wake); window.removeEventListener('focus', wake);
    if (activeSync?.scope === scope) activeSync = null;
  };
  stop.sync = () => engine.sync();
  return stop;
}

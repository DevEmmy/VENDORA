import { replicaRepository } from '../sync/replicaRepository.js';
import {
  encryptedReplicaRepository,
  StorageLockedError,
  DecryptionError,
  RevisionConflictError,
  StorageCorruptError,
} from './encryptedReplicaRepository.js';

// In-memory registry of active migrations to coordinate with account writes
const activeMigrations = new Map();
const activeRemoteMigrations = new Map();

const migrationChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('vendora-migration-coordination')
  : null;
migrationChannel?.unref?.();

if (migrationChannel) {
  migrationChannel.onmessage = (event) => {
    const data = event.data;
    if (!data || !data.scope) return;
    if (data.type === 'migration-start') {
      let resolveRemote;
      const remotePromise = new Promise((resolve) => { resolveRemote = resolve; });
      remotePromise.resolve = resolveRemote;
      activeRemoteMigrations.set(data.scope, remotePromise);
    } else if (data.type === 'migration-end') {
      const existing = activeRemoteMigrations.get(data.scope);
      if (existing) {
        existing.resolve();
        activeRemoteMigrations.delete(data.scope);
      }
    }
  };
}

export function registerMigrationInProgress(scope, promise) {
  activeMigrations.set(scope, promise);
  try {
    migrationChannel?.postMessage({ type: 'migration-start', scope });
  } catch {}
  const cleanup = () => {
    if (activeMigrations.get(scope) === promise) {
      activeMigrations.delete(scope);
      try {
        migrationChannel?.postMessage({ type: 'migration-end', scope });
      } catch {}
    }
  };
  promise.then(cleanup, cleanup).catch(() => {});
}

export async function waitForMigration(scope) {
  const local = activeMigrations.get(scope);
  if (local) {
    try {
      await local;
    } catch {
      // Ignored here; callers of the migration handle its errors
    }
  }
  const remote = activeRemoteMigrations.get(scope);
  if (remote) {
    try {
      await remote;
    } catch {
      // Ignored
    }
  }
  if (globalThis.navigator?.locks?.request) {
    try {
      await navigator.locks.request(`vendora-replica:${scope}`, async () => {});
    } catch {
      // Fallback
    }
  }
}

export function isMigrationInProgress(scope) {
  return activeMigrations.has(scope) || activeRemoteMigrations.has(scope);
}

export function createAccountStorage({
  legacy = replicaRepository,
  encrypted = encryptedReplicaRepository,
} = {}) {
  async function isEncrypted(scope) {
    if (encrypted.getAccountKey(scope)) {
      return true;
    }
    const raw = await encrypted.readRaw(scope);
    return Boolean(raw && (raw._encrypted === true || raw._migrationEnvelope === true));
  }

  async function resolveRepository(scope) {
    const encryptedAccount = await isEncrypted(scope);
    if (encryptedAccount) {
      return encrypted;
    }
    return legacy;
  }

  return {
    async read(scope) {
      await waitForMigration(scope);
      const repo = await resolveRepository(scope);
      return repo.read(scope);
    },
    async update(scope, change, options) {
      await waitForMigration(scope);
      const repo = await resolveRepository(scope);
      return repo.update(scope, change, options);
    },
    async readRaw(scope) {
      return encrypted.readRaw(scope);
    },
    async writeRaw(scope, record) {
      return encrypted.writeRaw(scope, record);
    },
    async deleteRaw(scope) {
      return encrypted.deleteRaw(scope);
    },
    isEncrypted,
    resolveRepository,
    getAccountKey: (scope) => encrypted.getAccountKey(scope),
    setAccountKey: (scope, key) => encrypted.setAccountKey(scope, key),
    clearAccountKey: (scope) => encrypted.clearAccountKey(scope),
    clearAllKeys: () => encrypted.clearAllKeys(),
    async close() {
      await Promise.all([legacy.close(), encrypted.close()]);
    },
  };
}

export const accountRepository = createAccountStorage({
  legacy: replicaRepository,
  encrypted: encryptedReplicaRepository,
});

export async function getAccountRepository(scope, customStorage = null) {
  const storage = customStorage || accountRepository;
  return storage.resolveRepository(scope);
}

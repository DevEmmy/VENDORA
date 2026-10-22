import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { createAccountKey } from '../src/features/security/accountKey.js';
import {
  createEncryptedReplicaRepository,
  StorageLockedError,
} from '../src/features/security/encryptedReplicaRepository.js';
import {
  migrateAccountStorage,
  resumeOrRecoverMigration,
  getMigrationStatus,
  accountStorageKey,
  extractAccountState,
  MigrationError,
} from '../src/features/security/offlineMigration.js';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
    _store: store,
  };
}

function createMockIndexedDB() {
  const databases = new Map();

  return {
    open(dbName, version = 1) {
      let dbRecord = databases.get(dbName);
      let needsUpgrade = false;

      if (!dbRecord) {
        dbRecord = {
          name: dbName,
          version,
          stores: new Map(),
        };
        databases.set(dbName, dbRecord);
        needsUpgrade = true;
      }

      const connection = {
        name: dbName,
        version: dbRecord.version,
        objectStoreNames: {
          contains: name => dbRecord.stores.has(name),
        },
        createObjectStore: name => {
          if (!dbRecord.stores.has(name)) {
            dbRecord.stores.set(name, new Map());
          }
          return { name };
        },
        close: () => {},
        transaction: (storeNames, mode = 'readonly') => {
          const storeName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
          const storeData = dbRecord.stores.get(storeName);
          if (!storeData) {
            throw new Error(`NotFoundError: Object store ${storeName} not found.`);
          }

          let active = true;
          let aborted = false;
          let pendingRequests = 0;
          const rollbackSnapshot = new Map(storeData);

          const tx = {
            mode,
            error: null,
            oncomplete: null,
            onabort: null,
            onerror: null,
            abort: () => {
              if (aborted) return;
              aborted = true;
              active = false;
              storeData.clear();
              for (const [k, v] of rollbackSnapshot) {
                storeData.set(k, v);
              }
              queueMicrotask(() => {
                if (typeof tx.onabort === 'function') {
                  tx.onabort({ target: tx });
                }
              });
            },
            objectStore: () => ({
              get(key) {
                if (!active) throw new Error('TransactionInactiveError');
                pendingRequests++;
                const req = { result: undefined, onsuccess: null };
                queueMicrotask(() => {
                  if (aborted) return;
                  req.result = storeData.get(key) !== undefined
                    ? structuredClone(storeData.get(key))
                    : undefined;
                  try {
                    if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                  } finally {
                    pendingRequests--;
                    checkCompletion();
                  }
                });
                return req;
              },
              put(value, key) {
                if (!active) throw new Error('TransactionInactiveError');
                pendingRequests++;
                const req = { result: key, onsuccess: null };
                queueMicrotask(() => {
                  if (aborted) return;
                  storeData.set(key, structuredClone(value));
                  try {
                    if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                  } finally {
                    pendingRequests--;
                    checkCompletion();
                  }
                });
                return req;
              },
              delete(key) {
                if (!active) throw new Error('TransactionInactiveError');
                pendingRequests++;
                const req = { result: undefined, onsuccess: null };
                queueMicrotask(() => {
                  if (aborted) return;
                  storeData.delete(key);
                  try {
                    if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                  } finally {
                    pendingRequests--;
                    checkCompletion();
                  }
                });
                return req;
              },
            }),
          };

          function checkCompletion() {
            if (pendingRequests === 0 && active && !aborted) {
              active = false;
              queueMicrotask(() => {
                if (!aborted && typeof tx.oncomplete === 'function') {
                  tx.oncomplete({ target: tx });
                }
              });
            }
          }

          queueMicrotask(() => {
            if (pendingRequests === 0 && active && !aborted) {
              active = false;
              if (typeof tx.oncomplete === 'function') {
                tx.oncomplete({ target: tx });
              }
            }
          });

          return tx;
        },
      };

      const request = {
        result: connection,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        if (needsUpgrade && typeof request.onupgradeneeded === 'function') {
          request.onupgradeneeded({ target: request });
        }
        if (typeof request.onsuccess === 'function') {
          request.onsuccess({ target: request });
        }
      });

      return request;
    },
  };
}

const USER_ID = 'user-mig-001';
const BIZ_ID = 'biz-mig-001';
const SCOPE = `${encodeURIComponent(USER_ID)}:${encodeURIComponent(BIZ_ID)}`;

test('migration: full preservation of outbox, canonical, domain, and localStorage account snapshot', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'mig-test-db-1' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  // Populate legacy plaintext replica in IndexedDB
  const legacyReplica = {
    version: 1,
    cursor: '150',
    nextSequence: 5,
    canonical: {
      products: { 'sp-1': { id: 'sp-1', name: 'Flour', currentQty: '20' } },
      sales: { 'ss-1': { id: 'ss-1', total: '100000' } },
      movements: {},
    },
    mappings: {
      products: { 'lp-1': 'sp-1' },
      sales: { 'ls-1': 'ss-1' },
      customers: {},
    },
    outbox: [
      {
        id: 'op-sale-1',
        action: 'sale.create',
        sequence: 1,
        status: 'pending',
        attempts: 1,
        wire: { path: '/api/sales', method: 'POST', body: { total: 5000 } },
        payload: { localId: 'ls-2', amount: 5000 },
      },
      {
        id: 'op-restock-1',
        action: 'stock.restock',
        sequence: 2,
        status: 'pending',
        attempts: 0,
        wire: null,
        payload: { productId: 'lp-1', quantity: '10' },
      },
    ],
    domain: {
      products: [{ id: 'lp-1', name: 'Flour', price: 5000, qty: 30 }],
      txns: [{ id: 'ls-1', type: 'sale', amount: 10000 }],
      customers: [{ id: 'c-1', name: 'Mama Nkechi', balance: 0 }],
      ledger: [{ hash: '0'.repeat(64), sig: null }],
      invoiceSeq: 2,
    },
    rejections: [],
    legacyImported: true,
    phase: 'pending',
    lastError: null,
    lastSyncAt: 1600000000000,
  };

  await repo.writeRaw(SCOPE, legacyReplica);

  // Populate legacy plaintext localStorage snapshot
  const localSnapshot = {
    profile: {
      name: 'Amaka Eze',
      phone: '08012345678',
      businessName: 'Amaka Provisions',
      businessType: 'Provisions',
      city: 'Enugu',
      onboarded: true,
    },
    staff: [{ id: 'staff-1', name: 'Chidi' }],
    currentStaffId: 'staff-1',
    savings: { enabled: true, balance: 25000 },
    loans: [],
    credits: [{ id: 'credit-1', customerName: 'Emeka', amount: 5000 }],
    cac: { status: 'verified', number: 'RC-123456' },
  };

  mockStorage.setItem(accountStorageKey(USER_ID, BIZ_ID), JSON.stringify(localSnapshot));

  // Run migration
  const result = await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });

  assert.equal(result.status, 'migrated');
  assert.equal(result.revision, 1);
  assert.equal(result.outboxCount, 2);

  // Verify that raw storage in IndexedDB is now encrypted
  const rawAfter = await repo.readRaw(SCOPE);
  assert.equal(rawAfter._encrypted, true);
  assert.equal(rawAfter.version, 1);
  assert.equal(rawAfter.revision, 1);

  // Verify that plaintext localStorage snapshot has been purged
  assert.equal(mockStorage.getItem(accountStorageKey(USER_ID, BIZ_ID)), null);

  // Verify that decrypting the migrated replica preserves all fields identically
  repo.setAccountKey(SCOPE, accountKey);
  const decrypted = await repo.read(SCOPE);

  // 1. Outbox preserved with identical IDs and order
  assert.equal(decrypted.outbox.length, 2);
  assert.equal(decrypted.outbox[0].id, 'op-sale-1');
  assert.equal(decrypted.outbox[0].sequence, 1);
  assert.equal(decrypted.outbox[0].wire.path, '/api/sales');
  assert.equal(decrypted.outbox[1].id, 'op-restock-1');
  assert.equal(decrypted.outbox[1].sequence, 2);

  // 2. Canonical and domain records preserved
  assert.equal(decrypted.cursor, '150');
  assert.equal(decrypted.nextSequence, 5);
  assert.equal(decrypted.canonical.products['sp-1'].name, 'Flour');
  assert.equal(decrypted.domain.products[0].name, 'Flour');
  assert.equal(decrypted.domain.txns[0].amount, 10000);
  assert.equal(decrypted.domain.customers[0].name, 'Mama Nkechi');

  // 3. localStorage non-domain fields preserved in accountState
  assert.ok(decrypted.accountState, 'accountState must exist in migrated replica');
  assert.equal(decrypted.accountState.profile.businessName, 'Amaka Provisions');
  assert.equal(decrypted.accountState.profile.phone, '08012345678');
  assert.equal(decrypted.accountState.staff[0].name, 'Chidi');
  assert.equal(decrypted.accountState.savings.balance, 25000);
  assert.equal(decrypted.accountState.cac.number, 'RC-123456');

  await repo.close();
});

test('migration: idempotent execution preserves encrypted state and revision', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'mig-test-db-2' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  await repo.writeRaw(SCOPE, {
    version: 1,
    cursor: '0',
    nextSequence: 0,
    outbox: [{ id: 'op-1', action: 'sale.create' }],
  });

  // First migration run
  const res1 = await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });
  assert.equal(res1.status, 'migrated');

  // Second migration run on already migrated account
  const res2 = await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });
  assert.equal(res2.status, 'already_migrated');
  assert.equal(res2.revision, 1);

  // Verify data is still intact
  repo.setAccountKey(SCOPE, accountKey);
  const data = await repo.read(SCOPE);
  assert.equal(data.outbox.length, 1);
  assert.equal(data.outbox[0].id, 'op-1');

  await repo.close();
});

test('migration: crash at preparation stage leaves original plaintext replica intact and resumes cleanly', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'crash-prep-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  const originalPlaintext = {
    version: 1,
    cursor: '10',
    nextSequence: 1,
    outbox: [{ id: 'vital-op-1', sequence: 1 }],
  };
  await repo.writeRaw(SCOPE, originalPlaintext);
  mockStorage.setItem(accountStorageKey(USER_ID, BIZ_ID), JSON.stringify({ profile: { name: 'Owner' } }));

  // Simulate crash during preparation
  await assert.rejects(
    migrateAccountStorage({
      repository: repo,
      scope: SCOPE,
      accountKey,
      localStorage: mockStorage,
      options: { simulateCrashAt: 'preparing' },
    }),
    err => err instanceof MigrationError && err.stage === 'preparing'
  );

  // Verification: scope in IndexedDB MUST still be the original plaintext
  const rawAfterCrash = await repo.readRaw(SCOPE);
  assert.deepEqual(rawAfterCrash, originalPlaintext);
  assert.ok(mockStorage.getItem(accountStorageKey(USER_ID, BIZ_ID)));

  // Re-run migration without simulated failure: must recover and succeed
  const recovery = await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });

  assert.equal(recovery.status, 'migrated');
  repo.setAccountKey(SCOPE, accountKey);
  const decrypted = await repo.read(SCOPE);
  assert.equal(decrypted.outbox[0].id, 'vital-op-1');
  assert.equal(mockStorage.getItem(accountStorageKey(USER_ID, BIZ_ID)), null);

  await repo.close();
});

test('migration: crash at staging stage leaves original plaintext intact and resumes cleanly', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'crash-staged-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  const originalPlaintext = {
    version: 1,
    cursor: '20',
    nextSequence: 2,
    outbox: [{ id: 'staged-test-op', sequence: 1 }],
  };
  await repo.writeRaw(SCOPE, originalPlaintext);

  // Crash at staging
  await assert.rejects(
    migrateAccountStorage({
      repository: repo,
      scope: SCOPE,
      accountKey,
      localStorage: mockStorage,
      options: { simulateCrashAt: 'staged' },
    }),
    err => err instanceof MigrationError && err.stage === 'staged'
  );

  // Scope remains original plaintext
  const rawAfterCrash = await repo.readRaw(SCOPE);
  assert.deepEqual(rawAfterCrash, originalPlaintext);

  // Re-run migration: recovers and completes
  const result = await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });
  assert.equal(result.status, 'migrated');

  await repo.close();
});

test('migration: verification failure aborts migration and leaves original plaintext untouched', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'fail-verify-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  const originalPlaintext = {
    version: 1,
    cursor: '50',
    nextSequence: 1,
    outbox: [{ id: 'must-not-be-lost' }],
  };
  await repo.writeRaw(SCOPE, originalPlaintext);

  // Simulate verification failure
  await assert.rejects(
    migrateAccountStorage({
      repository: repo,
      scope: SCOPE,
      accountKey,
      localStorage: mockStorage,
      options: { simulateCrashAt: 'verifying' },
    }),
    err => err instanceof MigrationError && err.stage === 'verifying'
  );

  // Scope remains untouched plaintext
  const currentRaw = await repo.readRaw(SCOPE);
  assert.deepEqual(currentRaw, originalPlaintext);

  await repo.close();
});

test('migration: crash at cleaning stage recovers seamlessly without losing data', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'crash-cleaning-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  await repo.writeRaw(SCOPE, {
    version: 1,
    cursor: '0',
    nextSequence: 1,
    outbox: [{ id: 'cleaning-crash-op' }],
  });
  mockStorage.setItem(accountStorageKey(USER_ID, BIZ_ID), JSON.stringify({ profile: { name: 'Owner' } }));

  // Simulate crash during activation (after scope was written)
  await assert.rejects(
    migrateAccountStorage({
      repository: repo,
      scope: SCOPE,
      accountKey,
      localStorage: mockStorage,
      options: { simulateCrashAt: 'activating' },
    }),
    err => err instanceof MigrationError && err.stage === 'activating'
  );

  // At this point, scope was already activated (encrypted)
  const status = await getMigrationStatus({ repository: repo, scope: SCOPE });
  assert.equal(status.isMigrated, true);

  // Recovery should detect active encryption, verify it, and clean up leftover artifacts
  const recovery = await resumeOrRecoverMigration({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });

  assert.equal(recovery.status, 'recovered_and_cleaned');
  // LocalStorage must be purged
  assert.equal(mockStorage.getItem(accountStorageKey(USER_ID, BIZ_ID)), null);

  // Decrypted data is complete
  repo.setAccountKey(SCOPE, accountKey);
  const data = await repo.read(SCOPE);
  assert.equal(data.outbox[0].id, 'cleaning-crash-op');

  await repo.close();
});

test('migration: migrated account cannot downgrade to plaintext; updates advance revision atomically', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'no-downgrade-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  await repo.writeRaw(SCOPE, {
    version: 1,
    cursor: '0',
    nextSequence: 1,
    outbox: [{ id: 'initial-op' }],
  });

  await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });

  // Attempting to read without key throws StorageLockedError (never downgrades to plaintext)
  await assert.rejects(
    repo.read(SCOPE),
    err => err instanceof StorageLockedError
  );

  // With key, updating the migrated repository commits at revision 2
  repo.setAccountKey(SCOPE, accountKey);
  await repo.update(SCOPE, replica => {
    replica.outbox.push({ id: 'post-migration-sale' });
  });

  const updatedRaw = await repo.readRaw(SCOPE);
  assert.equal(updatedRaw._encrypted, true);
  assert.equal(updatedRaw.revision, 2);

  const updatedReplica = await repo.read(SCOPE);
  assert.equal(updatedReplica.outbox.length, 2);
  assert.equal(updatedReplica.outbox[0].id, 'initial-op');
  assert.equal(updatedReplica.outbox[1].id, 'post-migration-sale');

  await repo.close();
});

test('migration recovery: new encrypted sale recorded after activation but before cleanup is preserved at revision 2, never overwritten by plaintext backup', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'post-act-sale-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  // Initial plaintext with Sale 1
  await repo.writeRaw(SCOPE, {
    version: 1,
    cursor: '0',
    nextSequence: 1,
    outbox: [{ id: 'sale-1-before-migration', sequence: 1 }],
  });
  mockStorage.setItem(accountStorageKey(USER_ID, BIZ_ID), JSON.stringify({ profile: { name: 'Owner' } }));

  // Simulate migration crash right after activation (so scope is revision 1, but cleanup has not run)
  await assert.rejects(
    migrateAccountStorage({
      repository: repo,
      scope: SCOPE,
      accountKey,
      localStorage: mockStorage,
      options: { simulateCrashAt: 'activating' },
    }),
    err => err instanceof MigrationError && err.stage === 'activating'
  );

  // Verify migration_backup exists in IndexedDB
  const backup = await repo.readRaw(`migration_backup:${SCOPE}`);
  assert.ok(backup, 'migration_backup must exist prior to cleanup');
  assert.equal(backup.outbox[0].id, 'sale-1-before-migration');

  // NOW: An encrypted sale (Sale 2) is recorded before cleanup runs!
  repo.setAccountKey(SCOPE, accountKey);
  await repo.update(SCOPE, replica => {
    replica.outbox.push({ id: 'sale-2-recorded-post-activation', sequence: 2 });
  });

  // Verify scope advanced to revision 2!
  const rawRev2 = await repo.readRaw(SCOPE);
  assert.equal(rawRev2._encrypted, true);
  assert.equal(rawRev2.revision, 2);

  // Now a reboot / crash recovery occurs and calls resumeOrRecoverMigration!
  const recoveryResult = await resumeOrRecoverMigration({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });

  assert.equal(recoveryResult.status, 'recovered_and_cleaned');
  assert.equal(recoveryResult.revision, 2);

  // CRITICAL VERIFICATION:
  // 1. Scope must STILL be at revision 2!
  const finalRaw = await repo.readRaw(SCOPE);
  assert.equal(finalRaw._encrypted, true);
  assert.equal(finalRaw.revision, 2);

  // 2. The older plaintext backup must NEVER have overwritten revision 2!
  const finalReplica = await repo.read(SCOPE);
  assert.equal(finalReplica.outbox.length, 2);
  assert.equal(finalReplica.outbox[0].id, 'sale-1-before-migration');
  assert.equal(finalReplica.outbox[1].id, 'sale-2-recorded-post-activation');

  // 3. Temporary backups and plaintext localStorage are safely cleaned up
  assert.equal(await repo.readRaw(`migration_backup:${SCOPE}`), null);
  assert.equal(mockStorage.getItem(accountStorageKey(USER_ID, BIZ_ID)), null);

  await repo.close();
});

test('migration recovery: failed decryption of active encrypted replica fails closed and preserves all records and backups', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'fail-closed-db' });
  const mockStorage = createMockLocalStorage();
  const correctKey = await createAccountKey();
  const wrongKey = await createAccountKey();

  // Initial plaintext with critical operations
  const originalPlaintext = {
    version: 1,
    cursor: '10',
    nextSequence: 1,
    outbox: [{ id: 'critical-sale-1' }],
  };
  await repo.writeRaw(SCOPE, originalPlaintext);
  const snapshotData = JSON.stringify({ profile: { businessName: 'Safe Store' } });
  mockStorage.setItem(accountStorageKey(USER_ID, BIZ_ID), snapshotData);

  // Migrate with correct key up to activation
  await assert.rejects(
    migrateAccountStorage({
      repository: repo,
      scope: SCOPE,
      accountKey: correctKey,
      localStorage: mockStorage,
      options: { simulateCrashAt: 'activating' },
    }),
    err => err instanceof MigrationError && err.stage === 'activating'
  );

  const rawBeforeRecovery = await repo.readRaw(SCOPE);
  assert.equal(rawBeforeRecovery._encrypted, true);

  // Attempt recovery with WRONG KEY
  await assert.rejects(
    resumeOrRecoverMigration({
      repository: repo,
      scope: SCOPE,
      accountKey: wrongKey,
      localStorage: mockStorage,
    }),
    err => err instanceof MigrationError && err.stage === 'recovery'
  );

  // FAIL CLOSED VERIFICATION:
  // 1. The active encrypted record at scope was NOT overwritten or wiped
  const rawAfterFailedRecovery = await repo.readRaw(SCOPE);
  assert.deepEqual(rawAfterFailedRecovery, rawBeforeRecovery);

  // 2. The plaintext backup in IndexedDB was NOT deleted
  const backup = await repo.readRaw(`migration_backup:${SCOPE}`);
  assert.ok(backup, 'Backup must be preserved when recovery cannot decrypt');
  assert.equal(backup.outbox[0].id, 'critical-sale-1');

  // 3. Plaintext localStorage snapshot was NOT deleted
  assert.equal(mockStorage.getItem(accountStorageKey(USER_ID, BIZ_ID)), snapshotData);

  await repo.close();
});

test('migration activation: source replica changed during staging triggers abort and restarts migration with latest data', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'atomic-source-check-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  // Base plaintext with Sale 1
  await repo.writeRaw(SCOPE, {
    version: 1,
    cursor: '0',
    nextSequence: 1,
    outbox: [{ id: 'sale-1', sequence: 1 }],
  });

  // Track write attempts to simulate a concurrent plaintext write between staging and activation
  let concurrentInjected = false;
  const originalWriteRaw = repo.writeRaw;
  repo.writeRaw = async (targetScope, data) => {
    // When staging writes migration_staged, simulate a concurrent sale arriving in plaintext at SCOPE
    if (targetScope === `migration_staged:${SCOPE}` && !concurrentInjected) {
      concurrentInjected = true;
      await originalWriteRaw(SCOPE, {
        version: 1,
        cursor: '0',
        nextSequence: 2,
        outbox: [
          { id: 'sale-1', sequence: 1 },
          { id: 'sale-2-concurrent-during-staging', sequence: 2 },
        ],
      });
    }
    return originalWriteRaw(targetScope, data);
  };

  // Run migration
  const result = await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });

  assert.equal(result.status, 'migrated');

  // Both sales must be preserved in the final encrypted replica!
  repo.setAccountKey(SCOPE, accountKey);
  const final = await repo.read(SCOPE);
  assert.equal(final.outbox.length, 2);
  assert.equal(final.outbox[0].id, 'sale-1');
  assert.equal(final.outbox[1].id, 'sale-2-concurrent-during-staging');

  await repo.close();
});

test('migration activation: localStorage snapshot changed during staging triggers abort and incorporates changes into accountState', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory: idb, dbName: 'atomic-snapshot-check-db' });
  const mockStorage = createMockLocalStorage();
  const accountKey = await createAccountKey();

  await repo.writeRaw(SCOPE, {
    version: 1,
    cursor: '0',
    nextSequence: 0,
    outbox: [],
  });
  mockStorage.setItem(
    accountStorageKey(USER_ID, BIZ_ID),
    JSON.stringify({ profile: { name: 'Owner Initial' } })
  );

  let snapshotUpdated = false;
  const originalWriteRaw = repo.writeRaw;
  repo.writeRaw = async (targetScope, data) => {
    // When staging writes, update localStorage with an added staff member
    if (targetScope === `migration_staged:${SCOPE}` && !snapshotUpdated) {
      snapshotUpdated = true;
      mockStorage.setItem(
        accountStorageKey(USER_ID, BIZ_ID),
        JSON.stringify({
          profile: { name: 'Owner Initial' },
          staff: [{ id: 'staff-concurrent', name: 'Ngozi' }],
        })
      );
    }
    return originalWriteRaw(targetScope, data);
  };

  const result = await migrateAccountStorage({
    repository: repo,
    scope: SCOPE,
    accountKey,
    localStorage: mockStorage,
  });

  assert.equal(result.status, 'migrated');

  repo.setAccountKey(SCOPE, accountKey);
  const final = await repo.read(SCOPE);
  assert.ok(final.accountState);
  assert.equal(final.accountState.profile.name, 'Owner Initial');
  assert.equal(final.accountState.staff[0].name, 'Ngozi');

  await repo.close();
});


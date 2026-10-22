import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { createAccountKey, wrapAccountKey, unlockAccountKey } from '../src/features/security/accountKey.js';
import {
  createEncryptedReplicaRepository,
  encryptReplicaEnvelope,
  decryptReplicaEnvelope,
  StorageLockedError,
} from '../src/features/security/encryptedReplicaRepository.js';
import { replicaScope } from '../src/features/sync/replicaRepository.js';
import {
  enrollForOfflineAccess,
  unlockOfflineAccess,
  enableOfflineAccess,
  preparePasswordChangeRewrap,
  commitPasswordChangeRewrap,
  abortPasswordChangeRewrap,
  rewrapOfflineEnrollment,
  reconcileCrossDevicePasswordChange,
  getStagedEnrollmentRecord,
  getEnrollmentRecord,
  getAccessPolicyRecord,
  getHighWaterTimestamp,
  updateHighWaterTimestamp,
  evaluateAccountOfflineAccess,
  recordOnlineVerification,
  revokeOfflineEnrollment,
  EnrollmentError,
  UnlockError,
} from '../src/features/security/offlineEnrollment.js';
import {
  evaluateOfflineAccess,
  checkClockRollback,
  SKEW_TOLERANCE_MS,
} from '../src/features/security/offlineAccessPolicy.js';
import {
  getOfflineSessionState,
  isOfflineSessionActive,
  setOfflineSessionUnlocked,
  clearOfflineSession,
  checkSessionExpiry,
} from '../src/features/security/offlineSession.js';
import { emptyReplica, createSyncEngine } from '../src/features/sync/outbox.js';
import { startAccountSync } from '../src/features/sync/accountSync.js';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

function createMockIndexedDB() {
  const databases = new Map();

  return {
    open(dbName, version = 1) {
      let dbRecord = databases.get(dbName);
      if (!dbRecord) {
        dbRecord = { name: dbName, version, stores: new Map() };
        databases.set(dbName, dbRecord);
      }

      const connection = {
        name: dbName,
        version: dbRecord.version,
        objectStoreNames: { contains: name => dbRecord.stores.has(name) },
        createObjectStore: name => {
          if (!dbRecord.stores.has(name)) dbRecord.stores.set(name, new Map());
          return { name };
        },
        close: () => {},
        transaction: (storeNames, mode = 'readonly') => {
          const storeName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
          const storeData = dbRecord.stores.get(storeName);
          if (!storeData) throw new Error(`Object store ${storeName} not found.`);

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
              for (const [k, v] of rollbackSnapshot) storeData.set(k, v);
              queueMicrotask(() => tx.onabort?.({ target: tx }));
            },
            objectStore: () => ({
              get(key) {
                if (!active) throw new Error('TransactionInactiveError');
                pendingRequests++;
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (aborted) return;
                  req.result = storeData.get(key) !== undefined ? structuredClone(storeData.get(key)) : undefined;
                  req.onsuccess?.({ target: req });
                  pendingRequests--;
                  checkComplete();
                });
                return req;
              },
              put(value, key) {
                if (!active) throw new Error('TransactionInactiveError');
                pendingRequests++;
                const req = { result: key, error: null, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (aborted) return;
                  storeData.set(key, structuredClone(value));
                  req.onsuccess?.({ target: req });
                  pendingRequests--;
                  checkComplete();
                });
                return req;
              },
              delete(key) {
                if (!active) throw new Error('TransactionInactiveError');
                pendingRequests++;
                const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                queueMicrotask(() => {
                  if (aborted) return;
                  storeData.delete(key);
                  req.onsuccess?.({ target: req });
                  pendingRequests--;
                  checkComplete();
                });
                return req;
              },
            }),
          };

          function checkComplete() {
            if (pendingRequests === 0 && active && !aborted) {
              active = false;
              queueMicrotask(() => {
                if (!aborted) tx.oncomplete?.({ target: tx });
              });
            }
          }

          queueMicrotask(() => {
            if (pendingRequests === 0 && active && !aborted) checkComplete();
          });

          return tx;
        },
      };

      const openRequest = { result: connection, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (!connection.objectStoreNames.contains('accounts')) {
          connection.createObjectStore('accounts');
        }
        openRequest.onsuccess?.({ target: openRequest });
      });
      return openRequest;
    },
  };
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

// ============================================================================
// Phase 5 Test Suite
// ============================================================================

test('1. password change with offline key rewrapping preserves replica ciphertext and pending sales without re-encryption', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory, dbName: 'test-p5-rewrap-db' });

  const userId = 'usr_p5_seller_1';
  const businessId = 'biz_p5_shop_1';
  const scope = replicaScope(userId, businessId);
  const oldPassword = 'OldSafePassword123!';
  const newPassword = 'NewStrongPassword456!';

  // Initial enrollment
  const { accountKey } = await enrollForOfflineAccess({
    userId,
    businessId,
    password: oldPassword,
    storage,
  });

  // Seed encrypted replica with existing products and pending sales
  const initialReplica = {
    ...emptyReplica(),
    domain: {
      products: [{ id: 'p1', name: 'Dangote Sugar 50kg', qty: 10, price: 42000 }],
      txns: [{ id: 'txn1', amount: 42000, timestamp: Date.now() }],
      customers: [],
      ledger: [],
      invoiceSeq: 1,
    },
    outbox: [
      { id: 'op_sale_1', action: 'sale.create', payload: { amount: 42000 }, status: 'pending' },
    ],
  };
  const env1 = await encryptReplicaEnvelope(accountKey, scope, initialReplica, 1);
  await repo.writeRaw(scope, env1);

  // Execute password change rewrap
  const prepareRes = await preparePasswordChangeRewrap({
    userId,
    businessId,
    currentPassword: oldPassword,
    newPassword,
    storage,
  });
  assert.equal(prepareRes.enrolled, true);
  assert.equal(prepareRes.staged, true);

  // Simulate server confirmed password change -> commit local staged rewrap
  const commitRes = await commitPasswordChangeRewrap({
    userId,
    businessId,
    storage,
  });
  assert.equal(commitRes.committed, true);
  assert.equal(getStagedEnrollmentRecord(userId, businessId, storage), null);

  // Verification 1: Unlocking with new password succeeds and unwraps the exact same CryptoKey
  const unlockWithNew = await unlockOfflineAccess({
    userId,
    businessId,
    password: newPassword,
    storage,
  });
  assert.ok(unlockWithNew.accountKey);

  // Verification 2: The raw replica in IndexedDB was NEVER re-encrypted, yet decrypts perfectly with unlocked key!
  repo.setAccountKey(scope, unlockWithNew.accountKey);
  const readReplica = await repo.read(scope);
  assert.equal(readReplica.domain.products[0].name, 'Dangote Sugar 50kg');
  assert.equal(readReplica.outbox.length, 1);
  assert.equal(readReplica.outbox[0].id, 'op_sale_1');

  // Verification 3: Unlocking with old password is now rejected
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password: oldPassword,
      storage,
    }),
    err => {
      assert.equal(err.code, 'WRONG_PASSWORD');
      return true;
    }
  );
});

test('2. crash safety: recovers gracefully from interruptions before or after server confirms new password', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_p5_crash_1';
  const businessId = 'biz_p5_crash_1';
  const passwordOld = 'PreCrashPassword1!';
  const passwordNew = 'PostCrashPassword2!';

  await enrollForOfflineAccess({
    userId,
    businessId,
    password: passwordOld,
    storage,
  });

  // Scenario A: Failure BEFORE server confirms (e.g. network dropped during server call)
  await preparePasswordChangeRewrap({
    userId,
    businessId,
    currentPassword: passwordOld,
    newPassword: passwordNew,
    storage,
  });
  assert.ok(getStagedEnrollmentRecord(userId, businessId, storage));

  // Server call failed -> abort staged rewrap
  abortPasswordChangeRewrap({ userId, businessId, storage });
  assert.equal(getStagedEnrollmentRecord(userId, businessId, storage), null);

  // User unlocks with old password -> works normally
  const unlockA = await unlockOfflineAccess({
    userId,
    businessId,
    password: passwordOld,
    storage,
  });
  assert.ok(unlockA.accountKey);

  // Scenario B: Crash AFTER server confirms, before commitPasswordChangeRewrap ran
  await preparePasswordChangeRewrap({
    userId,
    businessId,
    currentPassword: passwordOld,
    newPassword: passwordNew,
    storage,
  });
  // Simulate crash: staged record exists in storage, primary is still old password
  assert.ok(getStagedEnrollmentRecord(userId, businessId, storage));

  // User opens app offline and enters NEW password (which server has accepted)
  const unlockB = await unlockOfflineAccess({
    userId,
    businessId,
    password: passwordNew,
    storage,
  });
  assert.ok(unlockB.accountKey, 'Must unlock using staged envelope upon crash recovery');

  // Crash recovery committed staged to primary and cleaned up staged record!
  assert.equal(getStagedEnrollmentRecord(userId, businessId, storage), null);

  // Future unlocks with new password succeed directly from primary
  const unlockB2 = await unlockOfflineAccess({
    userId,
    businessId,
    password: passwordNew,
    storage,
  });
  assert.ok(unlockB2.accountKey);
});

test('3. wrong current password rejected before server mutation, preserving local key intact', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_p5_wrong_pwd';
  const businessId = 'biz_p5_wrong_pwd';
  const actualPassword = 'CorrectAccountPassword99!';
  const wrongPassword = 'WrongAttemptPassword00!';
  const newPassword = 'BrandNewPassword123!';

  await enrollForOfflineAccess({
    userId,
    businessId,
    password: actualPassword,
    storage,
  });

  // Attempt rewrap with wrong current password
  await assert.rejects(
    async () => preparePasswordChangeRewrap({
      userId,
      businessId,
      currentPassword: wrongPassword,
      newPassword,
      storage,
    }),
    err => {
      assert.equal(err instanceof EnrollmentError, true);
      assert.equal(err.code, 'WRONG_OLD_PASSWORD');
      return true;
    }
  );

  // Verify no staged record was created and original enrollment is intact
  assert.equal(getStagedEnrollmentRecord(userId, businessId, storage), null);
  const unlock = await unlockOfflineAccess({
    userId,
    businessId,
    password: actualPassword,
    storage,
  });
  assert.ok(unlock.accountKey);
});

test('4. cross-device password change (offline): informs user of cross-device scenario and allows previous password', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_p5_xdevice';
  const businessId = 'biz_p5_xdevice';
  const passwordOnDeviceA = 'DeviceAPassword1!';
  const passwordChangedOnDeviceB = 'DeviceBNewPassword2!';

  await enrollForOfflineAccess({
    userId,
    businessId,
    password: passwordOnDeviceA,
    storage,
  });

  // User enters Device B's new password on Device A (offline)
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password: passwordChangedOnDeviceB,
      storage,
    }),
    err => {
      assert.equal(err instanceof UnlockError, true);
      assert.equal(err.code, 'WRONG_PASSWORD');
      assert.ok(err.message.includes('another device'));
      return true;
    }
  );

  // User enters previous password on Device A -> successfully unlocks offline records!
  const unlockOld = await unlockOfflineAccess({
    userId,
    businessId,
    password: passwordOnDeviceA,
    storage,
  });
  assert.ok(unlockOld.accountKey);
});

test('5. cross-device password change reconciliation (online): rewraps local key without re-encrypting replica or losing sales', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({ factory, dbName: 'test-p5-xdevice-recon' });

  const userId = 'usr_p5_recon';
  const businessId = 'biz_p5_recon';
  const scope = replicaScope(userId, businessId);
  const previousPassword = 'OriginalPassword1!';
  const serverNewPassword = 'NewRemotePassword2!';

  const { accountKey } = await enrollForOfflineAccess({
    userId,
    businessId,
    password: previousPassword,
    storage,
  });

  // Seed replica with unsynchronized offline sale
  const replica = {
    ...emptyReplica(),
    domain: { products: [{ id: 'p1', name: 'Flour 50kg', qty: 5, price: 38000 }], txns: [], customers: [], ledger: [], invoiceSeq: 1 },
    outbox: [{ id: 'op_pending_sale', action: 'sale.create', payload: { amount: 38000 }, status: 'pending' }],
  };
  await repo.writeRaw(scope, await encryptReplicaEnvelope(accountKey, scope, replica, 1));

  // Device connects online with serverNewPassword. Reconciles local key using previousPassword
  const reconRes = await reconcileCrossDevicePasswordChange({
    userId,
    businessId,
    previousPassword,
    newPassword: serverNewPassword,
    storage,
  });
  assert.equal(reconRes.reconciled, true);

  // Unlocking with new password succeeds and reads unsynchronized sales intact
  const unlockRes = await unlockOfflineAccess({
    userId,
    businessId,
    password: serverNewPassword,
    storage,
  });
  repo.setAccountKey(scope, unlockRes.accountKey);
  const loaded = await repo.read(scope);
  assert.equal(loaded.outbox.length, 1);
  assert.equal(loaded.outbox[0].id, 'op_pending_sale');
});

test('6. reconnection handling: offline-unlocked session blocks background sync; re-authenticates before pushing', async () => {
  clearOfflineSession();
  const userId = 'usr_p5_reconnect';
  const businessId = 'biz_p5_reconnect';

  // Mark offline session as active
  setOfflineSessionUnlocked(userId, businessId, { allowed: true });
  assert.equal(isOfflineSessionActive(), true);

  // Attempting to start sync while offline session is active MUST be blocked
  assert.throws(
    () => startAccountSync({ userId, businessId }),
    err => {
      assert.ok(err.message.includes('offline-unlocked session'));
      return true;
    }
  );

  // Online authentication re-established -> clears offline session
  clearOfflineSession();
  assert.equal(isOfflineSessionActive(), false);
});

test('7. pending sales synchronization: pushes in strict chronological order with idempotency keys without duplication', async () => {
  const repository = new Map();
  const repo = {
    async read(scope) { return structuredClone(repository.get(scope) || emptyReplica()); },
    async update(scope, fn) {
      const state = structuredClone(repository.get(scope) || emptyReplica());
      fn(state);
      repository.set(scope, state);
      return structuredClone(state);
    },
  };

  const scope = 'account:usr_seq:biz_seq';
  let pullCount = 0;
  const sent = [];

  const op = (id, body = {}) => ({
    id,
    action: 'sale.create',
    payload: body,
    request: { method: 'POST', path: '/api/sales', body: { ...body, clientId: id } },
  });

  // Enqueue 3 offline sales
  await repo.update(scope, state => {
    state.outbox.push(
      { ...op('sale_1', { clientSeq: 1, amount: 5000 }), sequence: 1, status: 'pending', nextAttemptAt: 0, attempts: 0 },
      { ...op('sale_2', { clientSeq: 2, amount: 8500 }), sequence: 2, status: 'pending', nextAttemptAt: 0, attempts: 0 },
      { ...op('sale_3', { clientSeq: 3, amount: 12000 }), sequence: 3, status: 'pending', nextAttemptAt: 0, attempts: 0 }
    );
  });

  const engine = createSyncEngine({
    repository: repo,
    scope,
    businessId: 'biz_seq',
    request: async (path, options) => {
      if (path.startsWith('/api/sync/changes')) {
        pullCount++;
        return { changes: [], nextCursor: pullCount > 1 ? '1' : '0', hasMore: false };
      }
      sent.push(options.body.clientId);
      return { sale: { id: options.body.clientId, syncSeq: '1' } };
    },
    requestBatch: async (ops) => {
      for (const item of ops) {
        sent.push(item.id);
      }
      return {
        results: ops.map(item => ({
          clientId: item.id,
          status: 200,
          body: { sale: { id: item.id, syncSeq: '1' } },
        })),
      };
    },
  });

  await engine.sync();

  // All 3 sales pushed in strict sequence
  assert.equal(sent.length, 3);
  assert.equal(sent[0], 'sale_1');
  assert.equal(sent[1], 'sale_2');
  assert.equal(sent[2], 'sale_3');

  // Outbox is cleared after successful sync
  const finalState = await repo.read(scope);
  assert.equal(finalState.outbox.length, 0);
});

test('8. sync failure handling: network or server failure preserves outbox operations intact with retry backoff', async () => {
  let clock = 100000;
  const repository = new Map();
  const repo = {
    async read(scope) { return structuredClone(repository.get(scope) || emptyReplica()); },
    async update(scope, fn) {
      const state = structuredClone(repository.get(scope) || emptyReplica());
      fn(state);
      repository.set(scope, state);
      return structuredClone(state);
    },
  };

  const scope = 'account:usr_fail:biz_fail';
  const pull = { changes: [], nextCursor: '0', hasMore: false };

  const op = {
    id: 'op_offline_sale',
    action: 'sale.create',
    payload: { amount: 7000 },
    request: { method: 'POST', path: '/api/sales', body: { amount: 7000, clientId: 'op_offline_sale' } },
    sequence: 1,
    status: 'pending',
    nextAttemptAt: 0,
    attempts: 0,
  };

  await repo.update(scope, state => {
    state.outbox.push(op);
  });

  // Simulate network connection failure during push
  const engine = createSyncEngine({
    repository: repo,
    scope,
    businessId: 'biz_fail',
    now: () => clock,
    request: async (path) => {
      if (path.startsWith('/api/sync/changes')) return pull;
      const netErr = new Error('Network offline or backend timeout');
      netErr.status = 0;
      throw netErr;
    },
  });

  // Sync handles network transient error gracefully without throwing unhandled rejection
  await engine.sync();

  // Outbox operation is NOT lost or discarded; attempts counter incremented, scheduled for retry
  const stateAfter = await repo.read(scope);
  assert.equal(stateAfter.outbox.length, 1);
  assert.equal(stateAfter.outbox[0].id, 'op_offline_sale');
  assert.equal(stateAfter.outbox[0].attempts, 1);
  assert.ok(stateAfter.outbox[0].nextAttemptAt > clock);
});

test('9. conservative clock-rollback detection: persisted high-water timestamp detects clock rewinds and blocks operations', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_p5_clock';
  const businessId = 'biz_p5_clock';
  const password = 'ClockSafetyPassword1!';

  const verificationTime = 1700000000000;

  // Online verification establishes Day 0
  await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: verificationTime,
  });

  // App is used at Day 3 (72 hours later) -> advances high-water mark
  const day3 = verificationTime + (3 * 24 * 3600000);
  const unlockDay3 = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: day3,
  });
  assert.equal(unlockDay3.policy.allowed, true);
  assert.equal(getHighWaterTimestamp(userId, businessId, storage), day3);

  // Device clock is rolled back to Day 1 (48 hours before Day 3, well past 5-min tolerance)
  const rolledBackTime = day3 - (48 * 3600000);
  const policyCheck = evaluateAccountOfflineAccess(userId, businessId, storage, rolledBackTime);
  assert.equal(policyCheck.allowed, false);
  assert.equal(policyCheck.status, 'clock_rollback');
  assert.equal(policyCheck.rollback, true);

  // Attempting unlock during clock rollback rejects
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password,
      storage,
      now: rolledBackTime,
    }),
    err => {
      assert.equal(err.code, 'ACCESS_EXPIRED');
      assert.equal(err.reason, 'clock_rollback');
      assert.ok(err.message.includes('clock'));
      return true;
    }
  );

  // When clock is restored to valid time (> Day 3), access is restored
  const restoredTime = day3 + 60000;
  const unlockRestored = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: restoredTime,
  });
  assert.equal(unlockRestored.policy.allowed, true);
});

test('10. lastVerifiedAt is immutable to offline unlock and offline operations; updated only by online auth', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_p5_verify_ts';
  const businessId = 'biz_p5_verify_ts';
  const password = 'TimestampSafety1!';
  const startTime = 1700000000000;

  await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: startTime,
  });
  assert.equal(getAccessPolicyRecord(userId, businessId, storage).lastVerifiedAt, startTime);

  // Offline unlock 24 hours later
  const unlock1 = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: startTime + 86400000,
  });
  assert.ok(unlock1.accountKey);
  // lastVerifiedAt MUST NOT HAVE CHANGED
  assert.equal(getAccessPolicyRecord(userId, businessId, storage).lastVerifiedAt, startTime);

  // Second offline unlock 48 hours later
  const unlock2 = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: startTime + (2 * 86400000),
  });
  assert.ok(unlock2.accountKey);
  assert.equal(getAccessPolicyRecord(userId, businessId, storage).lastVerifiedAt, startTime);

  // Only explicit online verification updates lastVerifiedAt
  const newOnlineTime = startTime + (5 * 86400000);
  recordOnlineVerification(userId, businessId, storage, newOnlineTime);
  assert.equal(getAccessPolicyRecord(userId, businessId, storage).lastVerifiedAt, newOnlineTime);
});

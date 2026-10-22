import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { createAccountKey } from '../src/features/security/accountKey.js';
import {
  createEncryptedReplicaRepository,
  encryptReplicaEnvelope,
  decryptReplicaEnvelope,
  StorageLockedError,
  DecryptionError,
} from '../src/features/security/encryptedReplicaRepository.js';
import {
  createReplicaRepository,
  replicaScope,
} from '../src/features/sync/replicaRepository.js';
import {
  createAccountStorage,
  registerMigrationInProgress,
  waitForMigration,
  isMigrationInProgress,
} from '../src/features/security/accountStorage.js';
import {
  enrollForOfflineAccess,
  unlockOfflineAccess,
  enableOfflineAccess,
  revokeOfflineEnrollment,
  clearOfflineAccessData,
  isEnrolledForOfflineAccess,
  getEnrollmentRecord,
  getAccessPolicyRecord,
  evaluateAccountOfflineAccess,
  recordOnlineVerification,
  getLastEnrolledAccount,
  EnrollmentError,
  UnlockError,
} from '../src/features/security/offlineEnrollment.js';
import {
  getOfflineSessionState,
  isOfflineSessionActive,
  setOfflineSessionUnlocked,
  clearOfflineSession,
  checkSessionExpiry,
} from '../src/features/security/offlineSession.js';
import { emptyReplica } from '../src/features/sync/outbox.js';
import { migrateAccountStorage } from '../src/features/security/offlineMigration.js';

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
        dbRecord = {
          name: dbName,
          version,
          stores: new Map(),
        };
        databases.set(dbName, dbRecord);
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
            objectStore: () => {
              return {
                get(key) {
                  if (!active) {
                    throw new Error('TransactionInactiveError: The transaction is inactive.');
                  }
                  pendingRequests++;
                  const req = {
                    result: undefined,
                    error: null,
                    onsuccess: null,
                    onerror: null,
                  };
                  queueMicrotask(() => {
                    if (aborted) return;
                    req.result = storeData.get(key) !== undefined
                      ? structuredClone(storeData.get(key))
                      : undefined;
                    try {
                      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                    } catch (err) {
                      tx.error = err;
                      if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
                    }
                    pendingRequests--;
                    checkComplete();
                  });
                  return req;
                },
                put(value, key) {
                  if (!active) {
                    throw new Error('TransactionInactiveError: The transaction is inactive.');
                  }
                  pendingRequests++;
                  const req = {
                    result: key,
                    error: null,
                    onsuccess: null,
                    onerror: null,
                  };
                  queueMicrotask(() => {
                    if (aborted) return;
                    storeData.set(key, structuredClone(value));
                    try {
                      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                    } catch (err) {
                      tx.error = err;
                      if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
                    }
                    pendingRequests--;
                    checkComplete();
                  });
                  return req;
                },
                delete(key) {
                  if (!active) {
                    throw new Error('TransactionInactiveError: The transaction is inactive.');
                  }
                  pendingRequests++;
                  const req = {
                    result: undefined,
                    error: null,
                    onsuccess: null,
                    onerror: null,
                  };
                  queueMicrotask(() => {
                    if (aborted) return;
                    storeData.delete(key);
                    try {
                      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                    } catch (err) {
                      tx.error = err;
                      if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
                    }
                    pendingRequests--;
                    checkComplete();
                  });
                  return req;
                },
              };
            },
          };

          function checkComplete() {
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
              checkComplete();
            }
          });

          return tx;
        },
      };

      const openRequest = {
        result: connection,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };

      queueMicrotask(() => {
        try {
          if (!connection.objectStoreNames.contains('accounts')) {
            connection.createObjectStore('accounts');
          }
          if (typeof openRequest.onsuccess === 'function') {
            openRequest.onsuccess({ target: openRequest });
          }
        } catch (err) {
          openRequest.error = err;
          if (typeof openRequest.onerror === 'function') {
            openRequest.onerror({ target: openRequest });
          }
        }
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

// ---------------------------------------------------------------------------
// Phase 4C End-to-End Validation Tests
// ---------------------------------------------------------------------------

test('E2E offline workflow: online enrollment, disconnect, refresh, unlock, POS sale, second refresh, second unlock, pending sale preservation', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-e2e-workflow-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userId = 'usr_fictional_pos_1';
  const businessId = 'biz_fictional_pos_1';
  const scope = replicaScope(userId, businessId);
  const password = 'StrongPassword999!';
  const startTime = Date.now();

  // 1. Online enrollment
  const { accountKey } = await enableOfflineAccess({
    userId,
    businessId,
    password,
    businessName: 'Iya Basira Store',
    userName: 'Basira Alake',
    storage,
    now: startTime,
  });

  // Seed initial business state in encrypted repository
  const initialReplica = {
    ...emptyReplica(),
    domain: {
      products: [
        { id: 'p_garri', name: 'Garri Ijebu (Paint)', qty: 20, price: 3500 },
        { id: 'p_beans', name: 'Oloyin Beans (Omo)', qty: 15, price: 4200 },
      ],
      txns: [],
      customers: [{ id: 'c1', name: 'Madam Kofo', phone: '08022223333' }],
      ledger: [],
      invoiceSeq: 1,
    },
    accountState: {
      profile: { name: 'Basira Alake', businessName: 'Iya Basira Store', onboarded: true },
    },
  };
  const initialEnv = await encryptReplicaEnvelope(accountKey, scope, initialReplica, 1);
  await encryptedRepo.writeRaw(scope, initialEnv);

  // 2. Disconnect & simulated browser refresh (clear all in-memory keys and session)
  clearOfflineSession();
  encryptedRepo.clearAccountKey(scope);
  assert.equal(isOfflineSessionActive(), false);

  // 3. Reopen offline: verify enrolled account is detected
  const lastEnrolled = getLastEnrolledAccount(storage);
  assert.ok(lastEnrolled);
  assert.equal(lastEnrolled.userId, userId);

  // 4. Password unlock
  const unlockResult = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: startTime + 3600000, // 1 hour later
  });
  assert.equal(unlockResult.policy.allowed, true);
  setOfflineSessionUnlocked(userId, businessId, unlockResult.policy);
  assert.equal(isOfflineSessionActive(), true);

  // 5. Offline inventory access & sale
  encryptedRepo.setAccountKey(scope, unlockResult.accountKey);
  const replicaAfterUnlock = await encryptedRepo.read(scope);
  assert.equal(replicaAfterUnlock.domain.products.length, 2);
  assert.equal(replicaAfterUnlock.domain.products[0].qty, 20);

  // Perform an offline sale: customer buys 3 paints of Garri
  const saleTime = startTime + 3600000 + 60000;
  const updatedReplica = await encryptedRepo.update(scope, draft => {
    draft.domain.products[0].qty -= 3;
    const saleTxn = {
      id: 'txn_off_sale_1',
      type: 'sale',
      items: [{ productId: 'p_garri', name: 'Garri Ijebu (Paint)', qty: 3, price: 3500 }],
      amount: 10500,
      paid: 10500,
      timestamp: saleTime,
      offline: true,
      customerName: 'Madam Kofo',
    };
    draft.domain.txns.push(saleTxn);
    draft.outbox.push({
      id: 'op_sale_offline_1',
      action: 'sale.create',
      payload: saleTxn,
      status: 'pending',
      createdAt: saleTime,
    });
    draft.phase = 'offline';
  });

  assert.equal(updatedReplica.domain.products[0].qty, 17);
  assert.equal(updatedReplica.domain.txns.length, 1);
  assert.equal(updatedReplica.outbox.length, 1);

  // 6. Second refresh: clear memory again
  clearOfflineSession();
  encryptedRepo.clearAccountKey(scope);
  assert.equal(isOfflineSessionActive(), false);

  // 7. Second unlock: unlock again with password
  const secondUnlock = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: startTime + (24 * 3600000), // Day 2
  });
  assert.equal(secondUnlock.policy.allowed, true);
  encryptedRepo.setAccountKey(scope, secondUnlock.accountKey);

  // 8. Pending-sale and inventory preservation verification
  const finalReplica = await encryptedRepo.read(scope);
  assert.equal(finalReplica.domain.products[0].qty, 17, 'Inventory reduction must persist');
  assert.equal(finalReplica.domain.txns.length, 1, 'Sale transaction must persist');
  assert.equal(finalReplica.domain.txns[0].id, 'txn_off_sale_1');
  assert.equal(finalReplica.outbox.length, 1, 'Outbox pending operation must persist');
  assert.equal(finalReplica.outbox[0].id, 'op_sale_offline_1');
  assert.equal(finalReplica.outbox[0].payload.amount, 10500);
});

test('continuous session expiration: blocks new business operations immediately when 7 days expire with app open', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_continuous_exp';
  const businessId = 'biz_continuous_exp';
  const password = 'PasswordExpiryTest1!';
  const startTime = 1700000000000;

  // Enroll on Day 0
  await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: startTime,
  });

  // Unlock on Day 5 (valid)
  const day5 = startTime + (5 * 24 * 3600000);
  const unlockRes = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: day5,
  });
  setOfflineSessionUnlocked(userId, businessId, unlockRes.policy);
  assert.equal(isOfflineSessionActive(), true);

  // Day 5 check: not expired
  assert.equal(checkSessionExpiry(storage, day5), false);
  assert.equal(isOfflineSessionActive(), true);

  // Continuous open app reaches Day 8 (> 7 days from online verification)
  const day8 = startTime + (8 * 24 * 3600000);
  const expired = checkSessionExpiry(storage, day8);

  assert.equal(expired, true);
  assert.equal(isOfflineSessionActive(), false);
  assert.equal(getOfflineSessionState().status, 'lock_expired');
  assert.equal(getOfflineSessionState().errorCode, 'ACCESS_EXPIRED');

  // Attempting unlock at Day 8 rejects
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password,
      storage,
      now: day8,
    }),
    err => {
      assert.equal(err.code, 'ACCESS_EXPIRED');
      return true;
    }
  );

  // Cleanup
  clearOfflineSession();
});

test('unsafe revocation blocked: cannot delete wrapped key while encrypted replica exists', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-unsafe-revoke-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userId = 'usr_unsafe_revoke';
  const businessId = 'biz_unsafe_revoke';
  const scope = replicaScope(userId, businessId);
  const password = 'RevokeSafetyPassword1!';

  // Enroll
  const { accountKey } = await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
  });

  // Create an active encrypted replica in the repository
  const replica = {
    ...emptyReplica(),
    domain: { products: [{ id: 'p1', name: 'Item', qty: 5, price: 100 }], txns: [], customers: [], ledger: [], invoiceSeq: 1 },
  };
  const env = await encryptReplicaEnvelope(accountKey, scope, replica, 1);
  await encryptedRepo.writeRaw(scope, env);

  // Attempting to revoke enrollment WITHOUT force MUST be blocked!
  await assert.rejects(
    async () => revokeOfflineEnrollment({
      userId,
      businessId,
      storage,
      repository: encryptedRepo,
    }),
    err => {
      assert.equal(err instanceof EnrollmentError, true);
      assert.equal(err.code, 'UNSAFE_REVOCATION_BLOCKED');
      assert.ok(err.message.includes('encrypted business records'));
      return true;
    }
  );

  // Verify wrapped key was NOT deleted from storage!
  assert.ok(getEnrollmentRecord(userId, businessId, storage), 'Wrapped key envelope must remain intact');

  // Attempting clearOfflineAccessData WITHOUT force MUST also be blocked!
  await assert.rejects(
    async () => clearOfflineAccessData({
      userId,
      businessId,
      storage,
      repository: encryptedRepo,
    }),
    err => {
      assert.equal(err.code, 'UNSAFE_REVOCATION_BLOCKED');
      return true;
    }
  );
  assert.ok(getEnrollmentRecord(userId, businessId, storage), 'Wrapped key must remain intact');

  // When force: true is explicitly provided, revocation proceeds
  await revokeOfflineEnrollment({
    userId,
    businessId,
    storage,
    repository: encryptedRepo,
    force: true,
  });
  assert.equal(getEnrollmentRecord(userId, businessId, storage), null, 'Key is revoked when explicitly forced');
});

test('multi-tab migration safety: atomic IndexedDB check and Web Lock coordination prevent stale overwrites', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'test-multi-tab-mig-db';
  const scope = 'account:usr_tab:biz_tab';
  const repo = createEncryptedReplicaRepository({ factory, dbName });
  const accountKey = await createAccountKey();

  // Seed initial plaintext replica
  const initial = {
    ...emptyReplica(),
    version: 1,
    domain: { products: [{ id: 'item1', name: 'Sugar', qty: 10, price: 500 }], txns: [], customers: [], ledger: [], invoiceSeq: 0 },
  };
  await repo.writeRaw(scope, initial);

  const initialJson = JSON.stringify(initial);

  // Tab A stages an encrypted envelope based on initialJson
  const stagedEnv = await encryptReplicaEnvelope(accountKey, scope, initial, 1);

  // Concurrently, Tab B writes a new sale to the plaintext record before Tab A activates
  const concurrentUpdate = structuredClone(initial);
  concurrentUpdate.domain.products[0].qty = 9;
  concurrentUpdate.domain.txns.push({ id: 'concurrent_sale', total: 500 });
  await repo.writeRaw(scope, concurrentUpdate);

  // Tab A attempts atomic activation with its now-stale expectedSourceJson
  const activationResult = await repo.activateEnvelopeWithSourceCheck(
    scope,
    stagedEnv,
    initialJson
  );

  // Tab A's activation MUST be refused because source changed in IndexedDB!
  assert.equal(activationResult.activated, false);
  assert.equal(activationResult.reason, 'source_changed');

  // Verify the committed record in IndexedDB was NOT overwritten by the stale ciphertext
  const committed = await repo.readRaw(scope);
  assert.equal(committed.domain.products[0].qty, 9);
  assert.equal(committed.domain.txns.length, 1);
});

test('account switching and state isolation: prevents cross-account data leakage', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'test-switch-db';
  const repo = createEncryptedReplicaRepository({ factory, dbName });

  const userA = 'usr_switch_a';
  const bizA = 'biz_switch_a';
  const scopeA = replicaScope(userA, bizA);
  const keyA = await createAccountKey();

  const userB = 'usr_switch_b';
  const bizB = 'biz_switch_b';
  const scopeB = replicaScope(userB, bizB);
  const keyB = await createAccountKey();

  // Create account A data
  const replicaA = {
    ...emptyReplica(),
    domain: { products: [{ id: 'pa', name: 'Account A Secret', qty: 100, price: 1000 }], txns: [], customers: [], ledger: [], invoiceSeq: 1 },
    accountState: { profile: { name: 'Alice', businessName: 'A Store' } },
  };
  await repo.writeRaw(scopeA, await encryptReplicaEnvelope(keyA, scopeA, replicaA, 1));

  // Create account B data
  const replicaB = {
    ...emptyReplica(),
    domain: { products: [{ id: 'pb', name: 'Account B Goods', qty: 50, price: 2000 }], txns: [], customers: [], ledger: [], invoiceSeq: 1 },
    accountState: { profile: { name: 'Bob', businessName: 'B Store' } },
  };
  await repo.writeRaw(scopeB, await encryptReplicaEnvelope(keyB, scopeB, replicaB, 1));

  // Session 1: User A
  repo.setAccountKey(scopeA, keyA);
  setOfflineSessionUnlocked(userA, bizA, { allowed: true });

  const readA = await repo.read(scopeA);
  assert.equal(readA.domain.products[0].name, 'Account A Secret');

  // Switch / Sign out: clear session and clear key
  clearOfflineSession();
  repo.clearAccountKey(scopeA);

  // Attempting to read scope A now fails
  await assert.rejects(async () => repo.read(scopeA), StorageLockedError);

  // Session 2: User B unlocks
  repo.setAccountKey(scopeB, keyB);
  setOfflineSessionUnlocked(userB, bizB, { allowed: true });

  // User B reads their data
  const readB = await repo.read(scopeB);
  assert.equal(readB.domain.products[0].name, 'Account B Goods');

  // Scope A remains locked to User B
  await assert.rejects(async () => repo.read(scopeA), StorageLockedError);

  // Attempting to decrypt scope A with key B fails
  await assert.rejects(
    async () => decryptReplicaEnvelope(keyB, scopeA, await repo.readRaw(scopeA)),
    DecryptionError
  );

  // Cleanup
  clearOfflineSession();
  repo.clearAccountKey(scopeB);
});

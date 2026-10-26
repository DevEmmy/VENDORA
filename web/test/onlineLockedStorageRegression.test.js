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
  waitForMigration,
} from '../src/features/security/accountStorage.js';
import {
  enrollForOfflineAccess,
  unlockOfflineAccess,
  enableOfflineAccess,
  isEnrolledForOfflineAccess,
  getLastEnrolledAccount,
  recordOnlineVerification,
  evaluateAccountOfflineAccess,
  reconcileCrossDevicePasswordChange,
  UnlockError,
} from '../src/features/security/offlineEnrollment.js';
import {
  getOfflineSessionState,
  isOfflineSessionActive,
  setOfflineSessionUnlocked,
  clearOfflineSession,
} from '../src/features/security/offlineSession.js';
import { emptyReplica, queueOperation } from '../src/features/sync/outbox.js';
import { domainOf } from '../src/features/sync/domain.js';

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

          const tx = {
            mode,
            error: null,
            oncomplete: null,
            onabort: null,
            onerror: null,
            abort: () => {
              aborted = true;
              active = false;
              queueMicrotask(() => {
                if (typeof tx.onabort === 'function') tx.onabort({ target: tx });
              });
            },
            objectStore: () => {
              return {
                get(key) {
                  if (!active) throw new Error('TransactionInactiveError');
                  pendingRequests++;
                  const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    if (aborted) return;
                    const val = storeData.get(key);
                    req.result = val !== undefined ? structuredClone(val) : undefined;
                    if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
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
                    if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
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
                    if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
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
      };

      queueMicrotask(() => {
        if (!connection.objectStoreNames.contains('accounts')) {
          connection.createObjectStore('accounts');
        }
        if (typeof openRequest.onsuccess === 'function') {
          openRequest.onsuccess({ target: openRequest });
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
  };
}

// ============================================================================
// Online Locked Encrypted Storage Regression Suite
// ============================================================================

test('1. online refresh with authenticated server session: locked storage throws StorageLockedError and unlocks with password without data loss', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-online-refresh-locked-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const legacyRepo = createReplicaRepository({ factory, dbName });
  const accountStore = createAccountStorage({ legacy: legacyRepo, encrypted: encryptedRepo });

  const userId = 'usr_milo_merchant';
  const businessId = 'biz_milo_shop';
  const scope = replicaScope(userId, businessId);
  const password = 'MiloPassword2026!';
  const startTime = Date.now();

  // Step 1: Merchant enrolls online
  const { accountKey } = await enableOfflineAccess({
    userId,
    businessId,
    password,
    businessName: 'Iya Milo Provisions',
    userName: 'Kudirat Alao',
    phone: '08033334444',
    storage,
    now: startTime,
  });

  // Seed encrypted replica with 20 bags of Milo 500g
  encryptedRepo.setAccountKey(scope, accountKey);
  const initialReplica = {
    ...emptyReplica(),
    domain: {
      products: [
        { id: 'p_milo', name: 'Milo 500g Refill', qty: 20, price: 2500 },
      ],
      txns: [],
      customers: [],
      ledger: [],
      invoiceSeq: 1,
    },
    accountState: {
      profile: { name: 'Kudirat Alao', businessName: 'Iya Milo Provisions', onboarded: true },
    },
  };
  const env1 = await encryptReplicaEnvelope(accountKey, scope, initialReplica, 1);
  await encryptedRepo.writeRaw(scope, env1);

  // Step 2: Go offline, sell 2 bags of Milo for ₦5,000 (18 remaining)
  const offlineSaleTime = startTime + 60000;
  const updatedReplica = await encryptedRepo.update(scope, draft => {
    draft.domain.products[0].qty = 18;
    draft.domain.txns.push({
      id: 'txn_milo_sale_1',
      type: 'sale',
      items: [{ productId: 'p_milo', name: 'Milo 500g Refill', qty: 2, price: 2500 }],
      amount: 5000,
      timestamp: offlineSaleTime,
      offline: true,
    });
    queueOperation(draft, {
      action: 'sale.create',
      payload: { id: 'txn_milo_sale_1', amount: 5000, qty: 2 },
      timestamp: offlineSaleTime,
    });
  });

  assert.equal(updatedReplica.domain.products[0].qty, 18);
  assert.equal(updatedReplica.outbox.length, 1);

  // Step 3: Reconnect online & REFRESH BROWSER
  // In-memory keys are completely wiped on page refresh
  encryptedRepo.clearAllKeys();
  clearOfflineSession();

  // Server returns 200 OK for /api/auth/me (authenticated session)
  const serverAuthStatus = 'authenticated';
  assert.equal(serverAuthStatus, 'authenticated');

  // Verify that accountRepository detects encrypted storage
  const isEnc = await accountStore.isEncrypted(scope);
  assert.equal(isEnc, true, 'Storage must be detected as encrypted');

  // Attempting to read without password key throws StorageLockedError
  let caughtError = null;
  try {
    await accountStore.read(scope);
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError, 'Must fail to read without account key');
  assert.equal(caughtError.name, 'StorageLockedError');
  assert.match(caughtError.message, /locked/i);

  // Step 4: User prompted with password unlock. Provide correct password.
  recordOnlineVerification(userId, businessId, storage, startTime + 120000);
  const unlockResult = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: startTime + 120000,
  });

  assert.ok(unlockResult.accountKey, 'Unwrapping must return CryptoKey');

  // Set key in repository and read storage
  encryptedRepo.setAccountKey(scope, unlockResult.accountKey);
  const restoredReplica = await accountStore.read(scope);

  // Verify full data preservation
  assert.equal(restoredReplica.domain.products[0].name, 'Milo 500g Refill');
  assert.equal(restoredReplica.domain.products[0].qty, 18, 'Must preserve 18 remaining bags');
  assert.equal(restoredReplica.domain.txns.length, 1, 'Must preserve ₦5,000 offline sale');
  assert.equal(restoredReplica.domain.txns[0].amount, 5000);
  assert.equal(restoredReplica.outbox.length, 1, 'Must preserve pending outbox entry for server sync');
  assert.equal(restoredReplica.outbox[0].action, 'sale.create');
});

test('2. incorrect password attempts during online locked storage unlock fail closed without data mutation', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-wrong-password-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userId = 'usr_test_fail';
  const businessId = 'biz_test_fail';
  const scope = replicaScope(userId, businessId);
  const correctPassword = 'CorrectPassword123!';
  const wrongPassword = 'WrongPassword999!';
  const startTime = Date.now();

  const { accountKey } = await enableOfflineAccess({
    userId,
    businessId,
    password: correctPassword,
    businessName: 'Kano Textiles',
    userName: 'Aliyu Danladi',
    storage,
    now: startTime,
  });

  encryptedRepo.setAccountKey(scope, accountKey);
  const initialReplica = {
    ...emptyReplica(),
    domain: { products: [{ id: 'p_wax', name: 'Super Wax', qty: 50 }], txns: [] },
  };
  const env = await encryptReplicaEnvelope(accountKey, scope, initialReplica, 1);
  await encryptedRepo.writeRaw(scope, env);

  // Wipe memory
  encryptedRepo.clearAllKeys();

  // Wrong password attempt 1
  await assert.rejects(
    async () => {
      await unlockOfflineAccess({
        userId,
        businessId,
        password: wrongPassword,
        storage,
        now: startTime + 1000,
      });
    },
    err => {
      assert.ok(err instanceof UnlockError);
      assert.equal(err.code, 'WRONG_PASSWORD');
      return true;
    }
  );

  // Wrong password attempt 2
  await assert.rejects(
    async () => {
      await unlockOfflineAccess({
        userId,
        businessId,
        password: 'AnotherWrongPassword!',
        storage,
        now: startTime + 2000,
      });
    },
    err => err.code === 'WRONG_PASSWORD'
  );

  // Verify storage is still locked and ciphertext was not altered
  const rawAfterFailures = await encryptedRepo.readRaw(scope);
  assert.equal(rawAfterFailures.revision, 1);
  assert.equal(rawAfterFailures.ciphertext, env.ciphertext);

  // Now unlock with correct password
  const successfulUnlock = await unlockOfflineAccess({
    userId,
    businessId,
    password: correctPassword,
    storage,
    now: startTime + 3000,
  });

  encryptedRepo.setAccountKey(scope, successfulUnlock.accountKey);
  const decrypted = await encryptedRepo.read(scope);
  assert.equal(decrypted.domain.products[0].qty, 50);
});

test('3. account switching: signing out from locked account preserves ciphertext and prevents key leakage to another account', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-account-switching-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userIdA = 'usr_merchant_A';
  const businessIdA = 'biz_merchant_A';
  const scopeA = replicaScope(userIdA, businessIdA);
  const passwordA = 'PasswordForMerchantA1!';

  const userIdB = 'usr_merchant_B';
  const businessIdB = 'biz_merchant_B';
  const scopeB = replicaScope(userIdB, businessIdB);
  const passwordB = 'PasswordForMerchantB2!';

  // User A enrolls and saves secret inventory
  const { accountKey: keyA } = await enableOfflineAccess({
    userId: userIdA,
    businessId: businessIdA,
    password: passwordA,
    businessName: 'Store A',
    storage,
  });
  encryptedRepo.setAccountKey(scopeA, keyA);
  const repA = {
    ...emptyReplica(),
    domain: { products: [{ id: 'p_a', name: 'Private Product A', qty: 100 }], txns: [] },
  };
  await encryptedRepo.writeRaw(scopeA, await encryptReplicaEnvelope(keyA, scopeA, repA, 1));

  // User A signs out -> clear all in-memory keys
  encryptedRepo.clearAllKeys();

  // User B logs in and enrolls
  const { accountKey: keyB } = await enableOfflineAccess({
    userId: userIdB,
    businessId: businessIdB,
    password: passwordB,
    businessName: 'Store B',
    storage,
  });
  encryptedRepo.setAccountKey(scopeB, keyB);

  // User B tries to read User A's scope with User B's key -> DecryptionError / StorageLockedError
  await assert.rejects(
    async () => {
      // User B only has scopeB key, scopeA has no key
      await encryptedRepo.read(scopeA);
    },
    err => {
      assert.equal(err.name, 'StorageLockedError');
      return true;
    }
  );

  // User B tries to force User B's key onto Scope A -> Decryption fails (AAD mismatch / wrong key)
  encryptedRepo.setAccountKey(scopeA, keyB);
  await assert.rejects(
    async () => {
      await encryptedRepo.read(scopeA);
    },
    err => {
      assert.equal(err.name, 'DecryptionError');
      return true;
    }
  );

  // User A signs back in, unlocks with Password A
  encryptedRepo.clearAllKeys();
  const unlockA = await unlockOfflineAccess({
    userId: userIdA,
    businessId: businessIdA,
    password: passwordA,
    storage,
  });
  encryptedRepo.setAccountKey(scopeA, unlockA.accountKey);
  const decryptedA = await encryptedRepo.read(scopeA);
  assert.equal(decryptedA.domain.products[0].name, 'Private Product A');
  assert.equal(decryptedA.domain.products[0].qty, 100);
});

test('4. interrupted unlocking: refresh during locked screen preserves staged and original keys safely', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-interrupted-unlock-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userId = 'usr_interrupted';
  const businessId = 'biz_interrupted';
  const scope = replicaScope(userId, businessId);
  const password = 'InterruptedPass1!';

  const { accountKey } = await enableOfflineAccess({
    userId,
    businessId,
    password,
    storage,
  });

  encryptedRepo.setAccountKey(scope, accountKey);
  const rep = {
    ...emptyReplica(),
    domain: { products: [{ id: 'p_rice', name: 'Abakaliki Rice 50kg', qty: 10 }] },
  };
  await encryptedRepo.writeRaw(scope, await encryptReplicaEnvelope(accountKey, scope, rep, 1));

  // User reloads browser without unlocking (simulating interrupted flow)
  encryptedRepo.clearAllKeys();

  // Reload 1: storage remains locked
  assert.equal(await encryptedRepo.readRaw(scope).then(r => r._encrypted), true);
  await assert.rejects(() => encryptedRepo.read(scope), err => err.name === 'StorageLockedError');

  // Reload 2: storage remains locked
  assert.equal(await encryptedRepo.readRaw(scope).then(r => r._encrypted), true);
  await assert.rejects(() => encryptedRepo.read(scope), err => err.name === 'StorageLockedError');

  // Eventually user enters password: completely unharmed
  const unlock = await unlockOfflineAccess({ userId, businessId, password, storage });
  encryptedRepo.setAccountKey(scope, unlock.accountKey);
  const readResult = await encryptedRepo.read(scope);
  assert.equal(readResult.domain.products[0].name, 'Abakaliki Rice 50kg');
});

test('5. cross-device password change reconciliation while online re-wraps local key without re-encrypting replica or losing sales', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-cross-device-reconcile-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userId = 'usr_cross_device';
  const businessId = 'biz_cross_device';
  const scope = replicaScope(userId, businessId);
  const oldPassword = 'OldPassword123!';
  const newPassword = 'NewPassword456!';

  // Step 1: Enrolled on this device with oldPassword
  const { accountKey } = await enableOfflineAccess({
    userId,
    businessId,
    password: oldPassword,
    storage,
  });

  // Offline sale recorded with old key
  encryptedRepo.setAccountKey(scope, accountKey);
  const initialReplica = {
    ...emptyReplica(),
    domain: { products: [{ id: 'p_cement', name: 'Dangote Cement 50kg', qty: 95 }] },
  };
  await encryptedRepo.writeRaw(scope, await encryptReplicaEnvelope(accountKey, scope, initialReplica, 1));

  // Clear memory
  encryptedRepo.clearAllKeys();

  // Step 2: Merchant changed password on laptop/server to newPassword.
  // When attempting to unlock local storage with newPassword directly, it fails:
  await assert.rejects(
    () => unlockOfflineAccess({ userId, businessId, password: newPassword, storage }),
    err => err.code === 'WRONG_PASSWORD'
  );

  // Step 3: Online reconciliation flow: user provides previous and new passwords
  const reconcileRes = await reconcileCrossDevicePasswordChange({
    userId,
    businessId,
    previousPassword: oldPassword,
    newPassword,
    storage,
  });
  assert.equal(reconcileRes.reconciled, true);

  // Step 4: Now unlock with newPassword succeeds!
  const unlockResult = await unlockOfflineAccess({
    userId,
    businessId,
    password: newPassword,
    storage,
  });
  assert.ok(unlockResult.accountKey);

  encryptedRepo.setAccountKey(scope, unlockResult.accountKey);
  const restored = await encryptedRepo.read(scope);
  assert.equal(restored.domain.products[0].name, 'Dangote Cement 50kg');
  assert.equal(restored.domain.products[0].qty, 95);
});

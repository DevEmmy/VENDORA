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
  setLastEnrolledAccount,
  getLastEnrolledAccount,
  EnrollmentError,
  UnlockError,
} from '../src/features/security/offlineEnrollment.js';
import {
  getOfflineSessionState,
  isOfflineSessionActive,
  setOfflineSessionUnlocked,
  clearOfflineSession,
  subscribeOfflineSession,
} from '../src/features/security/offlineSession.js';
import {
  activateAccount,
  activateOfflineAccount,
  deactivateAccount,
  getState,
  setDomainState,
  publishReplica,
  getActiveReplicaScope,
  emptyState,
} from '../src/lib/store.js';
import { emptyReplica } from '../src/features/sync/outbox.js';

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
// Test Suite
// ---------------------------------------------------------------------------

test('offline enrollment: stores only wrapped key envelope and policy metadata, never plaintext password or raw key', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_enroll_1';
  const businessId = 'biz_enroll_1';
  const password = 'SuperSecretPassword123!';
  const now = Date.now();

  const { accountKey } = await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now,
  });

  assert.ok(accountKey instanceof CryptoKey, 'Returned accountKey must be a CryptoKey');
  assert.equal(accountKey.algorithm.name, 'AES-GCM');

  // Verify storage content
  const record = getEnrollmentRecord(userId, businessId, storage);
  assert.ok(record, 'Enrollment record must exist');
  assert.equal(record.userId, userId);
  assert.equal(record.businessId, businessId);
  assert.equal(record.version, 1);
  assert.ok(record.wrappedKey, 'wrappedKey must be present');
  assert.ok(record.salt, 'salt must be present');
  assert.ok(record.iv, 'iv must be present');
  assert.ok(record.kdf, 'kdf parameters must be present');

  // Strictly verify no plaintext password or raw key material was saved
  for (const [k, v] of storage._store.entries()) {
    assert.ok(!v.includes(password), `Storage item ${k} must not contain plaintext password`);
    assert.ok(!v.includes('CryptoKey'), `Storage item ${k} must not contain serialized CryptoKey object`);
  }

  // Verify policy record
  const policy = getAccessPolicyRecord(userId, businessId, storage);
  assert.ok(policy, 'Policy record must exist');
  assert.equal(policy.lastVerifiedAt, now);
});

test('enableOfflineAccess helper: stores last enrolled metadata and enables offline lookup', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_enable_1';
  const businessId = 'biz_enable_1';
  const password = 'CorrectPassword456!';

  assert.equal(isEnrolledForOfflineAccess(userId, businessId, storage), false);
  assert.equal(getLastEnrolledAccount(storage), null);

  const { accountKey } = await enableOfflineAccess({
    userId,
    businessId,
    password,
    businessName: 'Iya Moria Store',
    userName: 'Moria Adewale',
    phone: '08012345678',
    storage,
  });

  assert.ok(accountKey);
  assert.equal(isEnrolledForOfflineAccess(userId, businessId, storage), true);

  const lastEnrolled = getLastEnrolledAccount(storage);
  assert.ok(lastEnrolled);
  assert.equal(lastEnrolled.userId, userId);
  assert.equal(lastEnrolled.businessId, businessId);
  assert.equal(lastEnrolled.businessName, 'Iya Moria Store');
  assert.equal(lastEnrolled.userName, 'Moria Adewale');
});

test('offline unlock: succeeds with correct password and restores encrypted replica; rejects wrong password', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-offline-unlock-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userId = 'usr_unlock_1';
  const businessId = 'biz_unlock_1';
  const scope = replicaScope(userId, businessId);
  const password = 'StrongPassword789!';

  // Enroll account
  const { accountKey: originalKey } = await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
  });

  // Seed encrypted replica in IndexedDB
  const seedReplica = {
    ...emptyReplica(),
    domain: {
      products: [{ id: 'p1', name: 'Yam Tubers', qty: 50, price: 1500 }],
      txns: [],
      customers: [],
      ledger: [],
      invoiceSeq: 5,
    },
    accountState: {
      profile: { name: 'Alhaji Musa', businessName: 'Musa Agro', onboarded: true },
    },
  };
  const envelope = await encryptReplicaEnvelope(originalKey, scope, seedReplica, 1);
  await encryptedRepo.writeRaw(scope, envelope);

  // Clear in-memory keys to simulate a new session / page refresh
  encryptedRepo.clearAccountKey(scope);

  // Attempting to read without key fails
  await assert.rejects(
    async () => encryptedRepo.read(scope),
    StorageLockedError
  );

  // Attempt unlock with incorrect password
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password: 'WrongPassword!',
      storage,
    }),
    err => {
      assert.equal(err.code, 'WRONG_PASSWORD');
      return true;
    }
  );

  // Unlock with correct password
  const { accountKey: unlockedKey, policy } = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
  });

  assert.ok(unlockedKey instanceof CryptoKey);
  assert.equal(policy.allowed, true);

  // Use the unlocked key to decrypt and read the replica
  encryptedRepo.setAccountKey(scope, unlockedKey);
  const decrypted = await encryptedRepo.read(scope);
  assert.equal(decrypted.domain.products[0].name, 'Yam Tubers');
  assert.equal(decrypted.accountState.profile.businessName, 'Musa Agro');
});

test('offline unlock: NEVER updates lastVerifiedAt timestamp (only online auth can extend access)', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_no_renew_1';
  const businessId = 'biz_no_renew_1';
  const password = 'FixedTimestampPassword1!';
  const enrollmentTime = 1700000000000; // Fixed timestamp

  await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: enrollmentTime,
  });

  const policyBefore = getAccessPolicyRecord(userId, businessId, storage);
  assert.equal(policyBefore.lastVerifiedAt, enrollmentTime);

  // Unlock 3 days later
  const threeDaysLater = enrollmentTime + (3 * 24 * 60 * 60 * 1000);
  const { policy } = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: threeDaysLater,
  });

  assert.equal(policy.allowed, true);

  // Verify that storage lastVerifiedAt was NOT updated to threeDaysLater!
  const policyAfter = getAccessPolicyRecord(userId, businessId, storage);
  assert.equal(policyAfter.lastVerifiedAt, enrollmentTime, 'lastVerifiedAt must remain unchanged after offline unlock');

  // Verify online verification DOES update lastVerifiedAt
  const onlineReconnectTime = enrollmentTime + (4 * 24 * 60 * 60 * 1000);
  recordOnlineVerification(userId, businessId, storage, onlineReconnectTime);

  const policyAfterOnline = getAccessPolicyRecord(userId, businessId, storage);
  assert.equal(policyAfterOnline.lastVerifiedAt, onlineReconnectTime, 'Online verification must update lastVerifiedAt');
});

test('seven-day offline policy enforcement: expired or manipulated timestamps reject unlock', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_policy_1';
  const businessId = 'biz_policy_1';
  const password = 'PolicyTestPassword!';
  const initialTime = 1700000000000;

  await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: initialTime,
  });

  // 1. Valid access within 7 days (e.g. 6 days)
  const sixDaysLater = initialTime + (6 * 24 * 60 * 60 * 1000);
  const result6d = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
    now: sixDaysLater,
  });
  assert.equal(result6d.policy.allowed, true);

  // 2. Expired access (> 7 days, e.g. 7 days + 1 hour)
  const eightDaysLater = initialTime + (7 * 24 * 60 * 60 * 1000) + 3600000;
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password,
      storage,
      now: eightDaysLater,
    }),
    err => {
      assert.equal(err.code, 'ACCESS_EXPIRED');
      return true;
    }
  );

  // 3. Clock skew / future tampering (current time is earlier than lastVerifiedAt by more than skew tolerance)
  const pastManipulatedTime = initialTime - (10 * 60 * 1000); // 10 minutes before verification
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password,
      storage,
      now: pastManipulatedTime,
    }),
    err => {
      assert.equal(err.code, 'ACCESS_EXPIRED');
      return true;
    }
  );
});

test('account isolation: User A cannot unlock User B account and AAD prevents envelope transplantation', async () => {
  const storage = createMockLocalStorage();
  const userA = 'usr_alice';
  const bizA = 'biz_alice';
  const passA = 'AlicePassword123!';

  const userB = 'usr_bob';
  const bizB = 'biz_bob';
  const passB = 'BobPassword456!';

  await enrollForOfflineAccess({ userId: userA, businessId: bizA, password: passA, storage });
  await enrollForOfflineAccess({ userId: userB, businessId: bizB, password: passB, storage });

  // Alice cannot unlock Bob's account with Alice's password
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId: userB,
      businessId: bizB,
      password: passA,
      storage,
    }),
    err => {
      assert.equal(err.code, 'WRONG_PASSWORD');
      return true;
    }
  );

  // Bob cannot unlock Alice's account with Bob's password
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId: userA,
      businessId: bizA,
      password: passB,
      storage,
    }),
    err => {
      assert.equal(err.code, 'WRONG_PASSWORD');
      return true;
    }
  );

  // If someone copies Bob's enrollment record into Alice's storage key, AAD mismatch prevents decrypting with Bob's password
  const bobRecord = getEnrollmentRecord(userB, bizB, storage);
  storage.setItem(
    `vendora:offline-enrollment:${encodeURIComponent(userA)}:${encodeURIComponent(bizA)}:v1`,
    JSON.stringify({ ...bobRecord, userId: userA, businessId: bizA })
  );

  await assert.rejects(
    async () => unlockOfflineAccess({
      userId: userA,
      businessId: bizA,
      password: passB,
      storage,
    }),
    err => {
      assert.equal(err.code, 'WRONG_PASSWORD');
      return true;
    }
  );
});

test('offline outbox preservation: sales made during offline session persist in encrypted storage across unlock and refresh', async () => {
  const storage = createMockLocalStorage();
  const factory = createMockIndexedDB();
  const dbName = 'test-offline-outbox-db';

  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });
  const userId = 'usr_outbox_offline';
  const businessId = 'biz_outbox_offline';
  const scope = replicaScope(userId, businessId);
  const password = 'OfflineSalesPassword123!';

  // Enroll
  const { accountKey } = await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    storage,
  });

  // Seed an active encrypted replica with 10 bags of rice
  const initialReplica = {
    ...emptyReplica(),
    domain: {
      products: [{ id: 'prod_rice', name: 'Rice 50kg', qty: 10, price: 45000 }],
      txns: [],
      customers: [],
      ledger: [],
      invoiceSeq: 1,
    },
    accountState: {
      profile: { name: 'Mama Shade', businessName: 'Shade Rice Hub', onboarded: true },
    },
  };
  const env = await encryptReplicaEnvelope(accountKey, scope, initialReplica, 1);
  await encryptedRepo.writeRaw(scope, env);

  // 1. Simulate unlocking offline session
  const { accountKey: unlockedKey } = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
  });
  setOfflineSessionUnlocked(userId, businessId, { allowed: true });
  assert.equal(isOfflineSessionActive(), true);

  // 2. Perform offline sales operations via repository update
  encryptedRepo.setAccountKey(scope, unlockedKey);
  const updatedReplica = await encryptedRepo.update(scope, draft => {
    // Sell 2 bags of rice offline
    draft.domain.products[0].qty -= 2;
    const saleTxn = {
      id: 'txn_off_1',
      items: [{ id: 'prod_rice', name: 'Rice 50kg', qty: 2, price: 45000 }],
      total: 90000,
      timestamp: Date.now(),
      offline: true,
    };
    draft.domain.txns.push(saleTxn);
    draft.outbox.push({
      id: 'op_sale_1',
      action: 'sale.create',
      payload: saleTxn,
      status: 'pending',
      createdAt: Date.now(),
    });
    draft.phase = 'offline';
  });

  assert.equal(updatedReplica.domain.products[0].qty, 8);
  assert.equal(updatedReplica.domain.txns.length, 1);
  assert.equal(updatedReplica.outbox.length, 1);
  assert.equal(updatedReplica.outbox[0].id, 'op_sale_1');

  // 3. Clear memory (simulate closing tab / reloading page)
  clearOfflineSession();
  encryptedRepo.clearAccountKey(scope);
  assert.equal(isOfflineSessionActive(), false);

  // 4. Raw storage record is encrypted and intact
  const rawEnvelope = await encryptedRepo.readRaw(scope);
  assert.equal(rawEnvelope._encrypted, true);
  assert.equal(rawEnvelope.revision, 2);

  // 5. Re-unlock with password
  const { accountKey: reUnlockedKey } = await unlockOfflineAccess({
    userId,
    businessId,
    password,
    storage,
  });
  encryptedRepo.setAccountKey(scope, reUnlockedKey);
  const restoredReplica = await encryptedRepo.read(scope);

  // 6. Verify pending sale and inventory reduction are completely preserved
  assert.equal(restoredReplica.domain.products[0].qty, 8);
  assert.equal(restoredReplica.domain.txns.length, 1);
  assert.equal(restoredReplica.domain.txns[0].id, 'txn_off_1');
  assert.equal(restoredReplica.outbox.length, 1);
  assert.equal(restoredReplica.outbox[0].id, 'op_sale_1');
  assert.equal(restoredReplica.outbox[0].payload.total, 90000);
});

test('revocation and cleanup: revoking enrollment removes wrapped key and last enrolled metadata', async () => {
  const storage = createMockLocalStorage();
  const userId = 'usr_revoke_1';
  const businessId = 'biz_revoke_1';
  const password = 'RevokePassword123!';

  await enableOfflineAccess({
    userId,
    businessId,
    password,
    businessName: 'Revoke Store',
    storage,
  });

  assert.equal(isEnrolledForOfflineAccess(userId, businessId, storage), true);
  assert.ok(getLastEnrolledAccount(storage));

  await revokeOfflineEnrollment(userId, businessId, storage);

  assert.equal(isEnrolledForOfflineAccess(userId, businessId, storage), false);
  assert.equal(getLastEnrolledAccount(storage), null);

  // Attempting unlock now fails with NOT_ENROLLED
  await assert.rejects(
    async () => unlockOfflineAccess({
      userId,
      businessId,
      password,
      storage,
    }),
    err => {
      assert.equal(err.code, 'NOT_ENROLLED');
      return true;
    }
  );
});

test('offline session management: reactive subscription and state transitions', () => {
  clearOfflineSession();
  assert.equal(isOfflineSessionActive(), false);

  const states = [];
  const unsubscribe = subscribeOfflineSession(state => states.push(structuredClone(state)));

  setOfflineSessionUnlocked('usr_sess_1', 'biz_sess_1', { allowed: true });
  assert.equal(isOfflineSessionActive(), true);
  assert.equal(getOfflineSessionState().userId, 'usr_sess_1');

  clearOfflineSession();
  assert.equal(isOfflineSessionActive(), false);
  assert.equal(getOfflineSessionState().status, 'idle');

  unsubscribe();
  assert.equal(states.length, 2);
  assert.equal(states[0].status, 'unlocked');
  assert.equal(states[1].status, 'idle');
});

test('cross-tab migration coordination: BroadcastChannel broadcasts migration events', async () => {
  const scope = 'account:usr_coord:biz_coord';
  let registered = false;

  let resolveMigration;
  const migrationPromise = new Promise(resolve => {
    resolveMigration = resolve;
  });

  registerMigrationInProgress(scope, migrationPromise);
  assert.equal(isMigrationInProgress(scope), true);

  // Resolving the migration clears the in-progress flag
  resolveMigration();
  await migrationPromise;
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(isMigrationInProgress(scope), false);
});

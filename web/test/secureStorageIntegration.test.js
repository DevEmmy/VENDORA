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
  RevisionConflictError,
} from '../src/features/security/encryptedReplicaRepository.js';
import {
  createReplicaRepository,
  replicaScope,
} from '../src/features/sync/replicaRepository.js';
import {
  createAccountStorage,
  registerMigrationInProgress,
  waitForMigration,
} from '../src/features/security/accountStorage.js';
import { emptyReplica } from '../src/features/sync/outbox.js';
import {
  activateAccount,
  deactivateAccount,
  getState,
  setDomainState,
  setState,
  publishReplica,
  isSecureAccountActive,
  getActiveReplicaScope,
  emptyState,
} from '../src/lib/store.js';
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

test('legacy repository hard barrier: reading encrypted record aborts transaction and rejects safely', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'barrier-test-db-1';
  const legacyRepo = createReplicaRepository(factory, dbName);
  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });

  const userId = 'usr_barrier_1';
  const businessId = 'biz_barrier_1';
  const scope = replicaScope(userId, businessId);
  const accountKey = await createAccountKey();

  // Create an encrypted replica in IndexedDB
  const sampleReplica = {
    ...emptyReplica(),
    domain: {
      products: [{ id: 'p1', name: 'Milo 500g', qty: 10, price: 2500 }],
      txns: [],
      customers: [],
      ledger: [],
      invoiceSeq: 1,
    },
  };
  const envelope = await encryptReplicaEnvelope(accountKey, scope, sampleReplica, 1);
  await encryptedRepo.writeRaw(scope, envelope);

  // Attempting to read via legacy repository MUST abort and reject
  await assert.rejects(
    async () => {
      await legacyRepo.read(scope);
    },
    error => {
      assert.equal(error.code, 'ENCRYPTED_ACCOUNT_RECORD');
      assert.match(error.message, /encrypted/i);
      return true;
    }
  );

  // Raw record in storage remains 100% untouched
  const afterRaw = await encryptedRepo.readRaw(scope);
  assert.equal(afterRaw._encrypted, true);
  assert.equal(afterRaw.revision, 1);
  assert.equal(afterRaw.ciphertext, envelope.ciphertext);
});

test('legacy repository hard barrier: writing or modifying encrypted record aborts without overwriting ciphertext', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'barrier-test-db-2';
  const legacyRepo = createReplicaRepository(factory, dbName);
  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });

  const userId = 'usr_barrier_2';
  const businessId = 'biz_barrier_2';
  const scope = replicaScope(userId, businessId);
  const accountKey = await createAccountKey();

  const sampleReplica = {
    ...emptyReplica(),
    domain: {
      products: [{ id: 'p2', name: 'Golden Penny Sugar', qty: 50, price: 800 }],
      txns: [],
      customers: [],
      ledger: [],
      invoiceSeq: 1,
    },
  };
  const envelope = await encryptReplicaEnvelope(accountKey, scope, sampleReplica, 1);
  await encryptedRepo.writeRaw(scope, envelope);

  // Attempting to update via legacy repository MUST abort before applying change
  let changeInvoked = false;
  await assert.rejects(
    async () => {
      await legacyRepo.update(scope, draft => {
        changeInvoked = true;
        draft.domain.products[0].qty = 0;
      });
    },
    error => {
      assert.equal(error.code, 'ENCRYPTED_ACCOUNT_RECORD');
      return true;
    }
  );

  assert.equal(changeInvoked, false, 'Legacy update callback must not be invoked on encrypted record');

  // Verify that the record is still encrypted with untouched data
  encryptedRepo.setAccountKey(scope, accountKey);
  const decrypted = await encryptedRepo.read(scope);
  assert.equal(decrypted.domain.products[0].qty, 50);
});

test('legacy repository hard barrier: in-flight migration envelope is protected from legacy reads and writes', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'barrier-test-db-3';
  const legacyRepo = createReplicaRepository(factory, dbName);
  const encryptedRepo = createEncryptedReplicaRepository({ factory, dbName });

  const scope = 'usr_stage:biz_stage';
  await encryptedRepo.writeRaw(scope, {
    _migrationEnvelope: true,
    stage: 'staged',
    data: 'in-flight-ciphertext',
  });

  // Reading must fail
  await assert.rejects(
    async () => {
      await legacyRepo.read(scope);
    },
    err => err.code === 'ENCRYPTED_ACCOUNT_RECORD'
  );

  // Updating must fail
  await assert.rejects(
    async () => {
      await legacyRepo.update(scope, () => {});
    },
    err => err.code === 'ENCRYPTED_ACCOUNT_RECORD'
  );
});

test('account repository routing: disallows silent fallback to legacy repository when encrypted', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'router-test-db';
  const legacy = createReplicaRepository(factory, dbName);
  const encrypted = createEncryptedReplicaRepository({ factory, dbName });
  const storage = createAccountStorage({ legacy, encrypted });

  const userId = 'usr_router';
  const businessId = 'biz_router';
  const scope = replicaScope(userId, businessId);
  const accountKey = await createAccountKey();

  // Initially unencrypted: legacy repository handles reads and writes
  const legacyRecord = await storage.update(scope, draft => {
    draft.domain = { products: [{ id: 'lp1', name: 'Plain Rice', qty: 5 }] };
  });
  assert.equal(legacyRecord.domain.products[0].qty, 5);

  // Now encrypt the scope
  const envelope = await encryptReplicaEnvelope(accountKey, scope, legacyRecord, 1);
  await storage.writeRaw(scope, envelope);

  // With encrypted envelope in storage but NO key in memory:
  // MUST fail closed with StorageLockedError and NEVER fall back to legacy repository
  await assert.rejects(
    async () => {
      await storage.read(scope);
    },
    err => {
      assert.equal(err.name, 'StorageLockedError');
      return true;
    }
  );

  // Now register key: reads and updates succeed via encrypted repository
  storage.setAccountKey(scope, accountKey);
  const readBack = await storage.read(scope);
  assert.equal(readBack.domain.products[0].qty, 5);

  const updated = await storage.update(scope, draft => {
    draft.domain.products[0].qty = 20;
  });
  assert.equal(updated.domain.products[0].qty, 20);

  // Confirm that storage is at revision 2 and encrypted
  const rawAfter = await storage.readRaw(scope);
  assert.equal(rawAfter._encrypted, true);
  assert.equal(rawAfter.revision, 2);
});

test('multi-tab concurrent writes: independent repository instances coordinate and resolve revision conflicts', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'concurrency-test-db';
  const tabA = createEncryptedReplicaRepository({ factory, dbName });
  const tabB = createEncryptedReplicaRepository({ factory, dbName });

  const scope = 'usr_multitab:biz_multitab';
  const accountKey = await createAccountKey();
  tabA.setAccountKey(scope, accountKey);
  tabB.setAccountKey(scope, accountKey);

  // Initialize
  await tabA.update(scope, draft => {
    draft.domain = {
      salesCount: 0,
      sales: [],
    };
  });

  // Concurrently execute 4 writes from Tab A and 4 writes from Tab B
  const writesA = Array.from({ length: 4 }, (_, i) =>
    tabA.update(scope, draft => {
      draft.domain.salesCount++;
      draft.domain.sales.push(`TabA_Sale_${i}`);
    })
  );

  const writesB = Array.from({ length: 4 }, (_, i) =>
    tabB.update(scope, draft => {
      draft.domain.salesCount++;
      draft.domain.sales.push(`TabB_Sale_${i}`);
    })
  );

  await Promise.all([...writesA, ...writesB]);

  const finalReplica = await tabA.read(scope);
  assert.equal(finalReplica.domain.salesCount, 8);
  assert.equal(finalReplica.domain.sales.length, 8);

  const raw = await tabA.readRaw(scope);
  assert.equal(raw.revision, 9); // Initial (1) + 8 writes
});

test('session teardown: account key is wiped from memory on lock and locked storage rejects', async () => {
  const factory = createMockIndexedDB();
  const dbName = 'teardown-test-db';
  const legacy = createReplicaRepository(factory, dbName);
  const encrypted = createEncryptedReplicaRepository({ factory, dbName });
  const storage = createAccountStorage({ legacy, encrypted });

  const scope = 'usr_td:biz_td';
  const accountKey = await createAccountKey();
  storage.setAccountKey(scope, accountKey);

  await storage.update(scope, draft => {
    draft.domain = { secretData: 'Confidential Business Ledger' };
  });

  // Key is currently present
  assert.ok(storage.getAccountKey(scope));

  // Lock / session teardown
  storage.clearAccountKey(scope);
  assert.equal(storage.getAccountKey(scope), null);

  // Subsequent read without key MUST fail closed
  await assert.rejects(
    async () => {
      await storage.read(scope);
    },
    err => err.name === 'StorageLockedError'
  );

  // Legacy repository attempt also rejects
  await assert.rejects(
    async () => {
      await legacy.read(scope);
    },
    err => err.code === 'ENCRYPTED_ACCOUNT_RECORD'
  );
});

test('migration coordination: account writes wait for active migration before executing', async () => {
  const scope = 'usr_coord:biz_coord';
  let migrationFinished = false;

  const migrationPromise = new Promise(resolve => {
    setTimeout(() => {
      migrationFinished = true;
      resolve({ status: 'migrated' });
    }, 50);
  });

  registerMigrationInProgress(scope, migrationPromise);

  let writeExecuted = false;
  const writeOperation = (async () => {
    await waitForMigration(scope);
    writeExecuted = true;
  })();

  assert.equal(migrationFinished, false);
  assert.equal(writeExecuted, false);

  await writeOperation;
  assert.equal(migrationFinished, true);
  assert.equal(writeExecuted, true);
});

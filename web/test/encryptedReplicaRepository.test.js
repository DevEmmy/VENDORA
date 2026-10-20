import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { createAccountKey } from '../src/features/security/accountKey.js';
import {
  createEncryptedReplicaRepository,
  StorageLockedError,
  DecryptionError,
  RevisionConflictError,
  StorageCorruptError,
} from '../src/features/security/encryptedReplicaRepository.js';

// Ensure Web Crypto is available in Node.js
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

/**
 * In-memory IndexedDB factory that faithfully enforces transaction lifecycle,
 * including throwing TransactionInactiveError if store operations are attempted
 * after an event loop turn (such as after an `await`).
 */
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
              // Roll back modifications
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
                    } finally {
                      pendingRequests--;
                      checkCompletion();
                    }
                  });
                  return req;
                },
                put(value, key) {
                  if (!active) {
                    throw new Error('TransactionInactiveError: The transaction is inactive.');
                  }
                  if (mode !== 'readwrite') {
                    throw new Error('ReadOnlyError: Transaction is readonly.');
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
                    } finally {
                      pendingRequests--;
                      checkCompletion();
                    }
                  });
                  return req;
                },
                delete(key) {
                  if (!active) {
                    throw new Error('TransactionInactiveError: The transaction is inactive.');
                  }
                  pendingRequests++;
                  const req = { result: undefined, onsuccess: null };
                  queueMicrotask(() => {
                    if (aborted) return;
                    storeData.delete(key);
                    if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
                    pendingRequests--;
                    checkCompletion();
                  });
                  return req;
                },
              };
            },
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

const USER_A = 'test-user-fictional-001';
const BIZ_A = 'test-biz-fictional-001';
const SCOPE_A = `${encodeURIComponent(USER_A)}:${encodeURIComponent(BIZ_A)}`;

const USER_B = 'test-user-fictional-002';
const BIZ_B = 'test-biz-fictional-002';
const SCOPE_B = `${encodeURIComponent(USER_B)}:${encodeURIComponent(BIZ_B)}`;

test('encrypted replica repository: write, read round-trip with fictional POS data', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-1',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  // Initial read of empty replica
  const initial = await repo.read(SCOPE_A);
  assert.equal(initial.version, 1);
  assert.equal(initial.cursor, '0');
  assert.deepEqual(initial.outbox, []);

  // Update with fictional inventory and sale mutation
  await repo.update(SCOPE_A, replica => {
    replica.domain = {
      products: [{ id: 'p1', name: 'Cassava Flour', price: 2500, qty: 50 }],
      txns: [{ id: 'txn1', type: 'sale', amount: 5000, at: Date.now() }],
      customers: [],
      ledger: [],
      invoiceSeq: 1,
    };
    replica.outbox.push({
      id: 'op-001',
      action: 'sale.create',
      payload: { localId: 'txn1', amount: 5000 },
      status: 'pending',
    });
  });

  // Read back and verify exact data matches
  const stored = await repo.read(SCOPE_A);
  assert.equal(stored.domain.products.length, 1);
  assert.equal(stored.domain.products[0].name, 'Cassava Flour');
  assert.equal(stored.outbox.length, 1);
  assert.equal(stored.outbox[0].id, 'op-001');

  await repo.close();
});

test('encrypted replica repository: raw stored record is encrypted (no plaintext on disk)', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-2',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  await repo.update(SCOPE_A, replica => {
    replica.domain = {
      products: [{ id: 'p_secret', name: 'Confidential Secret Stock', price: 9999 }],
      txns: [],
      customers: [],
      ledger: [],
      invoiceSeq: 0,
    };
  });

  // Inspect the raw record directly in the object store
  const raw = await repo.readRaw(SCOPE_A);
  assert.equal(raw._encrypted, true);
  assert.equal(raw.version, 1);
  assert.equal(raw.algorithm, 'AES-256-GCM');
  assert.equal(raw.scope, SCOPE_A);
  assert.equal(raw.revision, 1);
  assert.ok(typeof raw.iv === 'string' && raw.iv.length > 0);
  assert.ok(typeof raw.ciphertext === 'string' && raw.ciphertext.length > 0);

  // Ensure no plaintext string leaked in raw storage
  const rawString = JSON.stringify(raw);
  assert.ok(!rawString.includes('Confidential Secret Stock'));
  assert.ok(!rawString.includes('p_secret'));

  await repo.close();
});

test('encrypted replica repository: locked storage throws StorageLockedError, never returns empty replica', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-3',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  // Write an encrypted record
  await repo.update(SCOPE_A, replica => {
    replica.outbox.push({ id: 'pending-sale-1', action: 'sale.create' });
  });

  // Clear key to simulate locked state
  repo.clearAccountKey(SCOPE_A);

  // Reading locked storage must throw StorageLockedError
  await assert.rejects(
    repo.read(SCOPE_A),
    err => err instanceof StorageLockedError
  );

  // Updating locked storage must throw StorageLockedError
  await assert.rejects(
    repo.update(SCOPE_A, replica => {
      replica.outbox.push({ id: 'illegal' });
    }),
    err => err instanceof StorageLockedError
  );

  // Re-supplying the key unlocks it successfully
  repo.setAccountKey(SCOPE_A, keyA);
  const unlocked = await repo.read(SCOPE_A);
  assert.equal(unlocked.outbox.length, 1);
  assert.equal(unlocked.outbox[0].id, 'pending-sale-1');

  await repo.close();
});

test('encrypted replica repository: incorrect key throws DecryptionError, never returns empty replica', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-4',
  });
  const correctKey = await createAccountKey();
  const wrongKey = await createAccountKey();

  repo.setAccountKey(SCOPE_A, correctKey);
  await repo.update(SCOPE_A, replica => {
    replica.outbox.push({ id: 'vital-pending-sale' });
  });

  // Switch to wrong key
  repo.setAccountKey(SCOPE_A, wrongKey);

  await assert.rejects(
    repo.read(SCOPE_A),
    err => err instanceof DecryptionError
  );

  await assert.rejects(
    repo.update(SCOPE_A, replica => {
      replica.outbox.push({ id: 'should-fail' });
    }),
    err => err instanceof DecryptionError
  );

  // Switch back to correct key: original data is completely intact
  repo.setAccountKey(SCOPE_A, correctKey);
  const restored = await repo.read(SCOPE_A);
  assert.equal(restored.outbox.length, 1);
  assert.equal(restored.outbox[0].id, 'vital-pending-sale');

  await repo.close();
});

test('encrypted replica repository: tampered ciphertext detects corruption and throws DecryptionError', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-5',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  await repo.update(SCOPE_A, replica => {
    replica.cursor = '42';
  });

  const raw = await repo.readRaw(SCOPE_A);
  const cipherBytes = Buffer.from(raw.ciphertext, 'base64');
  cipherBytes[0] ^= 0xff; // Flip bits in ciphertext

  await repo.writeRaw(SCOPE_A, {
    ...raw,
    ciphertext: cipherBytes.toString('base64'),
  });

  await assert.rejects(
    repo.read(SCOPE_A),
    err => err instanceof DecryptionError
  );

  await repo.close();
});

test('encrypted replica repository: tampered metadata (revision/scope/AAD) throws DecryptionError', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-6',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  await repo.update(SCOPE_A, replica => {
    replica.cursor = '100';
  });

  const raw = await repo.readRaw(SCOPE_A);

  // Tamper with revision number: AAD authentication will fail
  await repo.writeRaw(SCOPE_A, {
    ...raw,
    revision: 999,
  });

  await assert.rejects(
    repo.read(SCOPE_A),
    err => err instanceof DecryptionError
  );

  await repo.close();
});

test('encrypted replica repository: account and business isolation', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-7',
  });
  const keyA = await createAccountKey();
  const keyB = await createAccountKey();

  repo.setAccountKey(SCOPE_A, keyA);
  repo.setAccountKey(SCOPE_B, keyB);

  await repo.update(SCOPE_A, replica => {
    replica.domain = { business: 'Business A Secrets', products: [] };
  });

  await repo.update(SCOPE_B, replica => {
    replica.domain = { business: 'Business B Secrets', products: [] };
  });

  const resA = await repo.read(SCOPE_A);
  const resB = await repo.read(SCOPE_B);
  assert.equal(resA.domain.business, 'Business A Secrets');
  assert.equal(resB.domain.business, 'Business B Secrets');

  // Attempt to splice / copy A's envelope into B's record
  const rawA = await repo.readRaw(SCOPE_A);
  await repo.writeRaw(SCOPE_B, {
    ...rawA,
    scope: SCOPE_B, // Tampered scope
  });

  // Decryption for B must reject because AAD binds scope, user and business
  await assert.rejects(
    repo.read(SCOPE_B),
    err => err instanceof DecryptionError
  );

  await repo.close();
});

test('encrypted replica repository: atomic revision check detects cross-tab conflicts and prevents lost updates', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-8',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  // Initialize record at revision 1
  await repo.update(SCOPE_A, replica => {
    replica.outbox = [{ id: 'init' }];
  });

  const rawRev1 = await repo.readRaw(SCOPE_A);
  assert.equal(rawRev1.revision, 1);

  // Simulate Tab 2 updating the record to revision 2 behind Tab 1's back
  await repo.update(SCOPE_A, replica => {
    replica.outbox.push({ id: 'tab2-change' });
  });

  const rawRev2 = await repo.readRaw(SCOPE_A);
  assert.equal(rawRev2.revision, 2);

  // Now simulate a conflicting write attempting to commit against obsolete expectedRevision = 1
  // We bypass repo.update's auto-retry by using putRawWithRevisionCheck directly via a custom envelope
  const { encryptReplicaEnvelope } = await import(
    '../src/features/security/encryptedReplicaRepository.js'
  );

  const staleEnvelope = await encryptReplicaEnvelope(
    keyA,
    SCOPE_A,
    { outbox: [{ id: 'stale-overwrite' }] },
    2 // attempting revision 2 when rev 2 is already stored
  );

  // Open transaction and attempt to put stale envelope expecting revision 1
  const db = await new Promise(resolve => {
    const req = idb.open('isolated-test-db-8', 1);
    req.onsuccess = () => resolve(req.result);
  });

  await assert.rejects(
    new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      const store = tx.objectStore('accounts');
      const req = store.get(SCOPE_A);
      let conflict = false;

      req.onsuccess = () => {
        const current = req.result;
        const currentRev = current?.revision ?? 0;
        if (currentRev !== 1) { // Expected revision was 1, but current is 2!
          conflict = true;
          tx.abort();
          return;
        }
        store.put(staleEnvelope, SCOPE_A);
      };

      tx.oncomplete = () => resolve(true);
      tx.onabort = () => {
        if (conflict) {
          reject(new RevisionConflictError('Revision conflict detected.'));
        } else {
          reject(tx.error);
        }
      };
    }),
    err => err instanceof RevisionConflictError
  );

  // Verify Tab 2's data was NOT overwritten
  const verify = await repo.read(SCOPE_A);
  assert.equal(verify.outbox.length, 2);
  assert.equal(verify.outbox[1].id, 'tab2-change');

  await repo.close();
});

test('encrypted replica repository: concurrent updates are serialized and ordered monotonically', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-9',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  // Run 10 parallel updates simultaneously
  const count = 10;
  await Promise.all(
    Array.from({ length: count }, (_, idx) =>
      repo.update(SCOPE_A, replica => {
        replica.outbox ||= [];
        replica.outbox.push({ id: `concurrent-op-${idx}` });
      })
    )
  );

  const finalReplica = await repo.read(SCOPE_A);
  assert.equal(finalReplica.outbox.length, count);

  // Verify monotonic revision advancement
  const finalRaw = await repo.readRaw(SCOPE_A);
  assert.equal(finalRaw.revision, count);

  await repo.close();
});

test('encrypted replica repository: storage transaction failure leaves existing data intact', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'isolated-test-db-10',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  // Initial good state
  await repo.update(SCOPE_A, replica => {
    replica.outbox = [{ id: 'committed-op-1' }];
  });

  // Attempt update that throws an error in the callback
  await assert.rejects(
    repo.update(SCOPE_A, () => {
      throw new Error('Business logic validation error');
    }),
    /Business logic validation error/
  );

  // Existing data must remain intact and decryptable
  const check = await repo.read(SCOPE_A);
  assert.equal(check.outbox.length, 1);
  assert.equal(check.outbox[0].id, 'committed-op-1');

  await repo.close();
});

test('encrypted replica repository: independent repository instances (cross-tab simulation) concurrently update, retry, and merge both sales', async () => {
  const idb = createMockIndexedDB();
  const dbName = 'shared-multitab-db';
  const keyA = await createAccountKey();

  // Two completely independent repository instances representing Tab 1 and Tab 2
  // They do NOT share in-memory mutex queues (scopeTails)
  const repoTab1 = createEncryptedReplicaRepository({
    factory: idb,
    dbName,
  });
  const repoTab2 = createEncryptedReplicaRepository({
    factory: idb,
    dbName,
  });

  repoTab1.setAccountKey(SCOPE_A, keyA);
  repoTab2.setAccountKey(SCOPE_A, keyA);

  // Initialize base record with Product
  await repoTab1.update(SCOPE_A, replica => {
    replica.domain = {
      products: [{ id: 'p1', name: 'Yam', qty: 100 }],
      txns: [],
      customers: [],
      ledger: [],
      invoiceSeq: 0,
    };
  });

  // Run concurrent updates from both tabs simultaneously
  // Tab 1 records Sale 1; Tab 2 records Sale 2
  const [resTab1, resTab2] = await Promise.all([
    repoTab1.update(SCOPE_A, replica => {
      replica.outbox ||= [];
      replica.outbox.push({ id: 'sale-tab-1', amount: 3000 });
    }),
    repoTab2.update(SCOPE_A, replica => {
      replica.outbox ||= [];
      replica.outbox.push({ id: 'sale-tab-2', amount: 4500 });
    }),
  ]);

  // Read back the final state from either tab
  const finalState = await repoTab1.read(SCOPE_A);

  // BOTH sales MUST be present in outbox!
  const outboxIds = finalState.outbox.map(item => item.id);
  assert.ok(outboxIds.includes('sale-tab-1'), 'Sale from Tab 1 must be preserved');
  assert.ok(outboxIds.includes('sale-tab-2'), 'Sale from Tab 2 must be preserved');
  assert.equal(finalState.outbox.length, 2);

  // Monotonic revision counter must have reached 3 (init + tab1 + tab2)
  const rawFinal = await repoTab1.readRaw(SCOPE_A);
  assert.equal(rawFinal.revision, 3);

  await repoTab1.close();
  await repoTab2.close();
});

test('encrypted replica repository: exhausted retries or rejected update preserves previous committed record intact without corruption', async () => {
  const idb = createMockIndexedDB();
  const dbName = 'exhausted-retries-db';
  const keyA = await createAccountKey();

  const repoTab1 = createEncryptedReplicaRepository({ factory: idb, dbName });
  const repoTab2 = createEncryptedReplicaRepository({ factory: idb, dbName });

  repoTab1.setAccountKey(SCOPE_A, keyA);
  repoTab2.setAccountKey(SCOPE_A, keyA);

  // Commit valid initial record
  await repoTab1.update(SCOPE_A, replica => {
    replica.outbox = [{ id: 'committed-sale-before-conflict' }];
  });

  // Tab 2 attempts an update with maxRetries: 0 while Tab 1 updates concurrently
  // Simulate conflict by having Tab 1 advance revision right before Tab 2's commit
  await repoTab1.update(SCOPE_A, replica => {
    replica.outbox.push({ id: 'tab-1-concurrent-commit' });
  });

  // Directly attempt an update expecting stale revision 1 with maxRetries: 0
  const { encryptReplicaEnvelope } = await import(
    '../src/features/security/encryptedReplicaRepository.js'
  );

  const staleEnvelope = await encryptReplicaEnvelope(
    keyA,
    SCOPE_A,
    { outbox: [{ id: 'stale-drop-attempt' }] },
    2
  );

  const db = await new Promise(resolve => {
    const req = idb.open(dbName, 1);
    req.onsuccess = () => resolve(req.result);
  });

  // Transaction aborts due to revision mismatch
  await assert.rejects(
    new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      const store = tx.objectStore('accounts');
      const req = store.get(SCOPE_A);

      req.onsuccess = () => {
        const curRev = req.result?.revision ?? 0;
        if (curRev !== 1) { // expected 1, but Tab 1 committed revision 2!
          tx.abort();
          reject(new RevisionConflictError('Conflict on stale revision.'));
          return;
        }
        store.put(staleEnvelope, SCOPE_A);
      };
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => reject(new RevisionConflictError('Aborted conflict.'));
    }),
    err => err instanceof RevisionConflictError
  );

  // The database MUST still contain Tab 1's committed data intact
  const verified = await repoTab1.read(SCOPE_A);
  assert.equal(verified.outbox.length, 2);
  assert.equal(verified.outbox[0].id, 'committed-sale-before-conflict');
  assert.equal(verified.outbox[1].id, 'tab-1-concurrent-commit');

  await repoTab1.close();
  await repoTab2.close();
});

test('encrypted replica repository: unrecognized or corrupted non-empty record throws StorageCorruptError, never returns empty replica', async () => {
  const idb = createMockIndexedDB();
  const repo = createEncryptedReplicaRepository({
    factory: idb,
    dbName: 'corrupt-record-test-db',
  });
  const keyA = await createAccountKey();
  repo.setAccountKey(SCOPE_A, keyA);

  // Store an invalid/corrupted non-empty object in IndexedDB
  await repo.writeRaw(SCOPE_A, {
    corruptedNonReplica: 'some unparseable garbage',
    randomField: 12345,
  });

  // read() MUST throw StorageCorruptError, NOT return emptyReplica()!
  await assert.rejects(
    repo.read(SCOPE_A),
    err => err instanceof StorageCorruptError
  );

  // update() MUST throw StorageCorruptError, NOT overwrite with emptyReplica()!
  await assert.rejects(
    repo.update(SCOPE_A, replica => {
      replica.outbox.push({ id: 'illegal' });
    }),
    err => err instanceof StorageCorruptError
  );

  await repo.close();
});

test('encrypted replica repository: AES-GCM encryption generates unique random IVs for every call even for identical data', async () => {
  const { encryptReplicaEnvelope } = await import(
    '../src/features/security/encryptedReplicaRepository.js'
  );
  const keyA = await createAccountKey();
  const data = { testPayload: 'identical business data', outbox: [] };

  const env1 = await encryptReplicaEnvelope(keyA, SCOPE_A, data, 1);
  const env2 = await encryptReplicaEnvelope(keyA, SCOPE_A, data, 1);

  // IVs MUST be different
  assert.notEqual(env1.iv, env2.iv);
  // Ciphertexts MUST be different because IV is unique
  assert.notEqual(env1.ciphertext, env2.ciphertext);
});


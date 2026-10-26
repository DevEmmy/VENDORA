import { emptyReplica } from '../sync/outbox.js';
import { replicaScope } from '../sync/replicaRepository.js';

export class StorageLockedError extends Error {
  constructor(message = 'Encrypted account storage is locked.') {
    super(message);
    this.name = 'StorageLockedError';
  }
}

export class DecryptionError extends Error {
  constructor(
    message = 'Unable to decrypt account storage. Key may be incorrect or record has been tampered with.'
  ) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export class RevisionConflictError extends Error {
  constructor(
    message = 'Concurrent update detected on offline account storage.'
  ) {
    super(message);
    this.name = 'RevisionConflictError';
  }
}

export class StorageCorruptError extends Error {
  constructor(message = 'Invalid or corrupted encrypted record.') {
    super(message);
    this.name = 'StorageCorruptError';
  }
}

const VERSION = 1;
const CRYPTO_ALGORITHM = 'AES-GCM';
const ALGORITHM_NAME = 'AES-256-GCM';
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) {
    throw new Error('Secure offline encryption is unavailable on this device.');
  }
  return cryptoApi;
}

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== 'string') {
    throw new Error('Invalid base64 value.');
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function parseScope(scope) {
  if (typeof scope !== 'string' || !scope) {
    return { userId: '', businessId: '' };
  }
  const parts = scope.split(':');
  if (parts.length >= 2) {
    return {
      userId: decodeURIComponent(parts[0]),
      businessId: decodeURIComponent(parts.slice(1).join(':')),
    };
  }
  return { userId: scope, businessId: scope };
}

function buildAad({ version, scope, revision, userId, businessId }) {
  return encoder.encode(
    JSON.stringify({
      version,
      scope,
      revision,
      userId,
      businessId,
    })
  );
}

export async function encryptReplicaEnvelope(accountKey, scope, replica, revision) {
  if (!accountKey) {
    throw new StorageLockedError('Encrypted account storage is locked.');
  }
  if (typeof revision !== 'number' || revision < 1) {
    throw new Error('A valid positive revision number is required.');
  }

  const cryptoApi = getCrypto();
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
  const { userId, businessId } = parseScope(scope);

  const aad = buildAad({
    version: VERSION,
    scope,
    revision,
    userId,
    businessId,
  });

  const plaintext = encoder.encode(JSON.stringify(replica));

  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: CRYPTO_ALGORITHM, iv, additionalData: aad },
    accountKey,
    plaintext
  );

  return {
    _encrypted: true,
    version: VERSION,
    algorithm: ALGORITHM_NAME,
    scope,
    userId,
    businessId,
    revision,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    updatedAt: Date.now(),
  };
}

export async function decryptReplicaEnvelope(accountKey, scope, envelope) {
  if (!accountKey) {
    throw new StorageLockedError('Encrypted account storage is locked.');
  }

  if (
    !envelope ||
    envelope._encrypted !== true ||
    envelope.version !== VERSION ||
    envelope.algorithm !== ALGORITHM_NAME ||
    envelope.scope !== scope ||
    typeof envelope.revision !== 'number' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new StorageCorruptError('Invalid or corrupted encrypted record.');
  }

  const { userId, businessId } = parseScope(scope);
  const aad = buildAad({
    version: envelope.version,
    scope: envelope.scope,
    revision: envelope.revision,
    userId: envelope.userId || userId,
    businessId: envelope.businessId || businessId,
  });

  try {
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);

    if (iv.length !== IV_BYTES || ciphertext.length < 16) {
      throw new Error('Invalid IV or ciphertext length.');
    }

    const plaintext = await getCrypto().subtle.decrypt(
      { name: CRYPTO_ALGORITHM, iv, additionalData: aad },
      accountKey,
      ciphertext
    );

    return JSON.parse(decoder.decode(plaintext));
  } catch (err) {
    if (err instanceof StorageCorruptError) throw err;
    throw new DecryptionError(
      'Unable to decrypt account storage. Key may be incorrect or record has been tampered with.'
    );
  }
}

export function createEncryptedReplicaRepository({
  factory = globalThis.indexedDB,
  dbName = 'vendora-replicas',
  getKey = null,
} = {}) {
  const keys = new Map();
  let connection = null;

  // In-memory mutex queues per scope to serialize concurrent operations in this thread.
  const scopeTails = new Map();

  function resolveAccountKey(scope) {
    if (typeof getKey === 'function') {
      const candidate = getKey(scope);
      if (candidate) return candidate;
    }
    return keys.get(scope) || null;
  }

  function open() {
    if (!connection) {
      connection = new Promise((resolve, reject) => {
        if (!factory) {
          return reject(
            new Error(
              'This browser cannot save offline records. Enable browser storage before recording.'
            )
          );
        }
        const request = factory.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('accounts')) {
            request.result.createObjectStore('accounts');
          }
        };
        request.onerror = () => {
          connection = null;
          reject(request.error);
        };
        request.onblocked = () => {
          connection = null;
          reject(new Error('Close older Vendora tabs to open offline storage.'));
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            connection = null;
          };
          resolve(db);
        };
      });
    }
    return connection;
  }

  async function getRaw(scope) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readonly');
      const store = tx.objectStore('accounts');
      const req = store.get(scope);
      let result;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result ? structuredClone(result) : null);
      tx.onabort = tx.onerror = () =>
        reject(tx.error || new Error('Offline storage read failed.'));
    });
  }

  async function putRawWithRevisionCheck(scope, envelope, expectedRevision) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      const store = tx.objectStore('accounts');
      const req = store.get(scope);
      let abortedDueToConflict = false;

      req.onsuccess = () => {
        const current = req.result;
        const currentRevision =
          current && current._encrypted && typeof current.revision === 'number'
            ? current.revision
            : 0;

        if (currentRevision !== expectedRevision) {
          abortedDueToConflict = true;
          tx.abort();
          return;
        }

        store.put(envelope, scope);
      };

      tx.oncomplete = () => {
        resolve(true);
      };

      tx.onabort = tx.onerror = () => {
        if (abortedDueToConflict) {
          reject(
            new RevisionConflictError(
              `Concurrent update detected on offline account storage for ${scope}. Expected revision ${expectedRevision}.`
            )
          );
        } else {
          reject(tx.error || new Error('Offline storage save failed.'));
        }
      };
    });
  }

function isLegacyReplica(record) {
  return (
    typeof record === 'object' &&
    record !== null &&
    !record._encrypted &&
    typeof record.version === 'number' &&
    (Array.isArray(record.outbox) ||
      (typeof record.canonical === 'object' && record.canonical !== null) ||
      record.domain !== undefined)
  );
}

  async function read(scope) {
    const raw = await getRaw(scope);
    if (!raw) {
      return emptyReplica();
    }

    if (raw._encrypted === true) {
      const key = resolveAccountKey(scope);
      if (!key) {
        throw new StorageLockedError(
          `Offline account storage for ${scope} is locked. Provide the account key to access.`
        );
      }
      return decryptReplicaEnvelope(key, scope, raw);
    }

    if (isLegacyReplica(raw)) {
      return structuredClone(raw);
    }

    throw new StorageCorruptError(
      `Unrecognized or corrupted record found in offline storage for ${scope}.`
    );
  }

  async function executeUnderLock(scope, action) {
    // If Web Locks API is supported by the browser/environment, coordinate across tabs.
    if (globalThis.navigator?.locks?.request) {
      return navigator.locks.request(`vendora-replica:${scope}`, action);
    }
    // Fallback: in-memory serialization within this process.
    const tail = scopeTails.get(scope) || Promise.resolve();
    const result = tail.then(action);
    scopeTails.set(scope, result.catch(() => {}));
    return result;
  }

  async function update(scope, change, options = {}) {
    const maxRetries = options.maxRetries ?? 3;

    return executeUnderLock(scope, async () => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const raw = await getRaw(scope);
        let baseReplica;
        let expectedRevision = 0;

        if (!raw) {
          baseReplica = emptyReplica();
          expectedRevision = 0;
        } else if (raw._encrypted === true) {
          const key = resolveAccountKey(scope);
          if (!key) {
            throw new StorageLockedError(
              `Offline account storage for ${scope} is locked. Cannot update locked storage.`
            );
          }
          baseReplica = await decryptReplicaEnvelope(key, scope, raw);
          expectedRevision = raw.revision;
        } else if (isLegacyReplica(raw)) {
          // Unencrypted legacy record
          baseReplica = structuredClone(raw);
          expectedRevision = 0;
        } else {
          throw new StorageCorruptError(
            `Cannot update offline storage for ${scope}: record is corrupted.`
          );
        }

        // Apply mutation in memory outside any transaction
        const replicaDraft = structuredClone(baseReplica);
        await change(replicaDraft);

        const key = resolveAccountKey(scope);
        if (!key) {
          throw new StorageLockedError(
            `Offline account storage for ${scope} is locked. An account key is required to write encrypted records.`
          );
        }

        const nextRevision = expectedRevision + 1;
        const envelope = await encryptReplicaEnvelope(
          key,
          scope,
          replicaDraft,
          nextRevision
        );

        try {
          await putRawWithRevisionCheck(scope, envelope, expectedRevision);
          return structuredClone(replicaDraft);
        } catch (error) {
          if (error instanceof RevisionConflictError) {
            if (attempt >= maxRetries) {
              throw error;
            }
            // Small jittered backoff before re-reading and retrying
            const jitter = Math.floor(Math.random() * 10);
            await new Promise(r => setTimeout(r, 15 * (attempt + 1) + jitter));
            continue;
          }
          throw error;
        }
      }

      throw new RevisionConflictError(
        `Exceeded maximum retries (${maxRetries}) resolving concurrent updates for ${scope}.`
      );
    });
  }

  return {
    read,
    update,
    readRaw: getRaw,
    writeRaw: async (scope, rawRecord) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('accounts', 'readwrite');
        const store = tx.objectStore('accounts');
        store.put(rawRecord, scope);
        tx.oncomplete = () => resolve(true);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Write raw failed.'));
      });
    },
    deleteRaw: async (scope) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('accounts', 'readwrite');
        const store = tx.objectStore('accounts');
        store.delete(scope);
        tx.oncomplete = () => resolve(true);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Delete raw failed.'));
      });
    },
    activateEnvelopeWithSourceCheck: async (scope, envelope, expectedSourceJson) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('accounts', 'readwrite');
        const store = tx.objectStore('accounts');
        const req = store.get(scope);
        let conflict = false;

        req.onsuccess = () => {
          const current = req.result;
          const currentJson = JSON.stringify(current || null);
          if (currentJson !== expectedSourceJson) {
            conflict = true;
            tx.abort();
            return;
          }
          store.put(envelope, scope);
        };

        tx.oncomplete = () => resolve({ activated: true });
        tx.onabort = tx.onerror = () => {
          if (conflict) {
            resolve({ activated: false, reason: 'source_changed' });
          } else {
            reject(tx.error || new Error('Activation failed.'));
          }
        };
      });
    },
    setAccountKey(scope, key) {
      if (!key) throw new Error('A valid CryptoKey is required.');
      keys.set(scope, key);
    },
    getAccountKey(scope) {
      return resolveAccountKey(scope);
    },
    clearAccountKey(scope) {
      keys.delete(scope);
    },
    clearAllKeys() {
      keys.clear();
    },
    executeUnderLock: (scope, action) => executeUnderLock(scope, action),
    async close() {
      if (connection) {
        const db = await connection;
        db.close();
        connection = null;
      }
    },
  };
}

export const encryptedReplicaRepository = createEncryptedReplicaRepository();

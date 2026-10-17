import { emptyReplica } from './outbox.js';

export const replicaScope = (userId, businessId) => `${encodeURIComponent(userId)}:${encodeURIComponent(businessId)}`;

export function createReplicaRepository(factory = globalThis.indexedDB) {
  let connection;
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      if (!factory) return reject(new Error('This browser cannot save offline records. Enable browser storage before recording.'));
      const request = factory.open('vendora-replicas', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('accounts');
      request.onerror = () => { connection = null; reject(request.error); };
      request.onblocked = () => { connection = null; reject(new Error('Close older Vendora tabs to open offline storage.')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    });
    return connection;
  }
  async function transaction(scope, change) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', change ? 'readwrite' : 'readonly');
      const store = tx.objectStore('accounts');
      const request = store.get(scope);
      let result, problem;
      request.onsuccess = () => {
        result = request.result || emptyReplica();
        try { if (change) { change(result); store.put(result, scope); } }
        catch (error) { problem = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(structuredClone(result));
      tx.onabort = tx.onerror = () => reject(problem || tx.error || new Error('Offline storage could not save the record.'));
    });
  }
  return { read: scope => transaction(scope), update: (scope, change) => transaction(scope, change),
    async close() { if (connection) (await connection).close(); connection = null; } };
}

export const replicaRepository = createReplicaRepository();

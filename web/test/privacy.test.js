
import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPrivateCaches } from '../src/lib/privacy.js';
import { queryClient } from '../src/lib/queryClient.js';

test('account cache purge clears in-memory queries and preserves offline records and public app cache', async () => {
  const cacheDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  const deleted = [];
  const records = new Map([
    ['vendora:account:a:b:v1', 'unsynced sale'],
  ]);

  queryClient.setQueryData(['private-account'], { userId: 'a' });

  try {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {
        keys: async () => ['vendora-v1'],
        delete: async name => {
          deleted.push(name);
          return true;
        },
      },
    });

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => records.clear(),
        removeItem: key => records.delete(key),
      },
    });

    await clearPrivateCaches();

    assert.equal(queryClient.getQueryData(['private-account']), undefined);
    assert.deepEqual(deleted, []);
    assert.equal(records.get('vendora:account:a:b:v1'), 'unsynced sale');
  } finally {
    for (const [key, descriptor] of [
      ['caches', cacheDescriptor],
      ['localStorage', storageDescriptor],
    ]) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  }
});

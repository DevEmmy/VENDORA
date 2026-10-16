import { queryClient } from './queryClient.js';

// Purge response/query caches only. Account data and pending offline operations
// stay in their scoped storage, including after logout or session expiration.
export async function clearPrivateCaches() {
  queryClient.clear();
  try {
    globalThis.navigator?.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHES' });
    if (globalThis.caches) {
      await Promise.all((await caches.keys()).map(name => caches.delete(name)));
    }
  } catch {
    // CacheStorage may be disabled. The worker also purges on its next activation.
  }
}

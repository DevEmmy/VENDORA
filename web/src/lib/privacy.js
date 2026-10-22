import { queryClient } from './queryClient.js';

// Clear in-memory API/query data when the active account changes or signs out.
// Do not delete CacheStorage here: the service worker uses it to preserve
// verified public application files for offline startup.
//
// Account data and pending offline operations remain in their scoped storage.
export async function clearPrivateCaches() {
  queryClient.clear();
}
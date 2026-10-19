import { authApi } from './authApi.js';
import { useAuthStore } from './authStore.js';
import { onSessionExpired } from '../../lib/api/client.js';

onSessionExpired(() => useAuthStore.getState().expireSession());

let restorePromise = null;

export function restoreSession() {
  if (restorePromise) return restorePromise;

  restorePromise = (async () => {
    try {
      const session = await authApi.me();

      if (!session?.user) {
        throw new Error('Invalid session response');
      }

      useAuthStore.getState().setSession({
        user: session.user,
        memberships: session.memberships || [],
      });

      return session;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        useAuthStore.getState().expireSession();
        return null;
      }

      // A network failure does not prove that the user logged out.
      // Keep account data inaccessible until the session is verified.
      useAuthStore.setState({ status: 'unavailable' });
      return null;
    }
  })().finally(() => {
    restorePromise = null;
  });

  return restorePromise;
}

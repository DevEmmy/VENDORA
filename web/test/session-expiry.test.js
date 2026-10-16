import assert from 'node:assert/strict';
import test from 'node:test';
import { useAuthStore } from '../src/features/auth/authStore.js';

test('expiration retains identity and business selection for re-login and does not clear account storage', () => {
  const user = { id: 'user-a', name: 'Owner' };
  const memberships = [{ businessId: 'business-a', role: 'owner', permissions: ['sales:write'] }];
  useAuthStore.getState().setSession({ user, memberships });
  useAuthStore.getState().expireSession();
  const expired = useAuthStore.getState();
  assert.equal(expired.status, 'expired');
  assert.equal(expired.user, user);
  assert.equal(expired.selectedBusinessId, 'business-a');
  assert.equal(expired.memberships, memberships);
  useAuthStore.getState().setSession({ user, memberships });
  assert.equal(useAuthStore.getState().status, 'authenticated');
  assert.equal(useAuthStore.getState().selectedBusinessId, 'business-a');
  useAuthStore.getState().setGuest();
});


import { create } from 'zustand';
import { setBusinessContextResolver } from '../../lib/api/client.js';

const initialSession = {
  status: 'loading',
  user: null,
  memberships: [],
  selectedBusinessId: null,
};

export const useAuthStore = create((set, get) => ({
  ...initialSession,

  setSession: ({ user, memberships = [] }) => {
    const previousBusinessId = get().selectedBusinessId;

    const selectedBusinessId =
      memberships.find(
        (membership) =>
          membership.businessId === previousBusinessId
      )?.businessId ??
      memberships[0]?.businessId ??
      null;

    set({
      status: 'authenticated',
      user,
      memberships,
      selectedBusinessId,
    });
  },

  setGuest: () => {
    set({
      status: 'guest',
      user: null,
      memberships: [],
      selectedBusinessId: null,
    });
  },

  selectBusiness: (businessId) => {
    const isMember = get().memberships.some(
      (membership) => membership.businessId === businessId
    );

    if (!isMember) {
      return false;
    }

    set({ selectedBusinessId: businessId });
    return true;
  },

  resetSession: () => {
    set(initialSession);
  },

  expireSession: () => {
    set({ status: get().user ? 'expired' : 'guest' });
  },
}));

setBusinessContextResolver(() => useAuthStore.getState().selectedBusinessId);

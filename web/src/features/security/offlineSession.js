/**
 * offlineSession.js
 *
 * Manages the in-memory state of an offline-unlocked Vendora session.
 *
 * An offline session is STRICTLY read-local:
 *  - Sync engine is never started
 *  - Server API mutations are blocked
 *  - Pending outbox operations are preserved but not uploaded
 *  - The session state is cleared from memory on logout or app close
 *
 * The offline session is distinct from an online authenticated session.
 * Status values: 'idle' | 'unlocking' | 'unlocked' | 'lock_expired' | 'not_enrolled' | 'error'
 */

import { evaluateAccountOfflineAccess } from './offlineEnrollment.js';

const listeners = new Set();
let sessionState = createInitialState();

function createInitialState() {
  return {
    status: 'idle',        // offline session status
    userId: null,
    businessId: null,
    scope: null,
    policy: null,          // evaluateOfflineAccess result
    error: null,
    unlockedAt: null,
  };
}

function notify() {
  for (const fn of listeners) fn(sessionState);
}

export function subscribeOfflineSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getOfflineSessionState() {
  return sessionState;
}

export function isOfflineSessionActive() {
  return sessionState.status === 'unlocked';
}

export function setOfflineSessionUnlocking(userId, businessId) {
  sessionState = {
    ...createInitialState(),
    status: 'unlocking',
    userId,
    businessId,
    scope: `${encodeURIComponent(userId)}:${encodeURIComponent(businessId)}`,
  };
  notify();
}

export function setOfflineSessionUnlocked(userId, businessId, policy) {
  sessionState = {
    status: 'unlocked',
    userId,
    businessId,
    scope: `${encodeURIComponent(userId)}:${encodeURIComponent(businessId)}`,
    policy,
    error: null,
    unlockedAt: Date.now(),
  };
  notify();
}

export function setOfflineSessionError(error, code = null) {
  sessionState = {
    ...sessionState,
    status: code === 'ACCESS_EXPIRED' ? 'lock_expired' : 'error',
    error: error?.message || String(error),
    errorCode: code,
  };
  notify();
}

export function clearOfflineSession() {
  sessionState = createInitialState();
  notify();
}

/**
 * Check whether the active offline session has passed its 7-day policy window.
 * If expired, immediately transition the session to 'lock_expired' and notify.
 */
export function checkSessionExpiry(storage = globalThis.localStorage, now = Date.now()) {
  if (sessionState.status !== 'unlocked') return false;
  if (!sessionState.userId || !sessionState.businessId) return false;
  const policy = evaluateAccountOfflineAccess(sessionState.userId, sessionState.businessId, storage, now);
  if (!policy.allowed) {
    sessionState = {
      ...sessionState,
      status: 'lock_expired',
      policy,
      error: 'Offline access period has expired. Reconnection required.',
      errorCode: 'ACCESS_EXPIRED',
    };
    notify();
    return true;
  }
  return false;
}

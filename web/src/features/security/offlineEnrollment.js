/**
 * offlineEnrollment.js
 *
 * Manages offline access enrollment and password-based unlock for Vendora accounts.
 *
 * Security guarantees:
 *  - The plaintext password is never written to any persistent storage.
 *  - The unwrapped CryptoKey lives in memory only; it is never exported to storage.
 *  - The wrapped-key record is stored in localStorage only under a scoped key.
 *  - Offline unlock does NOT renew the lastVerifiedAt timestamp.
 *  - Access is denied when the 7-day window has lapsed.
 *  - Migration and enrollment are mutually exclusive per scope.
 */

import { createAccountKey, wrapAccountKey, unlockAccountKey, rewrapAccountKey } from './accountKey.js';
import { evaluateOfflineAccess } from './offlineAccessPolicy.js';
import { encryptedReplicaRepository } from './encryptedReplicaRepository.js';
import { replicaScope } from '../sync/replicaRepository.js';

// Storage key for the wrapped account-key envelope
export function enrollmentStorageKey(userId, businessId) {
  return `vendora:offline-enrollment:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(businessId))}:v1`;
}

// Storage key for staged rewrapped key (crash safety during password change)
export function stagedEnrollmentStorageKey(userId, businessId) {
  return `vendora:offline-enrollment-staged:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(businessId))}:v1`;
}

// Storage key for the offline-access policy record (lastVerifiedAt, enrollment metadata)
export function accessPolicyStorageKey(userId, businessId) {
  return `vendora:offline-policy:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(businessId))}:v1`;
}

// Storage key for conservative high-water timestamp
export function highWaterStorageKey(userId, businessId) {
  return `vendora:offline-high-water:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(businessId))}:v1`;
}

export class EnrollmentError extends Error {
  constructor(message, code = 'ENROLLMENT_ERROR') {
    super(message);
    this.name = 'EnrollmentError';
    this.code = code;
  }
}

export class UnlockError extends Error {
  constructor(message, code = 'UNLOCK_ERROR') {
    super(message);
    this.name = 'UnlockError';
    this.code = code;
  }
}

/**
 * Check whether a given account is currently enrolled for offline access.
 * Returns the enrollment record or null.
 */
export function getEnrollmentRecord(userId, businessId, storage = globalThis.localStorage) {
  if (!userId || !businessId) return null;
  try {
    const raw = storage?.getItem(enrollmentStorageKey(userId, businessId));
    if (!raw) return null;
    const record = JSON.parse(raw);
    // Basic structural validation
    if (!record || record.userId !== userId || record.businessId !== businessId) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/**
 * Check whether an account is enrolled for offline access.
 */
export function isEnrolledForOfflineAccess(userId, businessId, storage = globalThis.localStorage) {
  return getEnrollmentRecord(userId, businessId, storage) !== null;
}

/**
 * Read the offline access policy record (stores lastVerifiedAt).
 */
export function getAccessPolicyRecord(userId, businessId, storage = globalThis.localStorage) {
  if (!userId || !businessId) return null;
  try {
    const raw = storage?.getItem(accessPolicyStorageKey(userId, businessId));
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || typeof record.lastVerifiedAt !== 'number') return null;
    return record;
  } catch {
    return null;
  }
}

export function getHighWaterTimestamp(userId, businessId, storage = globalThis.localStorage) {
  if (!userId || !businessId) return null;
  try {
    const raw = storage?.getItem(highWaterStorageKey(userId, businessId));
    if (!raw) return null;
    const val = Number(raw);
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

export function updateHighWaterTimestamp(userId, businessId, now = Date.now(), storage = globalThis.localStorage) {
  if (!userId || !businessId || !Number.isFinite(now)) return;
  try {
    const current = getHighWaterTimestamp(userId, businessId, storage) || 0;
    const advanced = Math.max(current, now);
    storage?.setItem(highWaterStorageKey(userId, businessId), String(advanced));
  } catch {}
}

/**
 * Evaluate whether offline access is currently permitted for this account.
 * Returns the policy evaluation result from offlineAccessPolicy.js, including clock rollback checks.
 */
export function evaluateAccountOfflineAccess(userId, businessId, storage = globalThis.localStorage, now = Date.now()) {
  const policy = getAccessPolicyRecord(userId, businessId, storage);
  if (!policy) {
    return { status: 'not_enrolled', allowed: false, remainingMs: 0, expiresAt: null };
  }
  const highWater = getHighWaterTimestamp(userId, businessId, storage);
  const evaluation = evaluateOfflineAccess(policy.lastVerifiedAt, now, highWater);
  if (evaluation.allowed) {
    updateHighWaterTimestamp(userId, businessId, now, storage);
  }
  return evaluation;
}

/**
 * Record the current time as lastVerifiedAt for the offline access policy.
 * Called ONLY on successful online authentication — NEVER on offline unlock.
 */
export function recordOnlineVerification(userId, businessId, storage = globalThis.localStorage, now = Date.now()) {
  if (!userId || !businessId) return;
  try {
    const key = accessPolicyStorageKey(userId, businessId);
    const existing = getAccessPolicyRecord(userId, businessId, storage) || {};
    storage?.setItem(key, JSON.stringify({
      ...existing,
      userId,
      businessId,
      lastVerifiedAt: now,
      updatedAt: now,
    }));
    updateHighWaterTimestamp(userId, businessId, now, storage);
  } catch {
    // Storage unavailable; offline unlock will be refused until next online login
  }
}

/**
 * Enroll an account for offline access.
 *
 * Requires:
 *  - A valid online session (caller must verify authStatus === 'authenticated')
 *  - The account's current password
 *  - A freshly generated or existing account key
 *
 * Produces a wrapped-key record in localStorage and registers the lastVerifiedAt timestamp.
 * Returns the unwrapped CryptoKey for immediate in-memory use.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.businessId
 * @param {string} params.password  - The user's existing Vendora account password
 * @param {CryptoKey} [params.existingAccountKey]  - Provide if already created (e.g. after migration)
 * @param {Storage} [params.storage]
 * @param {number} [params.now]
 * @returns {{ accountKey: CryptoKey }}
 */
export async function enrollForOfflineAccess({
  userId,
  businessId,
  password,
  existingAccountKey = null,
  storage = globalThis.localStorage,
  now = Date.now(),
}) {
  if (!userId || !businessId) {
    throw new EnrollmentError('A verified user and business are required.', 'INVALID_SCOPE');
  }
  if (!password || typeof password !== 'string') {
    throw new EnrollmentError('The account password is required to enable offline access.', 'PASSWORD_REQUIRED');
  }

  // Generate a new account key if not provided
  const accountKey = existingAccountKey || await createAccountKey();

  // Wrap the account key with the user's password
  let wrappedKeyRecord;
  try {
    wrappedKeyRecord = await wrapAccountKey(accountKey, password, userId, businessId);
  } catch {
    throw new EnrollmentError(
      'Unable to secure offline access with this password. Please try again.',
      'WRAP_FAILED'
    );
  }

  // Persist the enrollment record (wrapped key only — no plaintext password or raw key)
  const enrollmentRecord = {
    ...wrappedKeyRecord,
    enrolledAt: now,
    version: 1,
  };

  try {
    storage?.setItem(
      enrollmentStorageKey(userId, businessId),
      JSON.stringify(enrollmentRecord)
    );
  } catch {
    throw new EnrollmentError(
      'Unable to save offline access credentials. Browser storage may be unavailable.',
      'STORAGE_FAILED'
    );
  }

  // Record lastVerifiedAt (only on enrollment, which requires an active online session)
  recordOnlineVerification(userId, businessId, storage, now);

  return { accountKey };
}

/**
 * Unlock a previously enrolled offline account using the user's password.
 *
 * Security:
 *  - Does NOT renew lastVerifiedAt (only online auth can do that).
 *  - Returns the unwrapped CryptoKey for in-memory use only.
 *  - Fails if offline access window has expired.
 *  - Fails with a generic error if the password is incorrect.
 *
 * @returns {{ accountKey: CryptoKey, policy: object }}
 */
export function getStagedEnrollmentRecord(userId, businessId, storage = globalThis.localStorage) {
  if (!userId || !businessId) return null;
  try {
    const raw = storage?.getItem(stagedEnrollmentStorageKey(userId, businessId));
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || record.userId !== userId || record.businessId !== businessId) return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * Prepares offline key rewrapping before changing the password on the server.
 * Verifies that the current password unlocks the local key, generates the new
 * wrapped envelope with the new password, and stages it safely.
 *
 * Never stores plaintext passwords or raw keys.
 */
export async function preparePasswordChangeRewrap({
  userId,
  businessId,
  currentPassword,
  newPassword,
  storage = globalThis.localStorage,
}) {
  if (!userId || !businessId) {
    throw new EnrollmentError('Account identity is required.', 'INVALID_SCOPE');
  }
  const enrollmentRecord = getEnrollmentRecord(userId, businessId, storage);
  if (!enrollmentRecord) {
    return { enrolled: false };
  }

  let newWrappedEnvelope;
  try {
    newWrappedEnvelope = await rewrapAccountKey(
      enrollmentRecord,
      currentPassword,
      newPassword,
      userId,
      businessId
    );
  } catch {
    throw new EnrollmentError(
      'Current password does not match the local offline security key.',
      'WRONG_OLD_PASSWORD'
    );
  }

  const stagedRecord = {
    ...newWrappedEnvelope,
    rewrappedAt: Date.now(),
    version: 1,
  };

  try {
    storage?.setItem(
      stagedEnrollmentStorageKey(userId, businessId),
      JSON.stringify(stagedRecord)
    );
  } catch {
    throw new EnrollmentError(
      'Unable to stage offline key update. Local storage may be full.',
      'STORAGE_FAILED'
    );
  }

  return { enrolled: true, staged: true };
}

/**
 * Commits a staged key rewrap after the server confirms the password change.
 */
export async function commitPasswordChangeRewrap({
  userId,
  businessId,
  storage = globalThis.localStorage,
}) {
  const staged = getStagedEnrollmentRecord(userId, businessId, storage);
  if (!staged) return { committed: false };

  try {
    storage?.setItem(
      enrollmentStorageKey(userId, businessId),
      JSON.stringify(staged)
    );
    storage?.removeItem(stagedEnrollmentStorageKey(userId, businessId));
    return { committed: true };
  } catch {
    throw new EnrollmentError('Failed to commit rewrapped account key.', 'STORAGE_FAILED');
  }
}

/**
 * Discards staged key rewrap if server-side password change was aborted or rejected.
 */
export function abortPasswordChangeRewrap({
  userId,
  businessId,
  storage = globalThis.localStorage,
}) {
  try {
    storage?.removeItem(stagedEnrollmentStorageKey(userId, businessId));
  } catch {}
}

/**
 * Direct rewrap helper for offline enrollment.
 */
export async function rewrapOfflineEnrollment({
  userId,
  businessId,
  currentPassword,
  newPassword,
  storage = globalThis.localStorage,
}) {
  await preparePasswordChangeRewrap({ userId, businessId, currentPassword, newPassword, storage });
  return commitPasswordChangeRewrap({ userId, businessId, storage });
}

/**
 * Reconciles a cross-device password change when the user is online.
 * Unwraps the existing local key with the previous password and rewraps it with the new password.
 * Preserves all local replica data and pending outbox operations without re-encryption.
 */
export async function reconcileCrossDevicePasswordChange({
  userId,
  businessId,
  previousPassword,
  newPassword,
  storage = globalThis.localStorage,
}) {
  const enrollmentRecord = getEnrollmentRecord(userId, businessId, storage);
  if (!enrollmentRecord) {
    throw new EnrollmentError('No offline enrollment found for this account.', 'NOT_ENROLLED');
  }

  let newWrappedEnvelope;
  try {
    newWrappedEnvelope = await rewrapAccountKey(
      enrollmentRecord,
      previousPassword,
      newPassword,
      userId,
      businessId
    );
  } catch {
    throw new EnrollmentError(
      'The previous password could not unlock the local records on this device.',
      'WRONG_PREVIOUS_PASSWORD'
    );
  }

  const updatedRecord = {
    ...newWrappedEnvelope,
    reconciledAt: Date.now(),
    version: 1,
  };

  storage?.setItem(enrollmentStorageKey(userId, businessId), JSON.stringify(updatedRecord));
  storage?.removeItem(stagedEnrollmentStorageKey(userId, businessId));
  return { reconciled: true };
}

/**
 * Unlock a previously enrolled offline account using the user's password.
 *
 * Security:
 *  - Does NOT renew lastVerifiedAt (only online auth can do that).
 *  - Returns the unwrapped CryptoKey for in-memory use only.
 *  - Fails if offline access window has expired or clock rollback is detected.
 *  - Supports crash-recovery via staged envelope if a prior password change crashed.
 *  - Fails with a clear error if the password is incorrect or changed elsewhere.
 *
 * @returns {{ accountKey: CryptoKey, policy: object }}
 */
export async function unlockOfflineAccess({
  userId,
  businessId,
  password,
  storage = globalThis.localStorage,
  now = Date.now(),
}) {
  if (!userId || !businessId) {
    throw new UnlockError('Account identity is required.', 'INVALID_SCOPE');
  }
  if (!password || typeof password !== 'string') {
    throw new UnlockError('Your Vendora password is required to unlock offline access.', 'PASSWORD_REQUIRED');
  }

  // Check enrollment
  let enrollmentRecord = getEnrollmentRecord(userId, businessId, storage);
  const stagedRecord = getStagedEnrollmentRecord(userId, businessId, storage);
  if (!enrollmentRecord && !stagedRecord) {
    throw new UnlockError(
      'This account has not been enrolled for offline access.',
      'NOT_ENROLLED'
    );
  }

  // Evaluate the 7-day access policy and clock rollback BEFORE attempting decryption
  const policy = evaluateAccountOfflineAccess(userId, businessId, storage, now);

  if (!policy.allowed) {
    const isRollback = policy.status === 'clock_rollback' || policy.rollback === true;
    const err = new UnlockError(
      isRollback
        ? 'Device clock appears to have been set backwards. Please restore the correct time or connect to the internet to verify your account.'
        : 'Offline access has expired. Please connect to the internet and sign in again to renew your access.',
      'ACCESS_EXPIRED'
    );
    err.reason = isRollback ? 'clock_rollback' : 'expired';
    throw err;
  }

  // Attempt key unwrap with the provided password
  let accountKey;
  let usedStaged = false;
  if (enrollmentRecord) {
    try {
      accountKey = await unlockAccountKey(enrollmentRecord, password, userId, businessId);
    } catch {
      // Primary unwrap failed. Check if a staged envelope exists from a crashed password change
      if (stagedRecord) {
        try {
          accountKey = await unlockAccountKey(stagedRecord, password, userId, businessId);
          usedStaged = true;
        } catch {}
      }
    }
  } else if (stagedRecord) {
    try {
      accountKey = await unlockAccountKey(stagedRecord, password, userId, businessId);
      usedStaged = true;
    } catch {}
  }

  if (usedStaged && stagedRecord) {
    // Crash recovery: commit the staged record that was successfully unlocked
    try {
      storage?.setItem(enrollmentStorageKey(userId, businessId), JSON.stringify(stagedRecord));
      storage?.removeItem(stagedEnrollmentStorageKey(userId, businessId));
    } catch {}
  }

  if (!accountKey) {
    throw new UnlockError(
      'Unable to unlock this account. Check your password. If you recently changed your password on another device, connect to the internet to sign in, or try your previous password for offline access.',
      'WRONG_PASSWORD'
    );
  }

  // Advance high-water mark
  updateHighWaterTimestamp(userId, businessId, now, storage);

  // Return the in-memory key and policy info (caller must not persist the key)
  return { accountKey, policy };
}

export const LAST_ENROLLED_KEY = 'vendora:last-enrolled-account';

export function setLastEnrolledAccount(metadata, storage = globalThis.localStorage) {
  if (!metadata || !metadata.userId || !metadata.businessId) return;
  try {
    storage?.setItem(LAST_ENROLLED_KEY, JSON.stringify({
      userId: metadata.userId,
      businessId: metadata.businessId,
      businessName: metadata.businessName || '',
      userName: metadata.userName || '',
      phone: metadata.phone || '',
      updatedAt: Date.now(),
    }));
  } catch {}
}

export function getLastEnrolledAccount(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(LAST_ENROLLED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.userId && parsed?.businessId && isEnrolledForOfflineAccess(parsed.userId, parsed.businessId, storage)) {
        return parsed;
      }
    }
  } catch {}
  return null;
}

/**
 * High-level offline access enrollment helper:
 * Wraps key with password, saves enrollment, policy, and last-enrolled metadata.
 */
export async function enableOfflineAccess({
  userId,
  businessId,
  password,
  businessName = '',
  userName = '',
  phone = '',
  existingAccountKey = null,
  storage = globalThis.localStorage,
  now = Date.now(),
}) {
  const { accountKey } = await enrollForOfflineAccess({
    userId,
    businessId,
    password,
    existingAccountKey,
    storage,
    now,
  });

  setLastEnrolledAccount({
    userId,
    businessId,
    businessName,
    userName,
    phone,
  }, storage);

  return { accountKey };
}

/**
 * Revoke offline enrollment for an account.
 * Removes the wrapped key from localStorage and cleans up last-enrolled reference if it matches.
 */
export async function revokeOfflineEnrollment(arg1, arg2, arg3) {
  let userId, businessId, storage, repository, force;
  if (typeof arg1 === 'object' && arg1 !== null) {
    ({
      userId,
      businessId,
      storage = globalThis.localStorage,
      repository = encryptedReplicaRepository,
      force = false,
    } = arg1);
  } else {
    userId = arg1;
    businessId = arg2;
    storage = arg3 || globalThis.localStorage;
    repository = encryptedReplicaRepository;
    force = false;
  }
  if (!userId || !businessId) return;

  const scope = replicaScope(userId, businessId);

  if (!force && repository?.readRaw) {
    try {
      const raw = await repository.readRaw(scope);
      if (raw && (raw._encrypted === true || raw._migrationEnvelope === true)) {
        throw new EnrollmentError(
          'Cannot disable offline access: this device contains encrypted business records that depend on your account key. Please synchronize all data first or clear this device safely.',
          'UNSAFE_REVOCATION_BLOCKED'
        );
      }
    } catch (err) {
      if (err instanceof EnrollmentError) throw err;
      if (typeof globalThis.indexedDB === 'undefined' && repository === encryptedReplicaRepository) {
        // In environments without IndexedDB configured, proceed with local revocation
      } else {
        throw new EnrollmentError(
          'Cannot safely verify local storage state before revoking offline access. Key deletion blocked.',
          'UNSAFE_REVOCATION_BLOCKED'
        );
      }
    }
  }

  try {
    storage?.removeItem(enrollmentStorageKey(userId, businessId));
    storage?.removeItem(stagedEnrollmentStorageKey(userId, businessId));
    const last = getLastEnrolledAccount(storage);
    if (last && last.userId === userId && last.businessId === businessId) {
      storage?.removeItem(LAST_ENROLLED_KEY);
    }
  } catch {
    // Best-effort removal
  }
}

/**
 * Clear all offline access data for an account (enrollment + policy).
 */
export async function clearOfflineAccessData(arg1, arg2, arg3) {
  let userId, businessId, storage, repository, force;
  if (typeof arg1 === 'object' && arg1 !== null) {
    ({
      userId,
      businessId,
      storage = globalThis.localStorage,
      repository = encryptedReplicaRepository,
      force = false,
    } = arg1);
  } else {
    userId = arg1;
    businessId = arg2;
    storage = arg3 || globalThis.localStorage;
    repository = encryptedReplicaRepository;
    force = false;
  }
  if (!userId || !businessId) return;

  const scope = replicaScope(userId, businessId);

  if (!force && repository?.readRaw) {
    try {
      const raw = await repository.readRaw(scope);
      if (raw && (raw._encrypted === true || raw._migrationEnvelope === true)) {
        throw new EnrollmentError(
          'Cannot clear offline access data: this device contains encrypted business records that depend on your account key. Please synchronize all data first or clear this device safely.',
          'UNSAFE_REVOCATION_BLOCKED'
        );
      }
    } catch (err) {
      if (err instanceof EnrollmentError) throw err;
      if (typeof globalThis.indexedDB === 'undefined' && repository === encryptedReplicaRepository) {
        // In environments without IndexedDB configured, proceed with local clear
      } else {
        throw new EnrollmentError(
          'Cannot safely verify local storage state before clearing offline access data. Key deletion blocked.',
          'UNSAFE_REVOCATION_BLOCKED'
        );
      }
    }
  }

  try {
    storage?.removeItem(enrollmentStorageKey(userId, businessId));
    storage?.removeItem(stagedEnrollmentStorageKey(userId, businessId));
    storage?.removeItem(accessPolicyStorageKey(userId, businessId));
    storage?.removeItem(highWaterStorageKey(userId, businessId));
    const last = getLastEnrolledAccount(storage);
    if (last && last.userId === userId && last.businessId === businessId) {
      storage?.removeItem(LAST_ENROLLED_KEY);
    }
  } catch {
    // Best-effort removal
  }
}

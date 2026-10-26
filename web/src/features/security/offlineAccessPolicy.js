
export const OFFLINE_ACCESS_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCESS_WINDOW_MS = OFFLINE_ACCESS_DAYS * DAY_MS;
const WARNING_WINDOW_MS = DAY_MS;
export const SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5-minute tolerance for minor NTP corrections

/**
 * Check whether the current timestamp indicates a clock rollback compared to a recorded high-water mark.
 *
 * Limitations:
 *  Client-side clock enforcement relies on persisted high-water timestamps in local storage.
 *  While this reliably detects local clock rewinds (e.g., manually turning back the device clock to
 *  prolong the 7-day offline period), an attacker with root or developer-console access could tamper
 *  with persisted high-water values. Authoritative, non-forgeable clock validation is performed by the
 *  server upon reconnection. Sensitive business data must never be written in plaintext as part of
 *  clock enforcement.
 */
export function checkClockRollback(now, highWaterTs) {
  if (
    typeof highWaterTs === 'number' &&
    Number.isFinite(highWaterTs) &&
    highWaterTs > 0 &&
    typeof now === 'number' &&
    Number.isFinite(now) &&
    now < highWaterTs - SKEW_TOLERANCE_MS
  ) {
    return {
      rollback: true,
      diffMs: highWaterTs - now,
    };
  }
  return { rollback: false, diffMs: 0 };
}

export function evaluateOfflineAccess(
  lastVerifiedAt,
  now = Date.now(),
  highWaterTs = null
) {
  // Check conservative clock-rollback first
  const rollbackCheck = checkClockRollback(now, highWaterTs);
  if (rollbackCheck.rollback) {
    return {
      status: "clock_rollback",
      allowed: false,
      remainingMs: 0,
      expiresAt: null,
      rollback: true,
    };
  }

  const verifiedAt =
    typeof lastVerifiedAt === "number"
      ? lastVerifiedAt
      : NaN;

  // Never grant offline access without a valid verification time, or if clock is behind verification.
  if (
    !Number.isFinite(verifiedAt) ||
    verifiedAt <= 0 ||
    !Number.isFinite(now) ||
    now < verifiedAt
  ) {
    return {
      status: "expired",
      allowed: false,
      remainingMs: 0,
      expiresAt: null,
    };
  }

  const expiresAt = verifiedAt + ACCESS_WINDOW_MS;

  if (!Number.isFinite(expiresAt) || now >= expiresAt) {
    return {
      status: "expired",
      allowed: false,
      remainingMs: 0,
      expiresAt: Number.isFinite(expiresAt)
        ? expiresAt
        : null,
    };
  }

  const remainingMs = expiresAt - now;

  return {
    status:
      remainingMs <= WARNING_WINDOW_MS
        ? "expiring"
        : "allowed",
    allowed: true,
    remainingMs,
    expiresAt,
  };
}


export const OFFLINE_ACCESS_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCESS_WINDOW_MS = OFFLINE_ACCESS_DAYS * DAY_MS;
const WARNING_WINDOW_MS = DAY_MS;

export function evaluateOfflineAccess(
  lastVerifiedAt,
  now = Date.now()
) {
  const verifiedAt =
    typeof lastVerifiedAt === "number"
      ? lastVerifiedAt
      : NaN;

  // Never grant offline access without a valid verification time.
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

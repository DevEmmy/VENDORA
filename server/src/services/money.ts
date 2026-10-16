/** Convert validated legacy/browser naira to exact integer kobo for storage. */
export function nairaToKobo(naira: number): bigint {
  if (!Number.isFinite(naira) || naira < 0)
    throw new RangeError("Money must be a finite non-negative naira amount");
  const kobo = Math.round(naira * 100);
  if (!Number.isSafeInteger(kobo))
    throw new RangeError("Money exceeds the safe kobo conversion range");
  return BigInt(kobo);
}

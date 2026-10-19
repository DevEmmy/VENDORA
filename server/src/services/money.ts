import { Prisma } from "../generated/prisma/client";

export const MAX_KOBO = 9223372036854775807n;

/** Convert validated legacy/browser naira to exact integer kobo for storage. */
export function nairaToKobo(naira: number): bigint {
  if (!Number.isFinite(naira) || naira < 0)
    throw new RangeError("Money must be a finite non-negative naira amount");
  const kobo = Math.round(naira * 100);
  if (!Number.isSafeInteger(kobo))
    throw new RangeError("Money exceeds the safe kobo conversion range");
  return BigInt(kobo);
}

/** Price a fractional quantity exactly, rounding each line half-up to one kobo. */
export function lineTotalKobo(unitPrice: bigint, quantity: Prisma.Decimal): bigint {
  if (unitPrice < 0n || !quantity.isFinite() || quantity.lt(0)) throw new RangeError("Invalid line price or quantity");
  return BigInt(new Prisma.Decimal(unitPrice.toString()).times(quantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

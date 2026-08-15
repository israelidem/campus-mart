/**
 * Money handling.
 *
 * All monetary values in Campus Mart are integers in **kobo** (the minor unit
 * of the Nigerian Naira: 1 Naira = 100 kobo). Floating point is never used for
 * arithmetic on money — see PRD §64.
 */
export type Kobo = number;

export const KOBO_PER_NAIRA = 100;

export function assertKobo(value: number, label = "amount"): Kobo {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of kobo, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} exceeds the safe integer range`);
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative`);
  }
  return value;
}

/** ₦2,500 -> 250000 kobo. Rejects fractional kobo. */
export function nairaToKobo(naira: number): Kobo {
  const kobo = Math.round(naira * KOBO_PER_NAIRA);
  if (Math.abs(naira * KOBO_PER_NAIRA - kobo) > 1e-6) {
    throw new Error(`${naira} naira cannot be represented in whole kobo`);
  }
  return assertKobo(kobo);
}

export function koboToNaira(kobo: Kobo): number {
  assertKobo(kobo);
  return kobo / KOBO_PER_NAIRA;
}

export function sumKobo(values: readonly Kobo[]): Kobo {
  return values.reduce<Kobo>((total, value) => total + assertKobo(value), 0);
}

export function multiplyKobo(unitAmount: Kobo, quantity: number): Kobo {
  assertKobo(unitAmount, "unitAmount");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, received ${quantity}`);
  }
  return assertKobo(unitAmount * quantity);
}

/**
 * Applies a rate expressed in basis points (250 bps = 2.5%).
 * Rounds half-up to the nearest kobo so the platform never loses a fraction.
 */
export function applyBasisPoints(amount: Kobo, basisPoints: number): Kobo {
  assertKobo(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new Error(`basisPoints must be an integer between 0 and 10000, received ${basisPoints}`);
  }
  return Math.round((amount * basisPoints) / 10_000);
}

/** Clamps a fee between configured minimum and maximum values. */
export function clampKobo(amount: Kobo, min: Kobo, max: Kobo): Kobo {
  assertKobo(amount);
  assertKobo(min, "min");
  assertKobo(max, "max");
  if (min > max) throw new Error("min must not exceed max");
  return Math.min(Math.max(amount, min), max);
}

const nairaFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Display helper: 250000 -> "₦2,500.00". */
export function formatKobo(kobo: Kobo): string {
  return nairaFormatter.format(koboToNaira(kobo));
}

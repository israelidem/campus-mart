import { timingSafeEqual } from "node:crypto";

/**
 * Comparing two secrets without leaking their contents through timing.
 *
 * `a === b` on strings stops at the first differing byte. The time it takes is
 * therefore a function of how many leading characters matched, and an attacker who
 * can measure that can recover a secret one character at a time instead of guessing
 * the whole thing — a search that is linear rather than exponential in its length.
 *
 * The platform already does this correctly in two places: the Paystack webhook HMAC
 * (`lib/payments/paystack.ts`) and the hand-over code HMAC (`lib/delivery/otp.ts`).
 * Phase 13 lifted the shared shape here so the cron secret gets the same treatment,
 * and so a fourth caller has something to reach for rather than reaching for `===`.
 *
 * Two details are load-bearing:
 *
 *  - The length check happens *before* `timingSafeEqual`, because that function
 *    throws on differing lengths rather than returning false. Length is not a
 *    secret worth protecting: a header of the wrong length is not a near miss.
 *  - Empty values never match. An unset secret compared against an absent header
 *    would otherwise be equal, which would turn a missing configuration into an
 *    open door — exactly the failure the guard exists to prevent.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;

  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  if (providedBytes.length !== expectedBytes.length) return false;

  return timingSafeEqual(providedBytes, expectedBytes);
}

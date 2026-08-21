import { assertKobo, type Kobo } from "@/lib/money";

/**
 * Analytics policy (PRD §65–68, Phase 12).
 *
 * Pure. No Prisma, no clock of its own, no formatting of currency (that is
 * `formatKobo`'s job). Everything here is a decision about how to *read* numbers
 * that other phases already wrote, and every one of those decisions is the kind
 * that quietly misleads a Campus Admin if it is got wrong:
 *
 * - the difference between "zero" and "nothing to measure";
 * - which of two dates a figure is counted against;
 * - whether an average or a median is the honest summary.
 *
 * The service layer aggregates in Postgres and hands the results here. Nothing in
 * this file touches a database, so all of it is testable at the boundary.
 */

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

/** The window a Campus Admin gets when they express no preference. */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * The longest window that may be requested.
 *
 * Not a performance limit — the indexes handle a year comfortably — but a limit
 * on how much a single request can be made to scan. An unbounded range is how a
 * reporting page becomes an accidental denial of service against the campus's own
 * database.
 */
export const MAX_RANGE_DAYS = 366;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DateRange = {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound — see `resolveDateRange`. */
  to: Date;
};

export type DateRangeInput = {
  from?: Date | null;
  to?: Date | null;
};

/**
 * Turns an optional, possibly partial range into a definite one.
 *
 * Two decisions worth stating:
 *
 * **The upper bound is exclusive and snapped to the start of the next day.** A
 * Campus Admin asking for "1st to 31st" means the whole of the 31st, but
 * `createdAt <= 31st 00:00:00` silently drops a day of trading. Half-open ranges
 * also compose: yesterday's `to` is today's `from`, with nothing double-counted.
 *
 * **A range is clamped, never swapped.** If `from` is after `to` the caller has a
 * bug or a user typo, and quietly reversing the dates would return a plausible
 * answer to a question nobody asked. The validation layer rejects it; this
 * function assumes it has already been rejected and asserts as a backstop.
 */
export function resolveDateRange(input: DateRangeInput, now: Date): DateRange {
  const to = input.to ? startOfNextDay(input.to) : startOfNextDay(now);
  const from = input.from
    ? startOfDay(input.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);

  if (from.getTime() >= to.getTime()) {
    throw new Error("A reporting range must start before it ends");
  }

  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
    throw new Error(`A reporting range may not exceed ${MAX_RANGE_DAYS} days`);
  }

  return { from, to };
}

/** Midnight at the start of the given day, in the server's zone. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Midnight at the start of the following day — the exclusive upper bound. */
export function startOfNextDay(date: Date): Date {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

/** Whole days spanned by a half-open range. Always at least one. */
export function rangeDays(range: DateRange): number {
  return Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / MS_PER_DAY));
}

/**
 * The range immediately before this one, of the same length.
 *
 * This is what makes a figure mean anything. "₦40,000 this month" is a number;
 * "₦40,000, up from ₦31,000" is information. The comparison window is the same
 * *length* rather than the same calendar month, because a 30-day month compared
 * against a 31-day one manufactures a decline out of the calendar.
 */
export function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span),
    to: new Date(range.from.getTime()),
  };
}

/** True when a date falls inside the half-open range. */
export function isWithinRange(date: Date, range: DateRange): boolean {
  const time = date.getTime();
  return time >= range.from.getTime() && time < range.to.getTime();
}

// ---------------------------------------------------------------------------
// Reading aggregates honestly
// ---------------------------------------------------------------------------

/**
 * Prisma's `_sum` returns `null` when no rows matched.
 *
 * That `null` means "there was nothing to add up", which is *not* the same as a
 * sum of zero — but for a total it is displayed identically and safely, so it
 * collapses here in one place rather than with a scattered `?? 0`.
 */
export function sumOrZero(value: number | null | undefined): Kobo {
  if (value === null || value === undefined) return 0;
  return assertKobo(Math.trunc(value), "aggregate sum");
}

/** The same collapse for a count, which Postgres always returns as a number. */
export function countOrZero(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * A rate, or `null` when there is nothing to rate.
 *
 * **A campus with no finished deliveries does not have a 0% success rate.** It has
 * no success rate at all, and the UI must say "No deliveries yet" rather than
 * render a figure that reads as total failure. Returning `null` is what forces
 * every caller to make that distinction; returning 0 would let them all forget it.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  if (numerator < 0) throw new Error("A rate cannot have a negative numerator");
  return numerator / denominator;
}

/** A rate as whole basis points, so it can be stored or compared as an integer. */
export function rateBps(numerator: number, denominator: number): number | null {
  const value = rate(numerator, denominator);
  return value === null ? null : Math.round(value * 10_000);
}

/** "94.2%", or a dash when there is nothing to measure. */
export function formatRate(value: number | null, fractionDigits = 1): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/**
 * The change from one period to the next, as a ratio.
 *
 * `null` when the previous period was empty: growth from zero is not "infinite
 * growth", it is a first sale, and no percentage describes it usefully.
 */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** "+18.4%", "−7.0%", or a dash. Signed, because the sign is the message. */
export function formatChange(value: number | null, fractionDigits = 1): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${(Math.abs(value) * 100).toFixed(fractionDigits)}%`;
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * The median of a list of millisecond durations, or `null` for an empty list.
 *
 * **Deliberately the median and not the mean.** One delivery left in a hostel
 * lobby overnight moves a mean of twenty deliveries by an hour and tells the
 * Campus Admin their service is slow when nineteen students got theirs in twenty
 * minutes. The median describes the typical experience, which is what an operator
 * needs to know.
 */
export function medianMs(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] as number;

  const lower = sorted[middle - 1] as number;
  const upper = sorted[middle] as number;
  return Math.round((lower + upper) / 2);
}


/**
 * A duration in words: "18m", "2h 05m", "3d 4h".
 *
 * Rounds to the unit a human would use, because "1,143,000ms" is a number a
 * machine reports and "19m" is a fact an operator can act on.
 */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 0) throw new Error("A duration cannot be negative");

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${String(minutes).padStart(2, "0")}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Elapsed milliseconds between two points, or `null` if either is missing.
 *
 * A delivery that never completed has no duration, and treating a missing
 * timestamp as `0` would make the worst outcome look like the fastest one — which
 * is exactly the direction an operational metric must never fail in.
 */
export function elapsedMs(start: Date | null | undefined, end: Date | null | undefined): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  return ms < 0 ? null : ms;
}

// ---------------------------------------------------------------------------
// Money roll-ups
// ---------------------------------------------------------------------------

export type PlatformEarningsInput = {
  /** Commission on goods, from the vendor orders that actually completed. */
  commissionKobo: Kobo;
  /** Delivery fees, which settle to the platform in the MVP (no agent payouts). */
  deliveryFeeKobo: Kobo;
  /** The platform's own share of refunds paid out in the period. */
  refundedFromPlatformKobo: Kobo;
};

export type PlatformEarnings = {
  grossKobo: Kobo;
  refundedKobo: Kobo;
  /**
   * Gross minus the platform's share of refunds. **Signed**, because a month in
   * which the platform refunded more commission than it earned is a real month
   * and clamping it at zero would hide it.
   */
  netKobo: number;
};

/**
 * What the platform actually kept.
 *
 * The refund subtracted here is only `fromPlatformKobo` — the vendor's share of a
 * refund never passed through the platform's revenue, so subtracting the whole
 * refund would double-count the vendor's loss as the platform's.
 */
export function platformEarnings(input: PlatformEarningsInput): PlatformEarnings {
  const commission = assertKobo(input.commissionKobo, "commissionKobo");
  const deliveryFees = assertKobo(input.deliveryFeeKobo, "deliveryFeeKobo");
  const refunded = assertKobo(input.refundedFromPlatformKobo, "refundedFromPlatformKobo");

  const gross = commission + deliveryFees;
  return { grossKobo: gross, refundedKobo: refunded, netKobo: gross - refunded };
}

/**
 * Average order value, or `null` when nothing was ordered.
 *
 * Floors rather than rounds. An average of ₦1,999.6 displayed as ₦2,000 invites
 * "why does the average exceed every order?" from a Campus Admin holding a list of
 * ₦1,999 orders; flooring can only ever understate, which is the safer error.
 */
export function averageOrderValue(totalKobo: Kobo, orderCount: number): Kobo | null {
  assertKobo(totalKobo, "totalKobo");
  if (orderCount <= 0) return null;
  return Math.floor(totalKobo / orderCount);
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export type Rankable = {
  /** The figure being ranked on. */
  value: number;
  /** Tie-break, so equal values order deterministically instead of by chance. */
  label: string;
};

/**
 * Sorts descending by value, breaking ties alphabetically.
 *
 * The tie-break matters more than it looks: without one, two stores with the same
 * revenue swap places between page loads for no reason a user can explain, and the
 * whole table stops looking trustworthy.
 */
export function rankDescending<T extends Rankable>(items: readonly T[], limit?: number): T[] {
  const sorted = [...items].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.label.localeCompare(b.label);
  });
  return typeof limit === "number" ? sorted.slice(0, Math.max(0, limit)) : sorted;
}

/** A rating average from stored count + sum, in hundredths. `null` when unrated. */
export function ratingAverageHundredths(count: number, sum: number): number | null {
  if (count <= 0) return null;
  return Math.round((sum * 100) / count);
}

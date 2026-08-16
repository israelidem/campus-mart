import type { DeliveryStatus, RatingSubject } from "@/lib/generated/prisma/enums";

/**
 * Rating policy (PRD §24, §57–59).
 *
 * Pure: no Prisma, no clock of its own, no request context. The service owns
 * transactions and reads rows; this module owns *what is allowed and what an
 * aggregate becomes*, so the arithmetic that the marketplace sorts on can be
 * tested exhaustively without a database, and cannot drift between the write
 * path, the moderation path and the display.
 */

export const MIN_SCORE = 1;
export const MAX_SCORE = 5;

/**
 * How long a student may change their mind, in hours.
 *
 * A window rather than "forever": a rating is a report of one delivery, and a
 * store that improves next month should not be able to lean on a buyer to
 * rewrite last month's account of it. Twenty-four hours is long enough to cover
 * "I rated in the corridor and reconsidered at my desk" and short enough that a
 * score stops being negotiable.
 *
 * Platform policy, not a campus setting: a campus that could extend it
 * indefinitely would effectively be able to reopen its own reviews.
 */
export const EDIT_WINDOW_HOURS = 24;

/** Whether a score is one of the five whole stars. */
export function isValidScore(score: number): boolean {
  return Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE;
}

/**
 * The only delivery state that may be rated.
 *
 * COMPLETED means the hand-over was verified *and* the goods were paid for
 * (Phase 7–8). A RETURNED or CANCELLED delivery is deliberately not rateable:
 * nothing was received, so a score would be an opinion about an argument rather
 * than a report of a transaction, and the dispute flow (Phase 11) is where that
 * belongs.
 */
export function isRateableDeliveryStatus(status: DeliveryStatus): boolean {
  return status === "COMPLETED";
}

/**
 * Whether an existing rating may still be edited.
 *
 * Measured from when it was first given, not from the last edit: otherwise each
 * edit would extend the window and the deadline would never arrive. A hidden
 * rating is frozen — an admin's moderation decision is not something the author
 * can edit away.
 */
export function canEditRating(
  rating: { createdAt: Date; hiddenAt: Date | null },
  now: Date,
): boolean {
  if (rating.hiddenAt) return false;
  const deadline = rating.createdAt.getTime() + EDIT_WINDOW_HOURS * 3_600_000;
  return now.getTime() <= deadline;
}

/** Whole hours left in the edit window, floored at zero, for display only. */
export function editHoursRemaining(createdAt: Date, now: Date): number {
  const deadline = createdAt.getTime() + EDIT_WINDOW_HOURS * 3_600_000;
  return Math.max(0, Math.ceil((deadline - now.getTime()) / 3_600_000));
}

/**
 * A subject's rating aggregate.
 *
 * `sum` and `count` are the stored truth and `averageHundredths` is derived from
 * them, never the other way round: keeping the sum means an average can be
 * recomputed exactly after any change, whereas storing only a rounded average
 * would accumulate error with every rating.
 */
export type RatingAggregate = {
  count: number;
  sum: number;
  /** Average × 100. 450 means 4.50 stars. */
  averageHundredths: number;
};

export const EMPTY_AGGREGATE: RatingAggregate = { count: 0, sum: 0, averageHundredths: 0 };

/**
 * Rounds an average to hundredths, half-up.
 *
 * Half-up rather than JavaScript's `Math.round` on a float: `4.005` and friends
 * are not representable in binary floating point, so rounding the integer
 * quotient keeps 3 ratings of 4, 4 and 5 at exactly 433 instead of 432.9999…
 */
function averageHundredths(sum: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor((sum * 100 + Math.floor(count / 2)) / count);
}

/** Rebuilds an aggregate from its stored sum and count. */
export function aggregateFrom(sum: number, count: number): RatingAggregate {
  if (count <= 0 || sum <= 0) return EMPTY_AGGREGATE;
  return { count, sum, averageHundredths: averageHundredths(sum, count) };
}

/** The aggregate after a brand-new rating is added. */
export function applyNewRating(current: RatingAggregate, score: number): RatingAggregate {
  return aggregateFrom(current.sum + score, current.count + 1);
}

/**
 * The aggregate after an existing rating changes score.
 *
 * The count is untouched — an edit is not a second opinion — which is precisely
 * why the delta has to be applied to the sum rather than the average.
 */
export function applyEditedRating(
  current: RatingAggregate,
  previousScore: number,
  nextScore: number,
): RatingAggregate {
  return aggregateFrom(current.sum - previousScore + nextScore, current.count);
}

/**
 * The aggregate after a rating stops counting (hidden by an admin, or removed).
 *
 * Clamped at zero rather than trusted: if a stored aggregate has drifted, the
 * remedy is an empty aggregate that the next rating rebuilds, not a negative
 * count that would make every later average nonsense.
 */
export function applyRemovedRating(current: RatingAggregate, score: number): RatingAggregate {
  const count = current.count - 1;
  if (count <= 0) return EMPTY_AGGREGATE;
  return aggregateFrom(Math.max(0, current.sum - score), count);
}

/** The aggregate after a hidden rating is restored to visibility. */
export function applyRestoredRating(current: RatingAggregate, score: number): RatingAggregate {
  return applyNewRating(current, score);
}

/**
 * Formats an average for display, e.g. 433 → "4.3".
 *
 * One decimal place because that is the resolution a reader can actually use:
 * "4.33 stars" invites a precision that five whole stars from a handful of
 * buyers does not have. `null` for an unrated subject, so callers must decide
 * what "no ratings yet" looks like instead of showing a misleading 0.0.
 */
export function formatAverage(averageHundredths: number, count: number): string | null {
  if (count <= 0) return null;
  return (Math.round(averageHundredths / 10) / 10).toFixed(1);
}

/** The two things a student is asked about after a delivery. */
export const RATING_SUBJECTS: readonly RatingSubject[] = ["VENDOR", "DELIVERY_AGENT"];

/** Human label for a subject, used in copy and in the moderation queue. */
export function subjectLabel(subject: RatingSubject): string {
  return subject === "VENDOR" ? "Store" : "Delivery agent";
}

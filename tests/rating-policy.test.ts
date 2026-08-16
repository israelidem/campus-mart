import { describe, expect, it } from "vitest";

import {
  aggregateFrom,
  applyEditedRating,
  applyNewRating,
  applyRemovedRating,
  applyRestoredRating,
  canEditRating,
  EDIT_WINDOW_HOURS,
  editHoursRemaining,
  EMPTY_AGGREGATE,
  formatAverage,
  isRateableDeliveryStatus,
  isValidScore,
} from "@/lib/ratings/rating-policy";
import type { DeliveryStatus } from "@/lib/generated/prisma/enums";

const HOUR = 3_600_000;

describe("rating scores", () => {
  it("accepts only the five whole stars", () => {
    expect([1, 2, 3, 4, 5].every(isValidScore)).toBe(true);
    expect(isValidScore(0)).toBe(false);
    expect(isValidScore(6)).toBe(false);
  });

  it("rejects half stars and other non-integers", () => {
    // A client that renders half stars must not be able to invent a 4.5 that no
    // other part of the system can display or average consistently.
    expect(isValidScore(4.5)).toBe(false);
    expect(isValidScore(Number.NaN)).toBe(false);
    expect(isValidScore(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("what may be rated", () => {
  it("allows only a completed delivery", () => {
    expect(isRateableDeliveryStatus("COMPLETED")).toBe(true);
  });

  it("refuses every other delivery state", () => {
    // A returned or cancelled delivery delivered nothing, so a score would be an
    // opinion about an argument. Disputes are the channel for that (PRD §57).
    const others: DeliveryStatus[] = [
      "AWAITING_DELIVERY_PAYMENT",
      "AVAILABLE",
      "ACCEPTED",
      "IN_TRANSIT",
      "PICKED_UP",
      "ARRIVED",
      "AWAITING_OTP",
      "PAYMENT_PENDING",
      "RETURNED",
      "CANCELLED",
    ];
    expect(others.some(isRateableDeliveryStatus)).toBe(false);
  });
});

describe("the edit window", () => {
  const createdAt = new Date("2026-03-01T09:00:00Z");

  it("stays open right up to the deadline and closes after it", () => {
    const atDeadline = new Date(createdAt.getTime() + EDIT_WINDOW_HOURS * HOUR);
    const justAfter = new Date(atDeadline.getTime() + 1);

    expect(canEditRating({ createdAt, hiddenAt: null }, atDeadline)).toBe(true);
    expect(canEditRating({ createdAt, hiddenAt: null }, justAfter)).toBe(false);
  });

  it("measures from when the rating was given, not from the last edit", () => {
    // Otherwise every edit would extend the window and the deadline would never
    // arrive, which is the whole point of having one.
    const twentyThreeHoursLater = new Date(createdAt.getTime() + 23 * HOUR);
    expect(canEditRating({ createdAt, hiddenAt: null }, twentyThreeHoursLater)).toBe(true);

    const twentyFiveHoursLater = new Date(createdAt.getTime() + 25 * HOUR);
    expect(canEditRating({ createdAt, hiddenAt: null }, twentyFiveHoursLater)).toBe(false);
  });

  it("freezes a rating an admin has hidden, even inside the window", () => {
    // A moderation decision is not something the author may edit away.
    const oneHourLater = new Date(createdAt.getTime() + HOUR);
    expect(canEditRating({ createdAt, hiddenAt: oneHourLater }, oneHourLater)).toBe(false);
  });

  it("counts down whole hours and never reports a negative", () => {
    expect(editHoursRemaining(createdAt, createdAt)).toBe(EDIT_WINDOW_HOURS);
    expect(editHoursRemaining(createdAt, new Date(createdAt.getTime() + 23.5 * HOUR))).toBe(1);
    expect(editHoursRemaining(createdAt, new Date(createdAt.getTime() + 40 * HOUR))).toBe(0);
  });
});

describe("aggregates", () => {
  it("keeps the sum and count as the truth and derives the average", () => {
    // 4 + 4 + 5 = 13 over 3 ratings is 4.333…, stored as 433 hundredths.
    const aggregate = aggregateFrom(13, 3);
    expect(aggregate).toEqual({ count: 3, sum: 13, averageHundredths: 433 });
  });

  it("rounds half-up without floating point drift", () => {
    // 1 + 2 = 3 over 2 is exactly 1.5 → 150, not 149.99999.
    expect(aggregateFrom(3, 2).averageHundredths).toBe(150);
    // 2 + 3 + 3 = 8 over 3 is 2.666… → 267 (half-up), not 266.
    expect(aggregateFrom(8, 3).averageHundredths).toBe(267);
  });

  it("treats an unrated subject as empty rather than zero-starred", () => {
    expect(aggregateFrom(0, 0)).toEqual(EMPTY_AGGREGATE);
    expect(formatAverage(0, 0)).toBeNull();
  });

  it("adds a new rating to both the sum and the count", () => {
    const after = applyNewRating({ count: 2, sum: 9, averageHundredths: 450 }, 3);
    expect(after).toEqual({ count: 3, sum: 12, averageHundredths: 400 });
  });

  it("changes the sum but not the count when a rating is edited", () => {
    // An edit is a correction, not a second opinion: 3 ratings stay 3 ratings.
    const before = aggregateFrom(12, 3); // 4.00
    const after = applyEditedRating(before, 3, 5);
    expect(after).toEqual({ count: 3, sum: 14, averageHundredths: 467 });
  });

  it("withdraws a hidden rating from the average", () => {
    const before = aggregateFrom(14, 3); // 5 + 5 + 4
    const after = applyRemovedRating(before, 4);
    expect(after).toEqual({ count: 2, sum: 10, averageHundredths: 500 });
  });

  it("empties the aggregate when the last rating is hidden", () => {
    expect(applyRemovedRating(aggregateFrom(5, 1), 5)).toEqual(EMPTY_AGGREGATE);
  });

  it("never produces a negative count or sum from a drifted aggregate", () => {
    // If stored counters have drifted, an empty aggregate that the next rating
    // rebuilds is recoverable; a negative one poisons every later average.
    const drifted = { count: 1, sum: 2, averageHundredths: 200 };
    expect(applyRemovedRating(drifted, 5)).toEqual(EMPTY_AGGREGATE);
  });

  it("restores a hidden rating to exactly where it was", () => {
    const original = aggregateFrom(13, 3);
    const hidden = applyRemovedRating(original, 4);
    const restored = applyRestoredRating(hidden, 4);
    expect(restored).toEqual(original);
  });

  it("survives a hide/restore cycle on the same rating without drifting", () => {
    let aggregate = EMPTY_AGGREGATE;
    for (const score of [5, 4, 3, 5]) aggregate = applyNewRating(aggregate, score);
    const baseline = aggregate;

    for (let i = 0; i < 5; i += 1) {
      aggregate = applyRemovedRating(aggregate, 3);
      aggregate = applyRestoredRating(aggregate, 3);
    }

    expect(aggregate).toEqual(baseline);
  });
});

describe("displaying an average", () => {
  it("shows one decimal place", () => {
    expect(formatAverage(433, 3)).toBe("4.3");
    expect(formatAverage(500, 2)).toBe("5.0");
    expect(formatAverage(150, 2)).toBe("1.5");
  });

  it("says nothing at all for a subject with no ratings", () => {
    // A new store has no reputation, which is not the same as a bad one.
    expect(formatAverage(0, 0)).toBeNull();
    expect(formatAverage(450, 0)).toBeNull();
  });
});

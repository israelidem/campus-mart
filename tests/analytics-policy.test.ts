import { describe, expect, it } from "vitest";

import {
  DEFAULT_RANGE_DAYS,
  MAX_RANGE_DAYS,
  MS_PER_DAY,
  averageOrderValue,
  changeRatio,
  countOrZero,
  elapsedMs,
  formatChange,
  formatDurationMs,
  formatRate,
  isWithinRange,
  medianMs,
  platformEarnings,
  previousRange,
  rangeDays,
  rankDescending,
  rate,
  rateBps,
  ratingAverageHundredths,
  resolveDateRange,
  startOfDay,
  startOfNextDay,
  sumOrZero,
} from "@/lib/analytics/analytics-policy";

/**
 * Phase 12 analytics policy.
 *
 * The tests worth having here are the ones about *honesty*: an empty campus must
 * not read as a failing one, a half-open range must not drop a day of trading, and
 * a median must not be quietly replaced by a mean.
 */

const NOW = new Date("2026-08-16T09:30:00.000Z");

describe("resolveDateRange", () => {
  it("defaults to the last 30 days, ending at the start of tomorrow", () => {
    const range = resolveDateRange({}, NOW);

    expect(range.to.getTime()).toBe(startOfNextDay(NOW).getTime());
    expect(range.to.getTime() - range.from.getTime()).toBe(DEFAULT_RANGE_DAYS * MS_PER_DAY);
  });

  it("includes the whole of the requested end day", () => {
    // The trap: `to = 31st` must cover trading at 23:59 on the 31st.
    const range = resolveDateRange(
      { from: new Date("2026-08-01T12:00:00"), to: new Date("2026-08-31T08:00:00") },
      NOW,
    );

    const lateOnTheLastDay = new Date("2026-08-31T23:59:59");
    expect(isWithinRange(lateOnTheLastDay, range)).toBe(true);
  });

  it("snaps the start of the range back to midnight", () => {
    const range = resolveDateRange({ from: new Date("2026-08-01T17:45:00"), to: NOW }, NOW);
    expect(range.from.getTime()).toBe(startOfDay(new Date("2026-08-01T17:45:00")).getTime());
  });

  it("excludes the instant the range ends, so consecutive ranges never double-count", () => {
    const first = resolveDateRange(
      { from: new Date("2026-08-01T00:00:00"), to: new Date("2026-08-10T00:00:00") },
      NOW,
    );
    const second = resolveDateRange(
      { from: new Date("2026-08-11T00:00:00"), to: new Date("2026-08-20T00:00:00") },
      NOW,
    );

    expect(first.to.getTime()).toBe(second.from.getTime());
    expect(isWithinRange(first.to, first)).toBe(false);
    expect(isWithinRange(second.from, second)).toBe(true);
  });

  it("refuses a reversed range rather than silently swapping the dates", () => {
    expect(() =>
      resolveDateRange(
        { from: new Date("2026-08-20T00:00:00"), to: new Date("2026-08-01T00:00:00") },
        NOW,
      ),
    ).toThrow(/must start before/i);
  });

  it("refuses a range longer than the cap", () => {
    const from = new Date(NOW.getTime() - (MAX_RANGE_DAYS + 5) * MS_PER_DAY);
    expect(() => resolveDateRange({ from, to: NOW }, NOW)).toThrow(/may not exceed/i);
  });

  it("accepts a single day", () => {
    const day = new Date("2026-08-16T13:00:00");
    const range = resolveDateRange({ from: day, to: day }, NOW);

    expect(rangeDays(range)).toBe(1);
    expect(isWithinRange(new Date("2026-08-16T23:00:00"), range)).toBe(true);
    expect(isWithinRange(new Date("2026-08-17T00:00:00"), range)).toBe(false);
  });
});

describe("previousRange", () => {
  it("is the same length, immediately before, and does not overlap", () => {
    const range = resolveDateRange(
      { from: new Date("2026-08-01T00:00:00"), to: new Date("2026-08-30T00:00:00") },
      NOW,
    );
    const previous = previousRange(range);

    expect(previous.to.getTime()).toBe(range.from.getTime());
    expect(previous.to.getTime() - previous.from.getTime()).toBe(
      range.to.getTime() - range.from.getTime(),
    );
    expect(isWithinRange(previous.to, previous)).toBe(false);
  });
});

describe("sumOrZero and countOrZero", () => {
  it("treat a null aggregate as zero", () => {
    expect(sumOrZero(null)).toBe(0);
    expect(sumOrZero(undefined)).toBe(0);
    expect(countOrZero(null)).toBe(0);
  });

  it("pass through real values", () => {
    expect(sumOrZero(250_000)).toBe(250_000);
    expect(countOrZero(7)).toBe(7);
  });

  it("reject a negative money sum, which would mean the data is wrong", () => {
    expect(() => sumOrZero(-1)).toThrow();
  });
});

describe("rate", () => {
  it("returns null when there is nothing to measure", () => {
    // A campus with no deliveries does not have a 0% success rate.
    expect(rate(0, 0)).toBeNull();
    expect(rateBps(0, 0)).toBeNull();
    expect(formatRate(rate(0, 0))).toBe("—");
  });

  it("computes a real rate", () => {
    expect(rate(47, 50)).toBeCloseTo(0.94);
    expect(rateBps(47, 50)).toBe(9_400);
    expect(formatRate(rate(47, 50))).toBe("94.0%");
  });

  it("distinguishes a genuine zero from an absent one", () => {
    expect(rate(0, 12)).toBe(0);
    expect(formatRate(rate(0, 12))).toBe("0.0%");
  });
});

describe("changeRatio", () => {
  it("returns null when the previous period was empty", () => {
    // Growth from zero is a first sale, not infinite growth.
    expect(changeRatio(40_000, 0)).toBeNull();
    expect(formatChange(changeRatio(40_000, 0))).toBe("—");
  });

  it("signs the change", () => {
    expect(formatChange(changeRatio(120, 100))).toBe("+20.0%");
    expect(formatChange(changeRatio(80, 100))).toBe("−20.0%");
    expect(formatChange(changeRatio(100, 100))).toBe("0.0%");
  });
});

describe("medianMs", () => {
  it("returns null for no observations", () => {
    expect(medianMs([])).toBeNull();
    expect(formatDurationMs(medianMs([]))).toBe("—");
  });

  it("takes the middle value for an odd count", () => {
    expect(medianMs([300, 100, 200])).toBe(200);
  });

  it("averages the two middle values for an even count", () => {
    expect(medianMs([100, 200, 300, 400])).toBe(250);
  });

  it("is not dragged by one outlier, unlike a mean", () => {
    const durations = [10, 12, 11, 13, 600];
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;

    expect(medianMs(durations)).toBe(12);
    expect(mean).toBeGreaterThan(100);
  });
});

describe("formatDurationMs", () => {
  it("uses the unit a human would use", () => {
    expect(formatDurationMs(45_000)).toBe("45s");
    expect(formatDurationMs(19 * 60_000)).toBe("19m");
    expect(formatDurationMs(2 * 3_600_000 + 5 * 60_000)).toBe("2h 05m");
    expect(formatDurationMs(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d 4h");
  });

  it("refuses a negative duration", () => {
    expect(() => formatDurationMs(-1)).toThrow();
  });
});

describe("elapsedMs", () => {
  it("is null when either end is missing", () => {
    // A delivery that never completed has no duration — not a duration of zero.
    expect(elapsedMs(new Date(), null)).toBeNull();
    expect(elapsedMs(null, new Date())).toBeNull();
  });

  it("measures forwards only", () => {
    const start = new Date("2026-08-16T09:00:00Z");
    const end = new Date("2026-08-16T09:20:00Z");

    expect(elapsedMs(start, end)).toBe(20 * 60_000);
    expect(elapsedMs(end, start)).toBeNull();
  });
});

describe("platformEarnings", () => {
  it("adds commission and delivery fees, then subtracts only the platform's refund share", () => {
    const earnings = platformEarnings({
      commissionKobo: 50_000,
      deliveryFeeKobo: 20_000,
      refundedFromPlatformKobo: 5_000,
    });

    expect(earnings.grossKobo).toBe(70_000);
    expect(earnings.netKobo).toBe(65_000);
  });

  it("does not subtract the vendor's share of a refund", () => {
    // The vendor's share never passed through platform revenue; subtracting it
    // would report the vendor's loss as the platform's.
    const withVendorShareIgnored = platformEarnings({
      commissionKobo: 10_000,
      deliveryFeeKobo: 0,
      refundedFromPlatformKobo: 1_000,
    });

    expect(withVendorShareIgnored.netKobo).toBe(9_000);
  });

  it("reports a negative net rather than clamping it at zero", () => {
    const earnings = platformEarnings({
      commissionKobo: 1_000,
      deliveryFeeKobo: 0,
      refundedFromPlatformKobo: 4_000,
    });

    expect(earnings.netKobo).toBe(-3_000);
  });
});

describe("averageOrderValue", () => {
  it("is null when nothing was ordered", () => {
    expect(averageOrderValue(0, 0)).toBeNull();
  });

  it("floors, so the average can never exceed every order", () => {
    expect(averageOrderValue(599_900, 3)).toBe(199_966);
  });
});

describe("rankDescending", () => {
  it("orders by value, highest first", () => {
    const ranked = rankDescending([
      { label: "Mama Put", value: 30 },
      { label: "Campus Grill", value: 90 },
      { label: "Book Nook", value: 60 },
    ]);

    expect(ranked.map((entry) => entry.label)).toEqual(["Campus Grill", "Book Nook", "Mama Put"]);
  });

  it("breaks ties alphabetically so the order does not shuffle between loads", () => {
    const ranked = rankDescending([
      { label: "Zed Stores", value: 50 },
      { label: "Alpha Stores", value: 50 },
    ]);

    expect(ranked.map((entry) => entry.label)).toEqual(["Alpha Stores", "Zed Stores"]);
  });

  it("honours a limit", () => {
    const ranked = rankDescending(
      [
        { label: "a", value: 1 },
        { label: "b", value: 2 },
        { label: "c", value: 3 },
      ],
      2,
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.label).toBe("c");
  });

  it("does not mutate its input", () => {
    const input = [
      { label: "a", value: 1 },
      { label: "b", value: 2 },
    ];
    rankDescending(input);
    expect(input[0]?.label).toBe("a");
  });
});

describe("ratingAverageHundredths", () => {
  it("is null for an unrated subject", () => {
    expect(ratingAverageHundredths(0, 0)).toBeNull();
  });

  it("derives the average from count and sum", () => {
    expect(ratingAverageHundredths(4, 18)).toBe(450);
  });
});

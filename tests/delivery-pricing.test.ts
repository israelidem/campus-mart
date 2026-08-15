import { describe, expect, it } from "vitest";

import { distanceBetween, haversineMeters, quoteDeliveryFee } from "@/lib/delivery/pricing";
import { generateOrderReference } from "@/lib/orders/order-reference";


/**
 * The delivery fee is the one number a student agrees to before any money moves,
 * so the formula is pinned down here rather than left to the checkout path.
 */

const pricing = {
  deliveryBaseFeeKobo: 20_000, // ₦200
  deliveryPerKmKobo: 10_000, // ₦100/km
  deliveryMinimumFeeKobo: 25_000, // ₦250
  deliveryMaximumFeeKobo: 100_000, // ₦1,000
};

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters({ latitude: 7.6, longitude: 5.2 }, { latitude: 7.6, longitude: 5.2 })).toBe(0);
  });

  it("measures a known short campus hop to within a few metres", () => {
    // One thousandth of a degree of latitude is ~111.2 m anywhere on Earth.
    const meters = haversineMeters(
      { latitude: 7.6, longitude: 5.2 },
      { latitude: 7.601, longitude: 5.2 },
    );

    expect(meters).toBeGreaterThan(105);
    expect(meters).toBeLessThan(115);
  });

  it("is symmetric", () => {
    const a = { latitude: 7.61, longitude: 5.22 };
    const b = { latitude: 7.65, longitude: 5.19 };

    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });
});

describe("distanceBetween", () => {
  it("returns null when either end has not been geocoded", () => {
    const point = { latitude: 7.6, longitude: 5.2 };

    expect(distanceBetween(point, { latitude: null, longitude: null })).toBeNull();
    expect(distanceBetween(null, point)).toBeNull();
    // A half-set coordinate must never be treated as a location.
    expect(distanceBetween(point, { latitude: 7.6, longitude: null })).toBeNull();
  });
});

describe("quoteDeliveryFee", () => {
  it("adds the per-kilometre rate to the base fee", () => {
    // 3 km × ₦100 = ₦300, plus the ₦200 base = ₦500.
    expect(quoteDeliveryFee(3_000, pricing).feeKobo).toBe(50_000);
  });

  it("raises a short trip to the campus minimum", () => {
    // ₦200 base + ₦10 for 100 m is below the ₦250 floor.
    const quote = quoteDeliveryFee(100, pricing);

    expect(quote.feeKobo).toBe(pricing.deliveryMinimumFeeKobo);
    expect(quote.clamped).toBe(true);
  });

  it("caps a long trip at the campus maximum", () => {
    const quote = quoteDeliveryFee(50_000, pricing);

    expect(quote.feeKobo).toBe(pricing.deliveryMaximumFeeKobo);
    expect(quote.clamped).toBe(true);
  });

  it("charges the base fee alone when the distance is unknown", () => {
    // Still clamped, so the campus floor holds even without coordinates.
    expect(quoteDeliveryFee(null, pricing).feeKobo).toBe(pricing.deliveryMinimumFeeKobo);
    expect(quoteDeliveryFee(null, { ...pricing, deliveryMinimumFeeKobo: 0 }).feeKobo).toBe(
      pricing.deliveryBaseFeeKobo,
    );
  });

  it("always returns whole kobo", () => {
    const quote = quoteDeliveryFee(1_234, pricing);

    expect(Number.isInteger(quote.feeKobo)).toBe(true);
  });

  it("rejects a negative distance rather than discounting the trip", () => {
    expect(() => quoteDeliveryFee(-1, pricing)).toThrow(/non-negative/);
  });
});

describe("generateOrderReference", () => {
  it("is readable aloud: no characters that are easy to mishear", () => {
    const reference = generateOrderReference(() => 0.999);

    expect(reference).toMatch(/^CM-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
    expect(reference).not.toMatch(/[01OI]/);
  });

  it("varies between calls", () => {
    const references = new Set(Array.from({ length: 50 }, () => generateOrderReference()));

    expect(references.size).toBeGreaterThan(45);
  });
});

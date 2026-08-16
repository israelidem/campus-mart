import { describe, expect, it } from "vitest";

import {
  DISPUTE_WINDOW_DAYS,
  attributeRefund,
  canTransitionDispute,
  canWithdrawDispute,
  disputeWindowDaysRemaining,
  generateDisputeReference,
  isDisputeLive,
  isWithinDisputeWindow,
  refundCapacity,
  resolveRefundAmount,
} from "@/lib/disputes/dispute-policy";

/**
 * Phase 11 policy tests (PRD §60–63).
 *
 * These assert the money rules, not the plumbing. Every case below is one a
 * campus admin could actually produce by clicking something, which is why the
 * awkward ones — a refund that does not divide evenly, a second refund against a
 * payment that was already partly returned — are here rather than only the
 * arithmetic that works out neatly.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("dispute window", () => {
  const completed = new Date("2026-03-01T12:00:00Z");

  it("is open immediately after the delivery completes", () => {
    expect(isWithinDisputeWindow(completed, completed)).toBe(true);
  });

  it("is open on the last hour of the last day", () => {
    const almost = new Date(completed.getTime() + DISPUTE_WINDOW_DAYS * DAY - HOUR);
    expect(isWithinDisputeWindow(completed, almost)).toBe(true);
  });

  it("closes once the window has fully elapsed", () => {
    const after = new Date(completed.getTime() + DISPUTE_WINDOW_DAYS * DAY + 1);
    expect(isWithinDisputeWindow(completed, after)).toBe(false);
  });

  it("treats an unfinished delivery as undisputable", () => {
    expect(isWithinDisputeWindow(null, completed)).toBe(false);
    expect(disputeWindowDaysRemaining(null, completed)).toBe(0);
  });

  it("refuses a clock that runs backwards rather than trusting it", () => {
    const before = new Date(completed.getTime() - HOUR);
    expect(isWithinDisputeWindow(completed, before)).toBe(false);
  });

  it("counts down in whole days", () => {
    expect(disputeWindowDaysRemaining(completed, completed)).toBe(DISPUTE_WINDOW_DAYS);
    const twoDaysIn = new Date(completed.getTime() + 2 * DAY);
    expect(disputeWindowDaysRemaining(completed, twoDaysIn)).toBe(DISPUTE_WINDOW_DAYS - 2);
    const expired = new Date(completed.getTime() + 30 * DAY);
    expect(disputeWindowDaysRemaining(completed, expired)).toBe(0);
  });
});

describe("dispute status machine", () => {
  it("lets an admin pick up an open case, then resolve it", () => {
    expect(canTransitionDispute("OPEN", "UNDER_REVIEW")).toBe(true);
    expect(canTransitionDispute("UNDER_REVIEW", "RESOLVED")).toBe(true);
  });

  it("lets an admin resolve without formally picking it up first", () => {
    expect(canTransitionDispute("OPEN", "RESOLVED")).toBe(true);
  });

  it("treats resolved and withdrawn as terminal", () => {
    for (const to of ["OPEN", "UNDER_REVIEW", "RESOLVED", "WITHDRAWN"] as const) {
      expect(canTransitionDispute("RESOLVED", to)).toBe(false);
      expect(canTransitionDispute("WITHDRAWN", to)).toBe(false);
    }
  });

  it("never returns a case to OPEN once it is under review", () => {
    expect(canTransitionDispute("UNDER_REVIEW", "OPEN")).toBe(false);
  });

  it("knows which states are live, because the database index depends on it", () => {
    expect(isDisputeLive("OPEN")).toBe(true);
    expect(isDisputeLive("UNDER_REVIEW")).toBe(true);
    expect(isDisputeLive("RESOLVED")).toBe(false);
    expect(isDisputeLive("WITHDRAWN")).toBe(false);
  });

  it("lets a student withdraw while an admin is already looking", () => {
    expect(canWithdrawDispute("UNDER_REVIEW")).toBe(true);
    expect(canWithdrawDispute("RESOLVED")).toBe(false);
  });
});

describe("resolveRefundAmount", () => {
  const goods = 500_000; // ₦5,000

  it("derives a full refund from the goods total, not from the admin", () => {
    expect(resolveRefundAmount({ resolution: "FULL_REFUND", goodsSubtotalKobo: goods })).toEqual({
      refundAmountKobo: goods,
      refundRequired: true,
    });
  });

  it("ignores an amount supplied alongside a full refund", () => {
    const decision = resolveRefundAmount({
      resolution: "FULL_REFUND",
      goodsSubtotalKobo: goods,
      requestedAmountKobo: 1,
    });
    expect(decision.refundAmountKobo).toBe(goods);
  });

  it("closes a declined complaint with an outcome and no money", () => {
    expect(resolveRefundAmount({ resolution: "NO_REFUND", goodsSubtotalKobo: goods })).toEqual({
      refundAmountKobo: 0,
      refundRequired: false,
    });
  });

  it("accepts a partial refund strictly between nothing and everything", () => {
    const decision = resolveRefundAmount({
      resolution: "PARTIAL_REFUND",
      goodsSubtotalKobo: goods,
      requestedAmountKobo: 150_000,
    });
    expect(decision).toEqual({ refundAmountKobo: 150_000, refundRequired: true });
  });

  it("refuses a partial refund with no amount", () => {
    expect(() =>
      resolveRefundAmount({ resolution: "PARTIAL_REFUND", goodsSubtotalKobo: goods }),
    ).toThrow(/needs an amount/);
  });

  it("refuses a partial refund that is really a full one", () => {
    expect(() =>
      resolveRefundAmount({
        resolution: "PARTIAL_REFUND",
        goodsSubtotalKobo: goods,
        requestedAmountKobo: goods,
      }),
    ).toThrow(/FULL_REFUND/);
  });

  it("refuses a partial refund that is really no refund", () => {
    expect(() =>
      resolveRefundAmount({
        resolution: "PARTIAL_REFUND",
        goodsSubtotalKobo: goods,
        requestedAmountKobo: 0,
      }),
    ).toThrow(/NO_REFUND/);
  });

  it("refuses a partial refund larger than the purchase", () => {
    expect(() =>
      resolveRefundAmount({
        resolution: "PARTIAL_REFUND",
        goodsSubtotalKobo: goods,
        requestedAmountKobo: goods + 1,
      }),
    ).toThrow();
  });

  it("refuses fractional kobo from a client that sent naira by mistake", () => {
    expect(() =>
      resolveRefundAmount({
        resolution: "PARTIAL_REFUND",
        goodsSubtotalKobo: goods,
        requestedAmountKobo: 150.5,
      }),
    ).toThrow();
  });
});

describe("attributeRefund", () => {
  // ₦5,000 of goods at 2.5% commission: ₦125 platform, ₦4,875 vendor.
  const snapshot = { goodsSubtotalKobo: 500_000, commissionKobo: 12_500, vendorPayoutKobo: 487_500 };

  it("unwinds a full refund into exactly the original split", () => {
    expect(attributeRefund({ ...snapshot, refundAmountKobo: 500_000 })).toEqual({
      fromPlatformKobo: 12_500,
      fromVendorKobo: 487_500,
    });
  });

  it("splits a half refund in the same proportion as the sale", () => {
    expect(attributeRefund({ ...snapshot, refundAmountKobo: 250_000 })).toEqual({
      fromPlatformKobo: 6_250,
      fromVendorKobo: 243_750,
    });
  });

  it("costs nobody anything when nothing is refunded", () => {
    expect(attributeRefund({ ...snapshot, refundAmountKobo: 0 })).toEqual({
      fromPlatformKobo: 0,
      fromVendorKobo: 0,
    });
  });

  it("always splits the whole amount, even when it does not divide evenly", () => {
    // 3 kobo of a 7-kobo sale, where the split itself is uneven.
    const parts = attributeRefund({
      goodsSubtotalKobo: 7,
      commissionKobo: 2,
      vendorPayoutKobo: 5,
      refundAmountKobo: 3,
    });
    expect(parts.fromPlatformKobo + parts.fromVendorKobo).toBe(3);
    // floor(3 * 5 / 7) = 2, so the odd kobo falls on the platform.
    expect(parts).toEqual({ fromPlatformKobo: 1, fromVendorKobo: 2 });
  });

  it("never charges the vendor more than its proportional share", () => {
    for (let refund = 1; refund <= 500_000; refund += 4_999) {
      const parts = attributeRefund({ ...snapshot, refundAmountKobo: refund });
      expect(parts.fromPlatformKobo + parts.fromVendorKobo).toBe(refund);
      expect(parts.fromVendorKobo).toBeLessThanOrEqual(snapshot.vendorPayoutKobo);
      expect(parts.fromPlatformKobo).toBeGreaterThanOrEqual(0);
      expect(parts.fromVendorKobo).toBeLessThanOrEqual((refund * snapshot.vendorPayoutKobo) / snapshot.goodsSubtotalKobo);
    }
  });

  it("refuses a snapshot whose parts do not add up", () => {
    expect(() =>
      attributeRefund({
        goodsSubtotalKobo: 500_000,
        commissionKobo: 12_500,
        vendorPayoutKobo: 400_000,
        refundAmountKobo: 1_000,
      }),
    ).toThrow(/does not balance/);
  });

  it("refuses to refund more than the goods cost", () => {
    expect(() => attributeRefund({ ...snapshot, refundAmountKobo: 500_001 })).toThrow(/exceeds/);
  });
});

describe("refundCapacity", () => {
  it("allows a first full refund and reports the payment as fully returned", () => {
    const result = refundCapacity({
      paymentAmountKobo: 500_000,
      alreadyRefundedKobo: 0,
      requestedKobo: 500_000,
    });
    expect(result).toEqual({ allowed: true, remainingAfterKobo: 0, fullyRefunded: true });
  });

  it("allows a partial refund and reports what is left", () => {
    const result = refundCapacity({
      paymentAmountKobo: 500_000,
      alreadyRefundedKobo: 0,
      requestedKobo: 200_000,
    });
    expect(result).toEqual({ allowed: true, remainingAfterKobo: 300_000, fullyRefunded: false });
  });

  it("allows a second refund that exactly exhausts the payment", () => {
    const result = refundCapacity({
      paymentAmountKobo: 500_000,
      alreadyRefundedKobo: 200_000,
      requestedKobo: 300_000,
    });
    expect(result).toEqual({ allowed: true, remainingAfterKobo: 0, fullyRefunded: true });
  });

  it("refuses a second refund that would exceed what arrived", () => {
    const result = refundCapacity({
      paymentAmountKobo: 500_000,
      alreadyRefundedKobo: 200_000,
      requestedKobo: 300_001,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/300000 kobo/);
  });

  it("refuses anything against an already fully refunded payment", () => {
    const result = refundCapacity({
      paymentAmountKobo: 500_000,
      alreadyRefundedKobo: 500_000,
      requestedKobo: 1,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/in full/);
  });

  it("refuses a zero refund rather than writing a row that moved no money", () => {
    const result = refundCapacity({
      paymentAmountKobo: 500_000,
      alreadyRefundedKobo: 0,
      requestedKobo: 0,
    });
    expect(result.allowed).toBe(false);
  });

  it("escalates an already over-refunded payment instead of quietly allowing more", () => {
    const result = refundCapacity({
      paymentAmountKobo: 500_000,
      alreadyRefundedKobo: 600_000,
      requestedKobo: 1,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/support/);
  });
});

describe("generateDisputeReference", () => {
  it("is prefixed and readable", () => {
    expect(generateDisputeReference(() => 0)).toBe("DS-000000");
    expect(generateDisputeReference()).toMatch(/^DS-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  });

  it("omits the letters that are misread over a phone", () => {
    const references = Array.from({ length: 200 }, () => generateDisputeReference());
    for (const reference of references) {
      expect(reference).not.toMatch(/[ILOU]/);
    }
  });
});

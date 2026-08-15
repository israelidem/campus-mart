import { describe, expect, it } from "vitest";

import {
  generatePaymentReference,
  signWebhookPayload,
  verifyWebhookSignature,
} from "@/lib/payments/paystack";
import {
  amountMatches,
  deliveryFeeSettlement,
  goodsSettlement,
  isSuccessfulTransaction,
} from "@/lib/payments/settlement";
import { paymentReferenceSchema } from "@/validations/payment";

/**
 * Phase 8 tests.
 *
 * These cover the two places where a mistake costs someone real money: how a
 * payment is split, and whether a webhook is genuine. Both are pure functions
 * precisely so they can be asserted without a database or a network.
 */

const SECRET = "sk_test_phase8_secret_value";

describe("goodsSettlement", () => {
  const base = {
    goodsSubtotalKobo: 500_000,
    commissionKobo: 12_500, // 2.5%
    vendorPayoutKobo: 487_500,
  };

  it("routes the vendor's share and leaves the commission with the platform", () => {
    const settlement = goodsSettlement({ ...base, vendorSubaccountCode: "ACCT_vendor1" });

    expect(settlement.amountKobo).toBe(500_000);
    expect(settlement.subaccounts).toEqual([{ subaccount: "ACCT_vendor1", share: 487_500 }]);
    expect(settlement.platformKobo).toBe(12_500);
    expect(settlement.vendorRouted).toBe(true);
  });

  it("keeps the whole amount when the vendor has no subaccount, and says so", () => {
    const settlement = goodsSettlement({ ...base, vendorSubaccountCode: null });

    expect(settlement.subaccounts).toEqual([]);
    // The platform is holding the vendor's money, so the figure must reflect
    // that rather than pretending the split happened.
    expect(settlement.platformKobo).toBe(500_000);
    expect(settlement.vendorRouted).toBe(false);
  });

  it("treats a blank subaccount code as no subaccount", () => {
    expect(goodsSettlement({ ...base, vendorSubaccountCode: "   " }).vendorRouted).toBe(false);
  });

  it("refuses a split that does not balance", () => {
    expect(() =>
      goodsSettlement({ ...base, commissionKobo: 13_000, vendorSubaccountCode: "ACCT_v" }),
    ).toThrow(/does not balance/);
  });

  it("refuses fractional kobo", () => {
    expect(() =>
      goodsSettlement({
        goodsSubtotalKobo: 100.5,
        commissionKobo: 0.5,
        vendorPayoutKobo: 100,
      }),
    ).toThrow();
  });

  it("refuses a zero-value sale", () => {
    expect(() =>
      goodsSettlement({ goodsSubtotalKobo: 0, commissionKobo: 0, vendorPayoutKobo: 0 }),
    ).toThrow(/positive amount/);
  });

  it("does not split when the vendor's share is nothing", () => {
    const settlement = goodsSettlement({
      goodsSubtotalKobo: 1_000,
      commissionKobo: 1_000,
      vendorPayoutKobo: 0,
      vendorSubaccountCode: "ACCT_vendor1",
    });

    expect(settlement.subaccounts).toEqual([]);
    expect(settlement.vendorRouted).toBe(false);
  });
});

describe("deliveryFeeSettlement", () => {
  it("keeps the fee in the platform account, because no agent exists yet", () => {
    const settlement = deliveryFeeSettlement(25_000);

    expect(settlement.amountKobo).toBe(25_000);
    expect(settlement.subaccounts).toEqual([]);
    expect(settlement.platformKobo).toBe(25_000);
  });

  it("refuses a zero fee", () => {
    expect(() => deliveryFeeSettlement(0)).toThrow(/positive amount/);
  });
});

describe("amountMatches", () => {
  it("accepts only the exact amount", () => {
    expect(amountMatches(500_000, 500_000)).toBe(true);
    // A short payment must never release goods, and an overpayment is a refund
    // case rather than a windfall.
    expect(amountMatches(500_000, 499_999)).toBe(false);
    expect(amountMatches(500_000, 500_001)).toBe(false);
    expect(amountMatches(500_000, 500_000.5)).toBe(false);
  });
});

describe("isSuccessfulTransaction", () => {
  it("recognises only success", () => {
    expect(isSuccessfulTransaction("success")).toBe(true);
    expect(isSuccessfulTransaction("SUCCESS")).toBe(true);
    expect(isSuccessfulTransaction("ongoing")).toBe(false);
    expect(isSuccessfulTransaction("failed")).toBe(false);
    expect(isSuccessfulTransaction(null)).toBe(false);
    expect(isSuccessfulTransaction(undefined)).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "CM-DF-ABCDEF012345" } });
  const sign = (payload: string, key = SECRET) => signWebhookPayload(payload, key);

  it("accepts a signature computed over the exact raw body", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body that changed after signing", () => {
    const tampered = body.replace("CM-DF-ABCDEF012345", "CM-DF-000000000000");
    expect(verifyWebhookSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("rejects a signature from a different secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "another-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "not-a-signature", SECRET)).toBe(false);
  });

  it("tolerates surrounding whitespace in the header", () => {
    expect(verifyWebhookSignature(body, ` ${sign(body)} `, SECRET)).toBe(true);
  });

});

describe("payment references", () => {
  it("generates references the API is willing to accept back", () => {
    for (const purpose of ["DF", "GD"] as const) {
      const reference = generatePaymentReference(purpose);
      expect(reference.startsWith(`CM-${purpose}-`)).toBe(true);
      expect(paymentReferenceSchema.safeParse(reference).success).toBe(true);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePaymentReference("GD")));
    expect(seen.size).toBe(500);
  });

  it("rejects references we did not issue", () => {
    for (const bad of ["", "CM-XX-ABCDEF012345", "CM-DF-lowercase123", "CM-DF-ABC"]) {
      expect(paymentReferenceSchema.safeParse(bad).success).toBe(false);
    }
  });
});

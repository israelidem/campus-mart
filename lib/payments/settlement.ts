import { assertKobo, type Kobo } from "@/lib/money";
import type { SplitSubaccount } from "@/lib/payments/paystack";

/**
 * Who gets what, in kobo (PRD §34–35).
 *
 * Pure arithmetic, no Prisma and no network, so the split can be asserted in
 * tests without a database. The inputs are the values snapshotted on the
 * `VendorOrder` at checkout — Phase 5 already froze the commission rate there,
 * so a campus changing its rate today cannot alter what an in-flight order owes.
 */

export type GoodsSettlementInput = {
  /** What the student pays for this vendor's goods. */
  goodsSubtotalKobo: Kobo;
  /** Platform's cut, snapshotted at checkout. */
  commissionKobo: Kobo;
  /** What the vendor is owed. */
  vendorPayoutKobo: Kobo;
  /** The vendor's Paystack subaccount, when they have onboarded one. */
  vendorSubaccountCode?: string | null;
};

export type Settlement = {
  /** Total to charge the payer. */
  amountKobo: Kobo;
  /** Flat-amount split instructions for Paystack. */
  subaccounts: SplitSubaccount[];
  /** What remains in the platform account after the split. */
  platformKobo: Kobo;
  /**
   * True when the vendor's share is being routed to them by Paystack. False
   * means the whole amount lands in the platform account and the vendor must be
   * settled by a separate transfer — recorded so a payout is never silently
   * assumed to have happened.
   */
  vendorRouted: boolean;
};

/**
 * The goods payment for one vendor order.
 *
 * Goods are paid per delivery, so exactly one vendor is ever involved: the
 * split is one subaccount at most. The identity
 * `commission + payout === subtotal` is asserted rather than recomputed — if the
 * stored values disagree, something upstream is wrong and charging the student
 * would make it worse.
 */
export function goodsSettlement(input: GoodsSettlementInput): Settlement {
  const subtotal = assertKobo(input.goodsSubtotalKobo, "goodsSubtotalKobo");
  const commission = assertKobo(input.commissionKobo, "commissionKobo");
  const payout = assertKobo(input.vendorPayoutKobo, "vendorPayoutKobo");

  if (commission + payout !== subtotal) {
    throw new Error(
      `Settlement does not balance: commission ${commission} + payout ${payout} != subtotal ${subtotal}`,
    );
  }
  if (subtotal === 0) {
    throw new Error("A goods payment must be for a positive amount");
  }

  const code = input.vendorSubaccountCode?.trim();
  // A zero-share split is meaningless to Paystack, and a vendor whose entire
  // subtotal is commission would produce one.
  const canRoute = Boolean(code) && payout > 0;

  return {
    amountKobo: subtotal,
    subaccounts: canRoute ? [{ subaccount: code as string, share: payout }] : [],
    platformKobo: canRoute ? commission : subtotal,
    vendorRouted: canRoute,
  };
}

/**
 * The delivery fee.
 *
 * Paid before any agent has accepted the job (PRD §32), so there is nobody to
 * split it to at the time it is charged: it lands in the platform account and
 * the agent is settled after the delivery completes. The function exists to make
 * that fact explicit at the call site rather than implied by an absent split.
 */
export function deliveryFeeSettlement(deliveryFeeKobo: Kobo): Settlement {
  const amount = assertKobo(deliveryFeeKobo, "deliveryFeeKobo");
  if (amount === 0) {
    throw new Error("A delivery fee payment must be for a positive amount");
  }

  return {
    amountKobo: amount,
    subaccounts: [],
    platformKobo: amount,
    vendorRouted: false,
  };
}

/**
 * Does the money that arrived match what we asked for?
 *
 * Paystack reports the amount it actually captured. Anything other than the
 * exact expected amount is refused rather than reconciled: a short payment must
 * not release goods, and an over-payment is a refund case, not a windfall.
 */
export function amountMatches(expectedKobo: Kobo, reportedKobo: number): boolean {
  return Number.isSafeInteger(reportedKobo) && reportedKobo === assertKobo(expectedKobo);
}

/** Paystack's own vocabulary for "the money is in". */
export function isSuccessfulTransaction(status: string | null | undefined): boolean {
  return status?.toLowerCase() === "success";
}

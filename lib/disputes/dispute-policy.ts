import { assertKobo, type Kobo } from "@/lib/money";

/**
 * Dispute and refund policy (PRD §60–63).
 *
 * Pure functions: no Prisma, no network, no clock of their own. Every decision
 * that decides whether a student gets money back, and whose money it is, lives
 * here so it can be asserted in tests without a database — the same reason
 * `lib/payments/settlement.ts` exists.
 *
 * The service layer is responsible for *reading* the facts and *writing* the
 * consequences. This file is responsible for the arithmetic and the rules, and
 * it never guesses: a question it cannot answer from its inputs is returned as a
 * refusal, not resolved with a default.
 */

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * How long after a delivery completes a student may open a case.
 *
 * Seven days rather than "forever": a complaint about food or a phone charger is
 * only investigable while the evidence and the memory still exist, and an
 * unbounded window would leave every completed sale permanently reversible,
 * which no vendor can plan around. It is a platform constant rather than a campus
 * setting because a student's right to complain should not be shorter on one
 * campus than another (PRD §60).
 */
export const DISPUTE_WINDOW_DAYS = 7;

/** The same window in milliseconds, so callers do not repeat the conversion. */
export const DISPUTE_WINDOW_MS = DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Is a purchase still disputable?
 *
 * Measured from the moment the delivery completed, not from when the order was
 * placed: a package that took two days to arrive should not have two days less of
 * complaint window. `completedAt` being null means the delivery never finished,
 * and an unfinished delivery is not a dispute — it is a delivery still in
 * progress, which the delivery engine already handles.
 */
export function isWithinDisputeWindow(completedAt: Date | null, now: Date): boolean {
  if (!completedAt) return false;
  const elapsed = now.getTime() - completedAt.getTime();
  return elapsed >= 0 && elapsed <= DISPUTE_WINDOW_MS;
}

/** Whole days left to file, floored, for display. Zero once the window closes. */
export function disputeWindowDaysRemaining(completedAt: Date | null, now: Date): number {
  if (!completedAt) return 0;
  const remaining = DISPUTE_WINDOW_MS - (now.getTime() - completedAt.getTime());
  if (remaining <= 0) return 0;
  return Math.floor(remaining / (24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

/** Mirrors the Prisma enum, declared locally so this file imports no client. */
export type DisputeStatusName = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "WITHDRAWN";

/** Mirrors the Prisma enum. */
export type DisputeResolutionName = "FULL_REFUND" | "PARTIAL_REFUND" | "NO_REFUND";

/**
 * The only status changes that exist.
 *
 * Written as a table rather than scattered `if`s so the whole lifecycle is
 * readable at once, and so an unlisted transition is impossible by construction
 * rather than merely unimplemented. RESOLVED and WITHDRAWN are terminal: a closed
 * case is reopened by filing a new one, which keeps the first decision and its
 * reasoning intact.
 */
const ALLOWED_TRANSITIONS: Record<DisputeStatusName, readonly DisputeStatusName[]> = {
  OPEN: ["UNDER_REVIEW", "RESOLVED", "WITHDRAWN"],
  // An admin who has picked a case up may still resolve it; the student may
  // still withdraw it, because "someone is looking at it" is not consent.
  UNDER_REVIEW: ["RESOLVED", "WITHDRAWN"],
  RESOLVED: [],
  WITHDRAWN: [],
};

export function canTransitionDispute(
  from: DisputeStatusName,
  to: DisputeStatusName,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** True while a case is still actionable — the state the DB index guards. */
export function isDisputeLive(status: DisputeStatusName): boolean {
  return status === "OPEN" || status === "UNDER_REVIEW";
}

/**
 * May the student who filed it still take it back?
 *
 * Only while it is live. Withdrawing a resolved case would erase an outcome that
 * has already moved money.
 */
export function canWithdrawDispute(status: DisputeStatusName): boolean {
  return isDisputeLive(status);
}

// ---------------------------------------------------------------------------
// Resolution arithmetic
// ---------------------------------------------------------------------------

export type ResolutionInput = {
  resolution: DisputeResolutionName;
  /** What the goods cost, snapshotted on the dispute. The ceiling. */
  goodsSubtotalKobo: Kobo;
  /**
   * The admin's figure, for a partial refund only. Ignored for the other two
   * outcomes: a full refund's amount is not a matter of opinion, and a declined
   * complaint has no amount at all.
   */
  requestedAmountKobo?: number | null;
};

export type ResolutionDecision = {
  /** What to send back. Zero for NO_REFUND. */
  refundAmountKobo: Kobo;
  /** True when money must actually move, i.e. a Refund row is warranted. */
  refundRequired: boolean;
};

/**
 * Turn an outcome into an amount.
 *
 * The amount is *derived* for FULL_REFUND and NO_REFUND, and only taken from the
 * admin for PARTIAL_REFUND. That asymmetry is deliberate: the two unambiguous
 * outcomes must not be able to disagree with their own labels, and the ambiguous
 * one is the only place a human judgement is needed.
 *
 * A "partial" refund of the full amount, or of nothing, is refused rather than
 * silently reclassified — the admin has chosen the wrong outcome, and quietly
 * fixing it would record a decision nobody made.
 */
export function resolveRefundAmount(input: ResolutionInput): ResolutionDecision {
  const goods = assertKobo(input.goodsSubtotalKobo, "goodsSubtotalKobo");

  switch (input.resolution) {
    case "NO_REFUND":
      return { refundAmountKobo: 0, refundRequired: false };

    case "FULL_REFUND":
      if (goods === 0) {
        // Nothing was charged, so there is nothing to send back. Upholding the
        // complaint without money is what NO_REFUND is for.
        throw new Error("A full refund of a zero-value purchase is not a refund");
      }
      return { refundAmountKobo: goods, refundRequired: true };

    case "PARTIAL_REFUND": {
      const requested = input.requestedAmountKobo;
      if (requested === null || requested === undefined) {
        throw new Error("A partial refund needs an amount");
      }
      const amount = assertKobo(requested, "requestedAmountKobo");
      if (amount === 0) {
        throw new Error("A partial refund of nothing is a NO_REFUND resolution");
      }
      if (amount >= goods) {
        throw new Error("A partial refund of the whole amount is a FULL_REFUND resolution");
      }
      return { refundAmountKobo: amount, refundRequired: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Refund attribution
// ---------------------------------------------------------------------------

export type AttributionInput = {
  /** The total going back to the student. */
  refundAmountKobo: Kobo;
  /** The goods total the refund is a fraction of. */
  goodsSubtotalKobo: Kobo;
  /** The platform's cut of those goods, snapshotted at checkout. */
  commissionKobo: Kobo;
  /** The vendor's share of those goods, snapshotted at checkout. */
  vendorPayoutKobo: Kobo;
};

export type Attribution = {
  /** The part the platform gives up out of its commission. */
  fromPlatformKobo: Kobo;
  /** The part taken out of what the vendor was owed. */
  fromVendorKobo: Kobo;
};

/**
 * Whose money is being sent back (PRD §35, §63)?
 *
 * A refund is not a platform expense and it is not a vendor penalty: it is the
 * *unwinding* of a sale, so each party gives back the share it was going to
 * keep, in the same proportion. Refunding half the goods therefore costs the
 * platform half its commission and the vendor half its payout.
 *
 * The alternative — taking the whole refund out of the vendor's share — would
 * mean the platform still earned commission on a sale it agreed had failed, and
 * a vendor could lose more than they were ever going to be paid.
 *
 * The vendor's share is computed and the platform's is the remainder, so the
 * parts always sum to the total exactly. Rounding therefore falls on the
 * platform: a sub-kobo ambiguity should not cost the smaller party, and the
 * platform is the one with the ledger to absorb it.
 */
export function attributeRefund(input: AttributionInput): Attribution {
  const refund = assertKobo(input.refundAmountKobo, "refundAmountKobo");
  const goods = assertKobo(input.goodsSubtotalKobo, "goodsSubtotalKobo");
  const commission = assertKobo(input.commissionKobo, "commissionKobo");
  const payout = assertKobo(input.vendorPayoutKobo, "vendorPayoutKobo");

  if (commission + payout !== goods) {
    throw new Error(
      `Snapshot does not balance: commission ${commission} + payout ${payout} != goods ${goods}`,
    );
  }
  if (refund > goods) {
    throw new Error(`Refund ${refund} exceeds the goods total ${goods}`);
  }
  if (refund === 0) return { fromPlatformKobo: 0, fromVendorKobo: 0 };
  if (goods === 0) {
    // Unreachable while refund > 0 and refund <= goods, but stated so the
    // division below can never be by zero regardless of future callers.
    throw new Error("Cannot attribute a refund against a zero-value purchase");
  }

  // Floor, not round: the vendor's share can never be inflated past its
  // proportion by rounding, and the remainder is the platform's to give up.
  const fromVendor = Math.floor((refund * payout) / goods);

  // The remainder, by construction, so the two parts always sum to the total.
  return { fromPlatformKobo: refund - fromVendor, fromVendorKobo: fromVendor };

}

// ---------------------------------------------------------------------------
// Refund capacity
// ---------------------------------------------------------------------------

export type RefundCapacityInput = {
  /** What the payment actually captured. */
  paymentAmountKobo: Kobo;
  /** Cumulative kobo already sent back against it. */
  alreadyRefundedKobo: Kobo;
  /** What is being asked for now. */
  requestedKobo: Kobo;
};

export type RefundCapacity =
  | { allowed: true; remainingAfterKobo: Kobo; fullyRefunded: boolean }
  | { allowed: false; reason: string };

/**
 * Can this refund be sent at all?
 *
 * The one invariant that cannot be relaxed: the platform may never send back more
 * than it received. Checked here as well as by a database constraint, because the
 * database's answer is an exception and this one is a sentence a person can read.
 *
 * `fullyRefunded` tells the caller which status the payment lands in, so the
 * decision is made once, here, rather than re-derived at each write site.
 */
export function refundCapacity(input: RefundCapacityInput): RefundCapacity {
  const captured = assertKobo(input.paymentAmountKobo, "paymentAmountKobo");
  const already = assertKobo(input.alreadyRefundedKobo, "alreadyRefundedKobo");
  const requested = assertKobo(input.requestedKobo, "requestedKobo");

  if (already > captured) {
    return {
      allowed: false,
      reason: "This payment is already recorded as over-refunded and needs support",
    };
  }
  if (requested === 0) return { allowed: false, reason: "A refund must be for a positive amount" };

  const remaining = captured - already;
  if (requested > remaining) {
    return {
      allowed: false,
      reason:
        remaining === 0
          ? "This payment has already been refunded in full"
          : `Only ${remaining} kobo of this payment is still refundable`,
    };
  }

  const after = already + requested;
  return { allowed: true, remainingAfterKobo: captured - after, fullyRefunded: after === captured };
}

// ---------------------------------------------------------------------------
// Human-readable reference
// ---------------------------------------------------------------------------

/**
 * Crockford-style alphabet: no I, L, O or U, so a reference read down a phone
 * line cannot be transcribed as a different one, and no accidental words appear.
 */
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A reference a student can read out, e.g. "DS-7Q4F2K".
 *
 * Randomness rather than a counter: a sequential reference tells anyone who sees
 * one how many complaints the platform has received. Uniqueness is guaranteed by
 * the unique column, not by the generator, so the caller retries on collision.
 */
export function generateDisputeReference(random: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < 6; i += 1) {
    body += REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)];
  }
  return `DS-${body}`;
}

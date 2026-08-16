-- Phase 11 guard rails: disputes and refunds (PRD §60–63)
--
-- The preceding migration created the tables. This one states the invariants the
-- money depends on, in the database, for the same reason Phase 5 put the order
-- arithmetic here: the service is the only intended writer, but a constraint is
-- the only thing that holds when a support script, a console session or a future
-- code path is the actual writer. Every rule below is one the dispute service
-- also enforces — the duplication is the point.

-- ---------------------------------------------------------------------------
-- One live case per purchase
-- ---------------------------------------------------------------------------
-- A student may file again after withdrawing, and may file again years later
-- about a different problem, so this is *not* a plain unique on vendorOrderId.
-- What must never exist is two simultaneously actionable cases against the same
-- purchase: two admins would each resolve one, and the goods would be refunded
-- twice. A partial unique index says exactly that, and nothing more.
CREATE UNIQUE INDEX "Dispute_one_live_per_vendor_order"
  ON "Dispute" ("vendorOrderId")
  WHERE "status" IN ('OPEN', 'UNDER_REVIEW');

-- ---------------------------------------------------------------------------
-- Dispute amounts
-- ---------------------------------------------------------------------------
-- Snapshotted from the vendor order at filing. The identity below is the same
-- one VendorOrder already asserts; repeating it here catches a bad snapshot at
-- the moment it is written rather than at the moment it is refunded.
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_goodsSubtotal_nonnegative" CHECK ("goodsSubtotalKobo" >= 0);
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_commission_nonnegative" CHECK ("commissionKobo" >= 0);
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_payout_nonnegative" CHECK ("vendorPayoutKobo" >= 0);
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_split_consistent"
  CHECK ("commissionKobo" + "vendorPayoutKobo" = "goodsSubtotalKobo");

-- A refund can never exceed what the goods cost. This is the ceiling PRD §62
-- describes, and it is a fact about the row, not a policy an admin may waive.
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_refund_within_goods"
  CHECK ("refundAmountKobo" IS NULL
         OR ("refundAmountKobo" >= 0 AND "refundAmountKobo" <= "goodsSubtotalKobo"));

-- ---------------------------------------------------------------------------
-- Resolution completeness
-- ---------------------------------------------------------------------------
-- A resolved case carries all four facts or it is not resolved: the outcome, the
-- explanation, the amount and the timestamp. Allowing three of the four would
-- produce a case that is closed without saying what was decided, which is the
-- one state support can do nothing with.
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_resolved_is_complete"
  CHECK (
    ("status" <> 'RESOLVED')
    OR ("resolution" IS NOT NULL
        AND "resolutionNote" IS NOT NULL
        AND "refundAmountKobo" IS NOT NULL
        AND "resolvedAt" IS NOT NULL)
  );

-- The outcome and the amount must agree. NO_REFUND with money attached, or
-- FULL_REFUND for less than the goods cost, would each mean the audit trail says
-- something different from what the student's bank saw.
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_resolution_matches_amount"
  CHECK (
    "resolution" IS NULL
    OR ("resolution" = 'NO_REFUND' AND "refundAmountKobo" = 0)
    OR ("resolution" = 'FULL_REFUND' AND "refundAmountKobo" = "goodsSubtotalKobo")
    OR ("resolution" = 'PARTIAL_REFUND'
        AND "refundAmountKobo" > 0
        AND "refundAmountKobo" < "goodsSubtotalKobo")
  );

-- A withdrawn case has a withdrawal time, and only a withdrawn case has one.
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_withdrawn_has_timestamp"
  CHECK (("status" = 'WITHDRAWN') = ("withdrawnAt" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Refund amounts
-- ---------------------------------------------------------------------------
-- A zero refund is not a refund; it is a NO_REFUND resolution, which writes no
-- row at all. Requiring a positive amount keeps "did money move?" answerable by
-- the existence of the row.
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountKobo" > 0);
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_platform_share_nonnegative" CHECK ("fromPlatformKobo" >= 0);
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_vendor_share_nonnegative" CHECK ("fromVendorKobo" >= 0);

-- The attribution must account for the whole amount. A refund whose parts do not
-- sum to its total silently moves the difference onto whichever ledger is read
-- last, and PRD §35 has no such ledger.
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_attribution_consistent"
  CHECK ("fromPlatformKobo" + "fromVendorKobo" = "amountKobo");

-- ---------------------------------------------------------------------------
-- Payment refund totals
-- ---------------------------------------------------------------------------
-- The cumulative total can never exceed what was captured. This is the single
-- most important line in the file: it is what makes "we cannot send back more
-- than arrived" true of the data, not merely of the code that writes it.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_refunded_within_amount"
  CHECK ("refundedAmountKobo" IS NULL
         OR ("refundedAmountKobo" >= 0 AND "refundedAmountKobo" <= "amountKobo"));

-- A REFUNDED payment has been fully returned; a PARTIALLY_REFUNDED one has not.
-- Without this, the status and the arithmetic could disagree, and every report
-- built on either would be wrong in a different direction.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_refund_status_consistent"
  CHECK (
    ("status" = 'REFUNDED' AND "refundedAmountKobo" = "amountKobo")
    OR ("status" = 'PARTIALLY_REFUNDED'
        AND "refundedAmountKobo" > 0
        AND "refundedAmountKobo" < "amountKobo")
    OR "status" NOT IN ('REFUNDED', 'PARTIALLY_REFUNDED')
  );

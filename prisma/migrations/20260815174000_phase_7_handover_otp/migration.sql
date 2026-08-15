-- Phase 7: hand-over code and goods-payment window (PRD §45–46)
--
-- New DeliveryEventType values are added without being used in this migration,
-- which is what lets ALTER TYPE run inside Prisma's transaction on PostgreSQL 12+.

ALTER TYPE "DeliveryEventType" ADD VALUE IF NOT EXISTS 'OTP_ISSUED';
ALTER TYPE "DeliveryEventType" ADD VALUE IF NOT EXISTS 'OTP_FAILED';
ALTER TYPE "DeliveryEventType" ADD VALUE IF NOT EXISTS 'OTP_VERIFIED';
ALTER TYPE "DeliveryEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_TIMED_OUT';
ALTER TYPE "DeliveryEventType" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- Only the HMAC of the current code is stored; the plaintext is shown to the
-- student once and is not recoverable from the database.
ALTER TABLE "Delivery"
  ADD COLUMN "otpHash" TEXT,
  ADD COLUMN "otpIssuedAt" TIMESTAMP(3),
  ADD COLUMN "otpExpiresAt" TIMESTAMP(3),
  ADD COLUMN "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "otpIssueCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "otpVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "goodsPaymentDeadline" TIMESTAMP(3);

-- The goods-payment timeout sweep reads by (status, goodsPaymentDeadline).
CREATE INDEX "Delivery_status_goodsPaymentDeadline_idx"
  ON "Delivery" ("status", "goodsPaymentDeadline");

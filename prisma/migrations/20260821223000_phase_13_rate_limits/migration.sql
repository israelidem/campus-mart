-- Phase 13: abuse controls.
--
-- One table, holding fixed-window counters keyed by action, scope, identifier and
-- window index. The primary key is the whole key string, which is what lets the
-- increment be a single atomic upsert (`ON CONFLICT (key) DO UPDATE SET hits =
-- hits + 1 RETURNING hits`) instead of a read followed by a write that two
-- serverless instances can interleave.

CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

-- The sweep deletes by expiry; without this it would scan the table on every run.
CREATE INDEX "RateLimitCounter_expiresAt_idx" ON "RateLimitCounter"("expiresAt");

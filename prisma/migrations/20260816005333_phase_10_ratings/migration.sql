-- CreateEnum
CREATE TYPE "RatingSubject" AS ENUM ('VENDOR', 'DELIVERY_AGENT');

-- AlterTable
ALTER TABLE "DeliveryAgentProfile" ADD COLUMN     "ratingAverageHundredths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingSum" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "ratingAverageHundredths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingSum" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "subject" "RatingSubject" NOT NULL,
    "raterId" TEXT NOT NULL,
    "vendorProfileId" TEXT,
    "agentProfileId" TEXT,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rating_vendorProfileId_hiddenAt_createdAt_idx" ON "Rating"("vendorProfileId", "hiddenAt", "createdAt");

-- CreateIndex
CREATE INDEX "Rating_agentProfileId_hiddenAt_createdAt_idx" ON "Rating"("agentProfileId", "hiddenAt", "createdAt");

-- CreateIndex
CREATE INDEX "Rating_campusId_hiddenAt_createdAt_idx" ON "Rating"("campusId", "hiddenAt", "createdAt");

-- CreateIndex
CREATE INDEX "Rating_raterId_createdAt_idx" ON "Rating"("raterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_deliveryId_subject_key" ON "Rating"("deliveryId", "subject");

-- CreateIndex
CREATE INDEX "DeliveryAgentProfile_campusId_ratingAverageHundredths_idx" ON "DeliveryAgentProfile"("campusId", "ratingAverageHundredths");

-- CreateIndex
CREATE INDEX "VendorProfile_campusId_status_ratingAverageHundredths_idx" ON "VendorProfile"("campusId", "status", "ratingAverageHundredths");

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "VendorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "DeliveryAgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

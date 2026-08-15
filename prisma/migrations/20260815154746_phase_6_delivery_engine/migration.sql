-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('AWAITING_DELIVERY_PAYMENT', 'AVAILABLE', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'AWAITING_OTP', 'PAYMENT_PENDING', 'COMPLETED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryEventType" AS ENUM ('POOLED', 'ACCEPTED', 'PICKUP_EXPIRED', 'AGENT_CANCELLED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'STUDENT_UNAVAILABLE', 'RETURNED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "VendorOrderStatus" ADD VALUE 'IN_DELIVERY';

-- CreateTable
CREATE TABLE "DeliveryAgentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "isOnDuty" BOOLEAN NOT NULL DEFAULT false,
    "cancellationCount" INTEGER NOT NULL DEFAULT 0,
    "warnedAt" TIMESTAMP(3),
    "underReviewAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'AWAITING_DELIVERY_PAYMENT',
    "pickupName" TEXT NOT NULL,
    "pickupLocation" TEXT NOT NULL,
    "pickupPhone" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationNote" TEXT,
    "studentPhone" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "orderDeliveryFeeKobo" INTEGER NOT NULL,
    "agentProfileId" TEXT,
    "agentUserId" TEXT,
    "pooledAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "pickupDeadline" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "inTransitAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "waitDeadline" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "offerCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "type" "DeliveryEventType" NOT NULL,
    "actorId" TEXT,
    "actorRole" "UserRole",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAgentProfile_userId_key" ON "DeliveryAgentProfile"("userId");

-- CreateIndex
CREATE INDEX "DeliveryAgentProfile_campusId_status_idx" ON "DeliveryAgentProfile"("campusId", "status");

-- CreateIndex
CREATE INDEX "DeliveryAgentProfile_campusId_status_isOnDuty_idx" ON "DeliveryAgentProfile"("campusId", "status", "isOnDuty");

-- CreateIndex
CREATE INDEX "DeliveryAgentProfile_status_submittedAt_idx" ON "DeliveryAgentProfile"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_vendorOrderId_key" ON "Delivery"("vendorOrderId");

-- CreateIndex
CREATE INDEX "Delivery_campusId_status_idx" ON "Delivery"("campusId", "status");

-- CreateIndex
CREATE INDEX "Delivery_campusId_status_destinationLocationId_idx" ON "Delivery"("campusId", "status", "destinationLocationId");

-- CreateIndex
CREATE INDEX "Delivery_agentProfileId_status_idx" ON "Delivery"("agentProfileId", "status");

-- CreateIndex
CREATE INDEX "Delivery_agentUserId_status_idx" ON "Delivery"("agentUserId", "status");

-- CreateIndex
CREATE INDEX "Delivery_status_pickupDeadline_idx" ON "Delivery"("status", "pickupDeadline");

-- CreateIndex
CREATE INDEX "Delivery_status_waitDeadline_idx" ON "Delivery"("status", "waitDeadline");

-- CreateIndex
CREATE INDEX "DeliveryEvent_deliveryId_createdAt_idx" ON "DeliveryEvent"("deliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryEvent_campusId_type_createdAt_idx" ON "DeliveryEvent"("campusId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "DeliveryAgentProfile" ADD CONSTRAINT "DeliveryAgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAgentProfile" ADD CONSTRAINT "DeliveryAgentProfile_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAgentProfile" ADD CONSTRAINT "DeliveryAgentProfile_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_vendorOrderId_fkey" FOREIGN KEY ("vendorOrderId") REFERENCES "VendorOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "DeliveryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "DeliveryAgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryEvent" ADD CONSTRAINT "DeliveryEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

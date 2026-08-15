-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_DELIVERY_PAYMENT', 'DELIVERY_PAID', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VendorOrderStatus" AS ENUM ('PLACED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DeliveryLocation" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_DELIVERY_PAYMENT',
    "deliveryLocationId" TEXT NOT NULL,
    "deliveryLocationName" TEXT NOT NULL,
    "deliveryNote" TEXT,
    "contactPhone" TEXT NOT NULL,
    "distanceMeters" INTEGER,
    "goodsSubtotalKobo" INTEGER NOT NULL,
    "deliveryFeeKobo" INTEGER NOT NULL,
    "totalKobo" INTEGER NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "status" "VendorOrderStatus" NOT NULL DEFAULT 'PLACED',
    "goodsSubtotalKobo" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "commissionKobo" INTEGER NOT NULL,
    "vendorPayoutKobo" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unitLabel" TEXT,
    "unitPriceKobo" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalKobo" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryLocation_campusId_isActive_idx" ON "DeliveryLocation"("campusId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryLocation_campusId_slug_key" ON "DeliveryLocation"("campusId", "slug");

-- CreateIndex
CREATE INDEX "Cart_campusId_idx" ON "Cart"("campusId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_studentId_campusId_key" ON "Cart"("studentId", "campusId");

-- CreateIndex
CREATE INDEX "CartItem_campusId_idx" ON "CartItem"("campusId");

-- CreateIndex
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_productId_key" ON "CartItem"("cartId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");

-- CreateIndex
CREATE INDEX "Order_campusId_status_idx" ON "Order"("campusId", "status");

-- CreateIndex
CREATE INDEX "Order_studentId_placedAt_idx" ON "Order"("studentId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_campusId_placedAt_idx" ON "Order"("campusId", "placedAt");

-- CreateIndex
CREATE INDEX "VendorOrder_vendorProfileId_status_idx" ON "VendorOrder"("vendorProfileId", "status");

-- CreateIndex
CREATE INDEX "VendorOrder_campusId_status_idx" ON "VendorOrder"("campusId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VendorOrder_orderId_vendorProfileId_key" ON "VendorOrder"("orderId", "vendorProfileId");

-- CreateIndex
CREATE INDEX "OrderItem_vendorOrderId_idx" ON "OrderItem"("vendorOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_campusId_idx" ON "OrderItem"("campusId");

-- Money and quantity invariants are enforced by the database as well as by the
-- checkout service, so no future code path (or manual fix-up) can leave an
-- invoice that does not add up. Amounts are integer kobo (PRD §64).

-- A line of zero or negative units is not a purchase.
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);

-- Snapshotted prices may be zero (a free item) but never negative, and the line
-- total must be exactly the snapshot times the quantity.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitPriceKobo_nonnegative" CHECK ("unitPriceKobo" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_lineTotal_consistent" CHECK ("lineTotalKobo" = "unitPriceKobo" * "quantity");

-- The invoice total is the goods subtotal plus the single delivery fee.
ALTER TABLE "Order" ADD CONSTRAINT "Order_goodsSubtotal_nonnegative" CHECK ("goodsSubtotalKobo" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryFee_nonnegative" CHECK ("deliveryFeeKobo" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_consistent" CHECK ("totalKobo" = "goodsSubtotalKobo" + "deliveryFeeKobo");

-- Commission is basis points (0–10 000) and the vendor is owed the remainder,
-- so commission plus payout can never diverge from the subtotal.
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_goodsSubtotal_nonnegative" CHECK ("goodsSubtotalKobo" >= 0);
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_commissionBps_range" CHECK ("commissionBps" >= 0 AND "commissionBps" <= 10000);
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_commission_nonnegative" CHECK ("commissionKobo" >= 0);
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_payout_consistent" CHECK ("vendorPayoutKobo" = "goodsSubtotalKobo" - "commissionKobo");


-- AddForeignKey
ALTER TABLE "DeliveryLocation" ADD CONSTRAINT "DeliveryLocation_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryLocationId_fkey" FOREIGN KEY ("deliveryLocationId") REFERENCES "DeliveryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "VendorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_vendorOrderId_fkey" FOREIGN KEY ("vendorOrderId") REFERENCES "VendorOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

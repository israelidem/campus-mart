import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { assertSameCampus } from "@/lib/authorization/campus";
import { prisma } from "@/lib/db/prisma";
import { createDeliveryForVendorOrder } from "@/lib/delivery/delivery-service";
import { distanceBetween, quoteDeliveryFee } from "@/lib/delivery/pricing";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { applyBasisPoints, multiplyKobo, sumKobo, type Kobo } from "@/lib/money";
import { requireVerifiedStudent } from "@/lib/orders/cart-service";
import { generateOrderReference } from "@/lib/orders/order-reference";
import { requireApprovedVendor } from "@/lib/vendors/vendor-service";
import type { CheckoutInput, OrderCancelInput, VendorOrderStatusUpdateInput } from "@/validations/order";

/**
 * Checkout and orders (PRD §26–29).
 *
 * A checkout turns one cart into one master invoice plus a vendor order per
 * store. Everything monetary is computed here, from the server's own rows, and
 * then frozen: item names and prices, the commission rate, the delivery fee and
 * the distance it was derived from. A vendor re-pricing a product afterwards, or
 * an admin changing the campus commission, cannot rewrite an order already
 * placed.
 *
 * Stock is reserved in the same transaction, with a conditional update that only
 * succeeds while enough units remain. That is what makes two buyers racing for
 * the last unit safe: one decrement matches, the other sees zero rows changed
 * and the whole checkout is rolled back (PRD §22).
 */

export type OrderItemView = {
  id: string;
  productId: string;
  productName: string;
  unitLabel: string | null;
  unitPriceKobo: Kobo;
  quantity: number;
  lineTotalKobo: Kobo;
};

export type VendorOrderView = {
  id: string;
  vendorProfileId: string;
  storeName: string;
  status: string;
  goodsSubtotalKobo: Kobo;
  items: OrderItemView[];
  cancelledAt: Date | null;
  cancellationReason: string | null;
};

export type OrderView = {
  id: string;
  reference: string;
  status: string;
  deliveryLocationName: string;
  deliveryNote: string | null;
  contactPhone: string;
  distanceMeters: number | null;
  goodsSubtotalKobo: Kobo;
  deliveryFeeKobo: Kobo;
  totalKobo: Kobo;
  placedAt: Date;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  vendorOrders: VendorOrderView[];
};

const orderInclude = {
  vendorOrders: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      vendorProfileId: true,
      status: true,
      goodsSubtotalKobo: true,
      cancelledAt: true,
      cancellationReason: true,
      vendorProfile: { select: { storeName: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          productId: true,
          productName: true,
          unitLabel: true,
          unitPriceKobo: true,
          quantity: true,
          lineTotalKobo: true,
        },
      },
    },
  },
} as const;

type OrderRow = {
  id: string;
  reference: string;
  status: string;
  deliveryLocationName: string;
  deliveryNote: string | null;
  contactPhone: string;
  distanceMeters: number | null;
  goodsSubtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
  placedAt: Date;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  vendorOrders: {
    id: string;
    vendorProfileId: string;
    status: string;
    goodsSubtotalKobo: number;
    cancelledAt: Date | null;
    cancellationReason: string | null;
    vendorProfile: { storeName: string };
    items: OrderItemView[];
  }[];
};

function toOrderView(order: OrderRow): OrderView {
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    deliveryLocationName: order.deliveryLocationName,
    deliveryNote: order.deliveryNote,
    contactPhone: order.contactPhone,
    distanceMeters: order.distanceMeters,
    goodsSubtotalKobo: order.goodsSubtotalKobo,
    deliveryFeeKobo: order.deliveryFeeKobo,
    totalKobo: order.totalKobo,
    placedAt: order.placedAt,
    cancelledAt: order.cancelledAt,
    cancellationReason: order.cancellationReason,
    vendorOrders: order.vendorOrders.map((vendorOrder) => ({
      id: vendorOrder.id,
      vendorProfileId: vendorOrder.vendorProfileId,
      storeName: vendorOrder.vendorProfile.storeName,
      status: vendorOrder.status,
      goodsSubtotalKobo: vendorOrder.goodsSubtotalKobo,
      items: vendorOrder.items,
      cancelledAt: vendorOrder.cancelledAt,
      cancellationReason: vendorOrder.cancellationReason,
    })),
  };
}

/**

 * Places the student's cart as one invoice.
 *
 * Every amount is derived here and stored, so nothing an order shows has to be
 * recomputed later — and nothing a client sent is trusted (Rule 1).
 */
export async function checkout(actor: Actor, input: CheckoutInput): Promise<OrderView> {
  const { campusId } = await requireVerifiedStudent(actor);

  const orderId = await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { studentId_campusId: { studentId: actor.userId, campusId } },
      select: {
        id: true,
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            quantity: true,
            product: {
              select: {
                id: true,
                name: true,
                unitLabel: true,
                priceKobo: true,
                stockQuantity: true,
                isAvailable: true,
                deletedAt: true,
                vendorProfileId: true,
                vendorProfile: {
                  select: { id: true, storeName: true, status: true, acceptingOrders: true },
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) throw new ValidationError("Your cart is empty");

    // Destination: must be a live location on this campus (Rule 25 in the query).
    const location = await tx.deliveryLocation.findFirst({
      where: { id: input.deliveryLocationId, campusId, isActive: true },
      select: { id: true, name: true, latitude: true, longitude: true },
    });
    if (!location) throw new ValidationError("Choose a delivery location on your campus");

    const [campus, settings] = await Promise.all([
      tx.campus.findUniqueOrThrow({
        where: { id: campusId },
        select: { latitude: true, longitude: true },
      }),
      tx.campusSettings.findUniqueOrThrow({
        where: { campusId },
        select: {
          deliveryBaseFeeKobo: true,
          deliveryPerKmKobo: true,
          deliveryMinimumFeeKobo: true,
          deliveryMaximumFeeKobo: true,
          commissionBps: true,
        },
      }),
    ]);

    // ---- Validate and price every line, grouped by store (PRD §27) ---------
    type PlannedItem = {
      productId: string;
      productName: string;
      unitLabel: string | null;
      unitPriceKobo: Kobo;
      quantity: number;
      lineTotalKobo: Kobo;
    };
    const groups = new Map<string, { storeName: string; items: PlannedItem[] }>();

    for (const item of cart.items) {
      const { product } = item;
      if (product.deletedAt !== null || !product.isAvailable) {
        throw new ConflictError(`${product.name} is no longer available`);
      }
      if (product.vendorProfile.status !== "APPROVED" || !product.vendorProfile.acceptingOrders) {
        throw new ConflictError(`${product.vendorProfile.storeName} is not accepting orders`);
      }
      if (item.quantity > product.stockQuantity) {
        throw new ConflictError(
          `${product.name} only has ${product.stockQuantity} left in stock`,
        );
      }

      const group = groups.get(product.vendorProfileId) ?? {
        storeName: product.vendorProfile.storeName,
        items: [],
      };
      group.items.push({
        productId: product.id,
        productName: product.name,
        unitLabel: product.unitLabel,
        unitPriceKobo: product.priceKobo,
        quantity: item.quantity,
        lineTotalKobo: multiplyKobo(product.priceKobo, item.quantity),
      });
      groups.set(product.vendorProfileId, group);
    }

    const goodsSubtotalKobo = sumKobo(
      [...groups.values()].flatMap((group) => group.items.map((item) => item.lineTotalKobo)),
    );

    const distanceMeters = distanceBetween(campus, location);
    const { feeKobo: deliveryFeeKobo } = quoteDeliveryFee(distanceMeters, settings);

    const order = await tx.order.create({
      data: {
        reference: generateOrderReference(),
        campusId,
        studentId: actor.userId,
        deliveryLocationId: location.id,
        deliveryLocationName: location.name,
        deliveryNote: input.deliveryNote ?? null,
        contactPhone: input.contactPhone,
        distanceMeters,
        goodsSubtotalKobo,
        deliveryFeeKobo,
        totalKobo: goodsSubtotalKobo + deliveryFeeKobo,
      },
      select: { id: true },
    });

    for (const [vendorProfileId, group] of groups) {
      const vendorSubtotalKobo = sumKobo(group.items.map((item) => item.lineTotalKobo));
      // Commission is snapshotted per vendor order: a later settings change must
      // not alter what an already-placed order owes the platform (PRD §35).
      const commissionKobo = applyBasisPoints(vendorSubtotalKobo, settings.commissionBps);

      const vendorOrder = await tx.vendorOrder.create({
        data: {
          orderId: order.id,
          campusId,
          vendorProfileId,
          goodsSubtotalKobo: vendorSubtotalKobo,
          commissionBps: settings.commissionBps,
          commissionKobo,
          vendorPayoutKobo: vendorSubtotalKobo - commissionKobo,
        },
        select: { id: true },
      });

      for (const item of group.items) {
        await tx.orderItem.create({
          data: {
            vendorOrderId: vendorOrder.id,
            campusId,
            productId: item.productId,
            productName: item.productName,
            unitLabel: item.unitLabel,
            unitPriceKobo: item.unitPriceKobo,
            quantity: item.quantity,
            lineTotalKobo: item.lineTotalKobo,
          },
        });

        // Conditional decrement: the `gte` guard is the whole race protection.
        // If another checkout took the last unit a moment ago, no row matches
        // and this transaction aborts rather than driving stock negative.
        const reserved = await tx.product.updateMany({
          where: { id: item.productId, campusId, stockQuantity: { gte: item.quantity } },
          data: {
            stockQuantity: { decrement: item.quantity },
            soldCount: { increment: item.quantity },
          },
        });
        if (reserved.count !== 1) {
          throw new ConflictError(`${item.productName} sold out while you were checking out`);
        }

        const after = await tx.product.findUniqueOrThrow({
          where: { id: item.productId },
          select: { stockQuantity: true },
        });

        await tx.inventoryTransaction.create({
          data: {
            productId: item.productId,
            campusId,
            vendorProfileId,
            reason: "SALE",
            delta: -item.quantity,
            resultingStock: after.stockQuantity,
            note: `Reserved for order ${order.id}`,
            actorId: actor.userId,
          },
        });
      }
    }

    // The cart is emptied, not deleted: the student keeps one cart per campus.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    await recordAudit(
      {
        action: AuditAction.ORDER_PLACED,
        entityType: "Order",
        entityId: order.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        after: { goodsSubtotalKobo, deliveryFeeKobo, vendorCount: groups.size },
      },
      tx,
    );

    return order.id;
  });

  return getOrderForStudent(actor, orderId);
}

/** The student's own orders, newest first. */
export async function listStudentOrders(actor: Actor): Promise<OrderView[]> {
  const { campusId } = await requireVerifiedStudent(actor);

  const orders = await prisma.order.findMany({
    where: { campusId, studentId: actor.userId },
    orderBy: { placedAt: "desc" },
    include: orderInclude,
  });

  return (orders as unknown as OrderRow[]).map(toOrderView);
}

export async function getOrderForStudent(actor: Actor, orderId: string): Promise<OrderView> {
  const { campusId } = await requireVerifiedStudent(actor);

  const order = await prisma.order.findFirst({
    where: { id: orderId, campusId, studentId: actor.userId },
    include: orderInclude,
  });
  if (!order) throw new NotFoundError("Order not found");

  return toOrderView(order as unknown as OrderRow);
}

/**
 * The vendor's own slices, newest first.
 *
 * A vendor sees only their own slice of an invoice — never the other stores in
 * it, and never the student's other purchases (PRD §27).
 */
export async function listVendorOrders(
  actor: Actor,
  options?: { status?: string },
): Promise<
  {
    id: string;
    orderReference: string;
    status: string;
    placedAt: Date;
    goodsSubtotalKobo: Kobo;
    commissionKobo: Kobo;
    vendorPayoutKobo: Kobo;
    deliveryLocationName: string;
    contactPhone: string;
    deliveryNote: string | null;
    items: OrderItemView[];
  }[]
> {
  const vendor = await requireApprovedVendor(actor);

  const vendorOrders = await prisma.vendorOrder.findMany({
    where: {
      vendorProfileId: vendor.id,
      campusId: actor.campusId ?? undefined,
      ...(options?.status ? { status: options.status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      goodsSubtotalKobo: true,
      commissionKobo: true,
      vendorPayoutKobo: true,
      createdAt: true,
      order: {
        select: {
          reference: true,
          placedAt: true,
          deliveryLocationName: true,
          deliveryNote: true,
          contactPhone: true,
        },
      },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          productId: true,
          productName: true,
          unitLabel: true,
          unitPriceKobo: true,
          quantity: true,
          lineTotalKobo: true,
        },
      },
    },
  });

  return vendorOrders.map((vendorOrder) => ({
    id: vendorOrder.id,
    orderReference: vendorOrder.order.reference,
    status: vendorOrder.status,
    placedAt: vendorOrder.order.placedAt,
    goodsSubtotalKobo: vendorOrder.goodsSubtotalKobo,
    commissionKobo: vendorOrder.commissionKobo,
    vendorPayoutKobo: vendorOrder.vendorPayoutKobo,
    deliveryLocationName: vendorOrder.order.deliveryLocationName,
    contactPhone: vendorOrder.order.contactPhone,
    deliveryNote: vendorOrder.order.deliveryNote,
    items: vendorOrder.items,
  }));
}

/**
 * Which fulfilment transitions a vendor may make (PRD §27).
 *
 * Named transitions, not a status write: the current state is re-read inside the
 * transaction and asserted, so a stale tab cannot move a cancelled order back
 * into preparation.
 */
const VENDOR_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  PLACED: ["PREPARING"],
  PREPARING: ["READY_FOR_PICKUP"],
  // Beyond this point the delivery engine drives the slice: an agent collecting
  // the package moves it to IN_DELIVERY (Phase 6), and payment completes it
  // (Phase 8). The vendor has no further button to press.
  READY_FOR_PICKUP: [],
  IN_DELIVERY: [],
  COMPLETED: [],
  CANCELLED: [],
};

export async function updateVendorOrderStatus(
  actor: Actor,
  vendorOrderId: string,
  input: VendorOrderStatusUpdateInput,
): Promise<{ id: string; status: string }> {
  const vendor = await requireApprovedVendor(actor);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.vendorOrder.findFirst({
      where: { id: vendorOrderId, vendorProfileId: vendor.id },
      select: { id: true, status: true, campusId: true },
    });
    if (!existing) throw new NotFoundError("Order not found");

    const allowed = VENDOR_ORDER_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `An order that is ${existing.status.toLowerCase()} cannot become ${input.status.toLowerCase()}`,
      );
    }

    const updated = await tx.vendorOrder.update({
      where: { id: existing.id },
      data: { status: input.status },
      select: { id: true, status: true },
    });

    // Marking a package ready is what creates its delivery, in the same
    // transaction: a vendor order can never be ready without a delivery record,
    // and the delivery decides for itself whether the fee is settled enough to
    // enter the pool (PRD §32, §37).
    if (input.status === "READY_FOR_PICKUP") {
      await createDeliveryForVendorOrder(tx, updated.id, actor);
    }

    await recordAudit(
      {
        action: AuditAction.VENDOR_ORDER_STATUS_CHANGED,
        entityType: "VendorOrder",
        entityId: updated.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: { status: existing.status },
        after: { status: updated.status },
      },
      tx,
    );

    return updated;
  });
}

/**
 * Cancels a whole invoice and returns its reserved stock.
 *
 * Only allowed before the delivery fee is paid: once money is involved the
 * cancellation is a refund, which belongs to Phase 8. Every returned unit is
 * recorded as a RETURN inventory transaction so the ledger still explains the
 * stock level.
 */
export async function cancelOrder(
  actor: Actor,
  orderId: string,
  input: OrderCancelInput,
): Promise<OrderView> {
  const isAdmin = actor.role === "CAMPUS_ADMIN" || actor.role === "SUPER_ADMIN";
  if (!isAdmin) await requireVerifiedStudent(actor);

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        campusId: true,
        studentId: true,
        status: true,
        vendorOrders: {
          select: {
            id: true,
            vendorProfileId: true,
            status: true,
            items: { select: { productId: true, quantity: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundError("Order not found");

    assertSameCampus(actor, order.campusId);
    if (!isAdmin && order.studentId !== actor.userId) {
      throw new ForbiddenError("This is not your order");
    }

    if (order.status === "CANCELLED") throw new ConflictError("This order is already cancelled");
    if (order.status !== "AWAITING_DELIVERY_PAYMENT") {
      throw new ConflictError(
        "This order can no longer be cancelled here; a refund is required instead",
      );
    }

    const now = new Date();

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledById: actor.userId,
        cancellationReason: input.reason,
      },
    });

    for (const vendorOrder of order.vendorOrders) {
      if (vendorOrder.status === "CANCELLED") continue;

      await tx.vendorOrder.update({
        where: { id: vendorOrder.id },
        data: { status: "CANCELLED", cancelledAt: now, cancellationReason: input.reason },
      });

      for (const item of vendorOrder.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: { increment: item.quantity },
            soldCount: { decrement: item.quantity },
          },
        });

        const after = await tx.product.findUniqueOrThrow({
          where: { id: item.productId },
          select: { stockQuantity: true },
        });

        await tx.inventoryTransaction.create({
          data: {
            productId: item.productId,
            campusId: order.campusId,
            vendorProfileId: vendorOrder.vendorProfileId,
            reason: "RETURN",
            delta: item.quantity,
            resultingStock: after.stockQuantity,
            note: `Returned by cancellation of order ${order.id}`,
            actorId: actor.userId,
          },
        });
      }
    }

    await recordAudit(
      {
        action: AuditAction.ORDER_CANCELLED,
        entityType: "Order",
        entityId: order.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: order.campusId,
        before: { status: order.status },
        after: { status: "CANCELLED", reason: input.reason },
      },
      tx,
    );
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: orderInclude,
  });
  return toOrderView(order as unknown as OrderRow);
}

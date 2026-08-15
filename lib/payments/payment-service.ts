import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { prisma, type PrismaTransactionClient } from "@/lib/db/prisma";
import {
  completeDeliveryOnGoodsPayment,
  notifyPoolOfDelivery,
  publishDeliveriesForPaidOrder,
} from "@/lib/delivery/delivery-service";

import { publicEnv } from "@/lib/env";
import { ForbiddenError, NotFoundError, StateConflictError, ValidationError } from "@/lib/errors";
import type { PaymentPurpose } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { notify } from "@/lib/notifications/notification-service";
import {
  generatePaymentReference,

  initializeTransaction,
  refundTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  type VerifiedTransaction,
} from "@/lib/payments/paystack";
import {
  amountMatches,
  deliveryFeeSettlement,
  goodsSettlement,
  isSuccessfulTransaction,
  type Settlement,
} from "@/lib/payments/settlement";

/**
 * Payments (PRD §30–35, §46–50).
 *
 * The two chargeable moments are the delivery fee on a placed invoice and the
 * goods payment after a verified hand-over. Everything here obeys four rules:
 *
 * 1. **A client may only ask to pay.** It states an order or a delivery, never
 *    an amount. Every figure is read from rows the server wrote at checkout.
 * 2. **Nothing is paid until Paystack says so**, and we ask Paystack directly
 *    rather than believing the body of a webhook.
 * 3. **Effects are idempotent.** Paystack retries, students refresh the callback
 *    page, and both paths converge on the same guarded transaction that re-reads
 *    the payment and does nothing if it is already settled.
 * 4. **The effect belongs to another service.** This module never writes a
 *    delivery or vendor-order status; it calls the named operation that owns it.
 */

export type InitialisedPayment = {
  reference: string;
  authorizationUrl: string;
  amountKobo: number;
  purpose: PaymentPurpose;
};

function callbackUrl(reference: string): string {
  // Where Paystack returns the student. The page only *reads* the outcome; the
  // money is settled by the webhook or by an explicit verification.
  return `${publicEnv.appUrl}/orders/payment/callback?reference=${encodeURIComponent(reference)}`;
}

/**
 * Retires older attempts on the same thing.
 *
 * A student who abandons a checkout and starts again would otherwise leave a
 * PENDING row behind, and support could not tell which attempt matters. Only
 * PENDING rows are touched: a SUCCESS row is history.
 */
async function abandonSupersededAttempts(
  tx: PrismaTransactionClient,
  where: { orderId: string; purpose: PaymentPurpose; deliveryId?: string | null },
): Promise<void> {
  await tx.payment.updateMany({
    where: {
      orderId: where.orderId,
      purpose: where.purpose,
      ...(where.deliveryId !== undefined ? { deliveryId: where.deliveryId } : {}),
      status: "PENDING",
    },
    data: { status: "ABANDONED" },
  });
}

async function createAttempt(input: {
  actor: Actor;
  orderId: string;
  campusId: string;
  purpose: PaymentPurpose;
  deliveryId?: string | null;
  settlement: Settlement;
  vendorSubaccountCode?: string | null;
  email: string;
  metadata: Record<string, unknown>;
}): Promise<InitialisedPayment> {
  const reference = generatePaymentReference(input.purpose === "GOODS" ? "GD" : "DF");

  // The row exists before the student leaves for Paystack: a payment that
  // disappears mid-flight is still visible to whoever has to explain it.
  const payment = await prisma.$transaction(async (tx) => {
    await abandonSupersededAttempts(tx, {
      orderId: input.orderId,
      purpose: input.purpose,
      deliveryId: input.deliveryId ?? null,
    });

    const created = await tx.payment.create({
      data: {
        campusId: input.campusId,
        orderId: input.orderId,
        deliveryId: input.deliveryId ?? null,
        purpose: input.purpose,
        reference,
        amountKobo: input.settlement.amountKobo,
        platformKobo: input.settlement.platformKobo,
        vendorPayoutKobo: input.settlement.subaccounts[0]?.share ?? 0,
        vendorRouted: input.settlement.vendorRouted,
        vendorSubaccountCode: input.vendorSubaccountCode ?? null,
        initiatedById: input.actor.userId,
      },
      select: { id: true, reference: true, amountKobo: true, purpose: true },
    });

    await recordAudit(
      {
        action: AuditAction.PAYMENT_INITIATED,
        entityType: "Payment",
        entityId: created.id,
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        campusId: input.campusId,
        after: {
          reference,
          purpose: input.purpose,
          amountKobo: input.settlement.amountKobo,
          vendorRouted: input.settlement.vendorRouted,
        },
      },
      tx,
    );

    return created;
  });

  // Outside the transaction: a slow provider must not hold a database lock, and
  // a failed initialisation leaves a PENDING row that is simply never paid.
  const initialised = await initializeTransaction({
    email: input.email,
    amountKobo: input.settlement.amountKobo,
    reference,
    callbackUrl: callbackUrl(reference),
    metadata: input.metadata,
    subaccounts: input.settlement.subaccounts,
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { authorizationUrl: initialised.authorization_url },
  });

  return {
    reference,
    authorizationUrl: initialised.authorization_url,
    amountKobo: payment.amountKobo,
    purpose: payment.purpose,
  };
}

/**
 * Pay the delivery fee on a placed invoice (PRD §32).
 *
 * Settling it is what releases the vendor's package to the agent pool, so this
 * is the first of the two payments and cannot be skipped.
 */
export async function initialiseDeliveryFeePayment(
  actor: Actor,
  orderId: string,
): Promise<InitialisedPayment> {
  const order = await prisma.order.findFirst({
    // Campus-scoped and owner-scoped in the query itself (Rule 25/29): another
    // campus's order is not "forbidden", it does not exist.
    where: { id: orderId, campusId: actor.campusId ?? undefined, studentId: actor.userId },
    select: {
      id: true,
      campusId: true,
      reference: true,
      status: true,
      deliveryFeeKobo: true,
      student: { select: { email: true } },
    },
  });
  if (!order) throw new NotFoundError("Order not found");

  if (order.status !== "AWAITING_DELIVERY_PAYMENT") {
    throw new StateConflictError(
      order.status === "CANCELLED"
        ? "This order was cancelled"
        : "This order's delivery fee has already been settled",
    );
  }
  if (order.deliveryFeeKobo <= 0) {
    // A zero fee means the campus has no coordinates configured. Charging ₦0 is
    // not a payment; an admin has to fix the campus first.
    throw new ValidationError("This order has no delivery fee to pay");
  }

  return createAttempt({
    actor,
    orderId: order.id,
    campusId: order.campusId,
    purpose: "DELIVERY_FEE",
    settlement: deliveryFeeSettlement(order.deliveryFeeKobo),
    email: order.student.email,
    metadata: { orderReference: order.reference, purpose: "DELIVERY_FEE" },
  });
}

/**
 * Pay for the goods after a verified hand-over (PRD §46).
 *
 * Charged per delivery, because the student has one vendor's package in their
 * hands. The window Phase 7 opened is checked here: a deadline that has passed
 * means the goods are already going back, and taking money would be wrong.
 */
export async function initialiseGoodsPayment(
  actor: Actor,
  deliveryId: string,
): Promise<InitialisedPayment> {
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, campusId: actor.campusId ?? undefined },
    select: {
      id: true,
      campusId: true,
      status: true,
      goodsPaymentDeadline: true,
      vendorOrder: {
        select: {
          id: true,
          goodsSubtotalKobo: true,
          commissionKobo: true,
          vendorPayoutKobo: true,
          vendorProfile: { select: { storeName: true, paystackSubaccountCode: true } },
          order: {
            select: {
              id: true,
              reference: true,
              studentId: true,
              student: { select: { email: true } },
            },
          },
        },
      },
    },
  });
  if (!delivery) throw new NotFoundError("Delivery not found");

  const { vendorOrder } = delivery;
  // Only the student who owns the invoice may pay for it.
  if (vendorOrder.order.studentId !== actor.userId) {
    throw new ForbiddenError("Only the student who placed this order can pay for it");
  }

  if (delivery.status !== "PAYMENT_PENDING") {
    throw new StateConflictError(
      "Goods can only be paid for after the hand-over code has been verified",
    );
  }
  if (delivery.goodsPaymentDeadline && delivery.goodsPaymentDeadline.getTime() <= Date.now()) {
    throw new StateConflictError(
      "The payment window for these goods has closed. Please contact support.",
    );
  }

  const subaccountCode = vendorOrder.vendorProfile.paystackSubaccountCode;
  const settlement = goodsSettlement({
    goodsSubtotalKobo: vendorOrder.goodsSubtotalKobo,
    commissionKobo: vendorOrder.commissionKobo,
    vendorPayoutKobo: vendorOrder.vendorPayoutKobo,
    vendorSubaccountCode: subaccountCode,
  });

  if (!settlement.vendorRouted) {
    // Not fatal — the sale must not be blocked by the vendor's onboarding — but
    // it means the platform is holding someone else's money, so say so loudly.
    logger.warn("Goods payment will not be split to the vendor", {
      deliveryId: delivery.id,
      vendorOrderId: vendorOrder.id,
      reason: subaccountCode ? "zero payout" : "no subaccount configured",
    });
  }

  return createAttempt({
    actor,
    orderId: vendorOrder.order.id,
    campusId: delivery.campusId,
    purpose: "GOODS",
    deliveryId: delivery.id,
    settlement,
    vendorSubaccountCode: subaccountCode,
    email: vendorOrder.order.student.email,
    metadata: {
      orderReference: vendorOrder.order.reference,
      purpose: "GOODS",
      store: vendorOrder.vendorProfile.storeName,
      deliveryId: delivery.id,
    },
  });
}

type ApplyOutcome =
  | { applied: true; refunded: false }
  | { applied: false; refunded: false; reason: string }
  | { applied: false; refunded: true; reason: string };

/**
 * Record that money arrived, then let the owning service act on it.
 *
 * The whole function is one transaction that re-reads the payment first, which
 * is the idempotency guarantee: a replayed webhook, or a student refreshing the
 * callback page, finds the row already SUCCESS and changes nothing.
 *
 * A goods payment that lands after the delivery has gone home is a refund, not
 * a completion — the money is taken out again rather than kept for goods the
 * student no longer has.
 */
async function applySuccessfulPayment(
  reference: string,
  verified: VerifiedTransaction,
): Promise<ApplyOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    // Gathered inside the transaction and returned from it, so the fan-out below
    // only ever describes writes that actually committed (PRD §52).
    let settled: {
      studentId: string;
      campusId: string;
      amountKobo: number;
      reference: string;
      orderId: string;
    } | null = null;
    let pooled: {
      id: string;
      campusId: string;
      destinationName: string;
      orderDeliveryFeeKobo: number;
    }[] = [];

    const payment = await tx.payment.findUnique({

      where: { reference },
      select: {
        id: true,
        campusId: true,
        orderId: true,
        deliveryId: true,
        purpose: true,
        status: true,
        amountKobo: true,
        initiatedById: true,
      },
    });
    if (!payment) return { applied: false, refunded: false, reason: "unknown reference" } as const;

    if (payment.status === "SUCCESS" || payment.status === "REFUNDED") {
      return { applied: false, refunded: false, reason: "already settled" } as const;
    }

    if (!amountMatches(payment.amountKobo, verified.amount)) {
      // Never reconcile a mismatch silently: FAILED keeps the goods locked and
      // leaves a row a human can act on.
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failureReason: `Amount mismatch: expected ${payment.amountKobo}, received ${verified.amount}`,
        },
      });
      return { applied: false, refunded: false, reason: "amount mismatch" } as const;
    }

    const paidAt = verified.paid_at ? new Date(verified.paid_at) : new Date();

    if (payment.purpose === "DELIVERY_FEE") {
      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
        select: { id: true, status: true, reference: true, studentId: true },
      });
      if (!order || order.status === "CANCELLED") {
        return { applied: false, refunded: true, reason: "order cancelled" } as const;
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCESS", paidAt },
      });

      if (order.status === "AWAITING_DELIVERY_PAYMENT") {
        await tx.order.update({ where: { id: order.id }, data: { status: "DELIVERY_PAID" } });
        // The delivery engine owns what happens next; this service only pays.
        await publishDeliveriesForPaidOrder(order.id, tx);

        // Read back what is now in the pool so the agents can be told once this
        // transaction commits. `publishDeliveriesForPaidOrder` deliberately does
        // not announce when it is handed a transaction.
        pooled = await tx.delivery.findMany({
          where: { vendorOrder: { orderId: order.id }, status: "AVAILABLE" },
          select: {
            id: true,
            campusId: true,
            destinationName: true,
            orderDeliveryFeeKobo: true,
          },
        });
      }

      settled = {
        studentId: order.studentId,
        campusId: payment.campusId,
        amountKobo: payment.amountKobo,
        reference: order.reference,
        orderId: order.id,
      };
    } else {
      if (!payment.deliveryId) {

        return { applied: false, refunded: false, reason: "goods payment has no delivery" } as const;
      }

      const delivery = await tx.delivery.findUnique({
        where: { id: payment.deliveryId },
        select: {
          id: true,
          status: true,
          vendorOrder: {
            select: { order: { select: { id: true, reference: true, studentId: true } } },
          },
        },
      });

      if (!delivery || delivery.status !== "PAYMENT_PENDING") {
        // Timed out and returned, or cancelled, while the payment was in flight.
        return { applied: false, refunded: true, reason: "delivery no longer awaiting payment" } as const;
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCESS", paidAt },
      });

      await completeDeliveryOnGoodsPayment(delivery.id, tx);

      settled = {
        studentId: delivery.vendorOrder.order.studentId,
        campusId: payment.campusId,
        amountKobo: payment.amountKobo,
        reference: delivery.vendorOrder.order.reference,
        orderId: delivery.vendorOrder.order.id,
      };
    }

    await recordAudit(
      {
        action: AuditAction.PAYMENT_SUCCEEDED,

        entityType: "Payment",
        entityId: payment.id,
        actorId: null,
        campusId: payment.campusId,
        after: { reference, purpose: payment.purpose, amountKobo: payment.amountKobo },
      },
      tx,
    );

    return { applied: true, refunded: false, settled, pooled } as const;
  });

  if (outcome.applied && outcome.settled) {
    // A receipt, not an advert: the student is told the money landed and which
    // order it belongs to. Sent once, because only the call that actually moved
    // the row out of PENDING reaches this line (PRD §52).
    await notify({
      type: "PAYMENT_SETTLED",
      recipients: [{ userId: outcome.settled.studentId, campusId: outcome.settled.campusId }],
      facts: {
        reference: outcome.settled.reference,
        amountKobo: outcome.settled.amountKobo,
      },
      entityType: "Order",
      entityId: outcome.settled.orderId,
    });
  }

  if (outcome.applied) {
    for (const delivery of outcome.pooled) {
      // Settling the fee is what puts the job in front of agents, so the pool is
      // told here rather than inside the transaction that took the money.
      await notifyPoolOfDelivery(delivery);
    }
  }

  if (!outcome.refunded) return outcome;



  // The money is real but the thing it paid for is gone. Refund outside the
  // transaction, then record it; a refund that fails leaves the payment SUCCESS-
  // less and visible rather than quietly kept.
  await refundPayment(reference, outcome.reason);
  return outcome;
}

/**
 * Send a payment back.
 *
 * Full-amount only: partial refunds belong to the disputes work in Phase 11, and
 * guessing a partial figure here would be inventing policy.
 */
export async function refundPayment(reference: string, reason: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    select: { id: true, campusId: true, amountKobo: true, status: true },
  });
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.status === "REFUNDED") return;

  const refund = await refundTransaction(reference, payment.amountKobo);

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "REFUNDED",
        refundedAt: new Date(),
        refundedAmountKobo: payment.amountKobo,
        refundReason: reason,
      },
    });
    await recordAudit(
      {
        action: AuditAction.REFUND_INITIATED,
        entityType: "Payment",
        entityId: payment.id,
        actorId: null,
        campusId: payment.campusId,
        after: { reference, reason, amountKobo: payment.amountKobo, providerRefundId: refund.id },
      },
      tx,
    );
  });
}

async function markFailed(reference: string, failureReason: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    select: { id: true, campusId: true, status: true },
  });
  if (!payment || payment.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason },
    });
    await recordAudit(
      {
        action: AuditAction.PAYMENT_FAILED,
        entityType: "Payment",
        entityId: payment.id,
        actorId: null,
        campusId: payment.campusId,
        after: { reference, failureReason },
      },
      tx,
    );
  });
}

type WebhookResult = { received: true; duplicate: boolean; note?: string };

/**
 * Handle a Paystack webhook (PRD §50).
 *
 * Order of operations matters and is deliberate:
 *
 * 1. Verify the signature over the **raw** body. An unsigned or tampered body is
 *    rejected before it is even parsed.
 * 2. Insert a `PaymentEvent` keyed by the provider's event id. The unique
 *    constraint is what makes a retry a no-op — the insert fails, and the
 *    handler stops without repeating the effect.
 * 3. Re-verify the transaction with Paystack. The body is treated as a
 *    notification that *something* happened, never as evidence of what.
 * 4. Apply the effect in a guarded transaction.
 */
export async function handlePaystackWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new ForbiddenError("Invalid webhook signature");
  }

  let parsed: { event?: string; data?: { id?: number | string; reference?: string } };
  try {
    parsed = JSON.parse(rawBody) as typeof parsed;
  } catch {
    throw new ValidationError("Webhook body is not valid JSON");
  }

  const eventType = parsed.event ?? "unknown";
  const reference = parsed.data?.reference;
  if (!reference) {
    logger.warn("Paystack webhook carried no reference", { eventType });
    return { received: true, duplicate: false, note: "no reference" };
  }

  const providerEventKey = `${eventType}:${parsed.data?.id ?? reference}`;

  const payment = await prisma.payment.findUnique({
    where: { reference },
    select: { id: true },
  });

  try {
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment?.id ?? null,
        providerEventKey,
        eventType,
        payload: JSON.parse(rawBody) as never,
      },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      // Paystack re-delivered an event we have already stored. Doing nothing is
      // the correct behaviour, and saying so keeps it out of the error logs.
      return { received: true, duplicate: true };
    }
    throw error;
  }

  if (eventType !== "charge.success") {
    // Everything else is informational for the MVP: transfers, disputes and
    // subscriptions have no effect until later phases own them.
    await noteEvent(providerEventKey, `ignored event ${eventType}`);
    return { received: true, duplicate: false, note: "ignored" };
  }

  const verified = await verifyTransaction(reference);

  if (!isSuccessfulTransaction(verified.status)) {
    await markFailed(reference, verified.gateway_response ?? `Provider status ${verified.status}`);
    await noteEvent(providerEventKey, `provider status ${verified.status}`);
    return { received: true, duplicate: false, note: "not successful" };
  }

  const outcome = await applySuccessfulPayment(reference, verified);
  await noteEvent(
    providerEventKey,
    outcome.applied ? "applied" : `not applied: ${outcome.reason}`,
  );

  return { received: true, duplicate: false, ...(outcome.applied ? {} : { note: outcome.reason }) };
}

async function noteEvent(providerEventKey: string, note: string): Promise<void> {
  await prisma.paymentEvent.update({
    where: { providerEventKey },
    data: { processedAt: new Date(), note },
  });
}

export type PaymentStatusView = {
  reference: string;
  purpose: PaymentPurpose;
  status: string;
  amountKobo: number;
  paidAt: Date | null;
  failureReason: string | null;
};

/**
 * What the student sees when Paystack sends them back.
 *
 * The callback is not proof of payment — a URL can be typed — so this asks
 * Paystack directly and then goes through the same guarded application path as
 * the webhook. Whichever arrives first wins; the second is a no-op.
 */
export async function verifyPaymentForActor(
  actor: Actor,
  reference: string,
): Promise<PaymentStatusView> {
  const payment = await prisma.payment.findFirst({
    where: {
      reference,
      campusId: actor.campusId ?? undefined,
      order: { studentId: actor.userId },
    },
    select: {
      reference: true,
      purpose: true,
      status: true,
      amountKobo: true,
      paidAt: true,
      failureReason: true,
    },
  });
  if (!payment) throw new NotFoundError("Payment not found");

  if (payment.status === "PENDING") {
    const verified = await verifyTransaction(reference);
    if (isSuccessfulTransaction(verified.status)) {
      await applySuccessfulPayment(reference, verified);
    } else if (verified.status !== "ongoing" && verified.status !== "pending") {
      await markFailed(reference, verified.gateway_response ?? `Provider status ${verified.status}`);
    }

    const refreshed = await prisma.payment.findUnique({
      where: { reference },
      select: {
        reference: true,
        purpose: true,
        status: true,
        amountKobo: true,
        paidAt: true,
        failureReason: true,
      },
    });
    if (refreshed) return refreshed;
  }

  return payment;
}

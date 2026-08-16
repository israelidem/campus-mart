import type { Actor } from "@/lib/auth/session";
import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import { prisma } from "@/lib/db/prisma";
import {
  attributeRefund,
  canTransitionDispute,
  canWithdrawDispute,
  disputeWindowDaysRemaining,
  generateDisputeReference,
  isWithinDisputeWindow,
  refundCapacity,
  resolveRefundAmount,
  type DisputeStatusName,
} from "@/lib/disputes/dispute-policy";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StateConflictError,
} from "@/lib/errors";
import type { DisputeReason, DisputeStatus, PaymentStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { notify } from "@/lib/notifications/notification-service";
import { refundTransaction } from "@/lib/payments/paystack";
import { isPaystackConfigured } from "@/lib/payments/paystack";
import type {
  DisputeFileInput,
  DisputeListQuery,
  DisputeQueueQuery,
  DisputeResolveInput,
  DisputeWithdrawInput,
} from "@/validations/dispute";

/**
 * Dispute and refund service (PRD §60–63).
 *
 * Every decision about *whether* and *how much* lives in
 * `lib/disputes/dispute-policy.ts`. This file reads the facts, enforces who may
 * act, and writes the consequences. It contains no arithmetic of its own, which
 * is what keeps the money rules testable without a database.
 *
 * Two orderings here are deliberate and must not be "tidied":
 *
 *  1. The refund row is written, and the payment's cumulative total bumped,
 *     *before* Paystack is called. A provider timeout then leaves a record to
 *     reconcile instead of money that moved with nothing to show for it.
 *  2. The database's CHECK constraints are the backstop, not the check. The
 *     readable refusal comes from `refundCapacity`; the constraint exists for the
 *     case where a future caller forgets to ask.
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const DISPUTE_SUMMARY_SELECT = {
  id: true,
  reference: true,
  status: true,
  reason: true,
  description: true,
  goodsSubtotalKobo: true,
  commissionKobo: true,
  vendorPayoutKobo: true,
  resolution: true,
  resolutionNote: true,
  refundAmountKobo: true,
  resolvedAt: true,
  withdrawnAt: true,
  createdAt: true,
  vendorOrderId: true,
  deliveryId: true,
  order: { select: { id: true, reference: true } },
  vendorOrder: {
    select: {
      id: true,
      vendorProfile: { select: { id: true, storeName: true } },
    },
  },
} as const;

export type DisputeSummary = Awaited<
  ReturnType<typeof prisma.dispute.findFirstOrThrow<{ select: typeof DISPUTE_SUMMARY_SELECT }>>
>;

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

/**
 * Opens a case against one vendor's slice of an invoice.
 *
 * Four things are verified before anything is written, in the order that fails
 * cheapest first: the purchase exists, the person asking actually bought it, the
 * delivery completed, and the window is still open. The "no live case already"
 * rule is enforced by the database's partial unique index rather than by a read,
 * because two simultaneous submissions would both pass a read.
 */
export async function fileDispute(
  actor: Actor,
  input: DisputeFileInput,
  now: Date = new Date(),
): Promise<DisputeSummary> {
  const vendorOrder = await prisma.vendorOrder.findUnique({
    where: { id: input.vendorOrderId },
    select: {
      id: true,
      campusId: true,
      orderId: true,
      goodsSubtotalKobo: true,
      commissionKobo: true,
      vendorPayoutKobo: true,
      vendorProfile: { select: { id: true, storeName: true, userId: true } },
      order: { select: { id: true, reference: true, studentId: true, campusId: true } },
      delivery: { select: { id: true, status: true, completedAt: true } },
    },
  });
  if (!vendorOrder) throw new NotFoundError("That purchase could not be found");

  // Rule 1 / Rule 25: ownership is decided by the server, from the row.
  if (vendorOrder.order.studentId !== actor.userId) {
    throw new ForbiddenError("You can only open a case about your own purchase");
  }

  const delivery = vendorOrder.delivery;
  if (!delivery || delivery.status !== "COMPLETED") {
    // A delivery still in flight is not a dispute. Cancellations and returns are
    // already handled by the delivery engine, which refunds or restocks without
    // anybody having to complain.
    throw new StateConflictError(
      "A case can only be opened once the delivery has completed. If the delivery is still in progress, use the order page.",
    );
  }
  if (!isWithinDisputeWindow(delivery.completedAt, now)) {
    throw new StateConflictError(
      "The 7-day window for opening a case about this purchase has closed",
    );
  }

  const snapshot = {
    goodsSubtotalKobo: vendorOrder.goodsSubtotalKobo,
    commissionKobo: vendorOrder.commissionKobo,
    vendorPayoutKobo: vendorOrder.vendorPayoutKobo,
  };

  const dispute = await createWithUniqueReference(async (reference) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.dispute.create({
        data: {
          reference,
          campusId: vendorOrder.campusId,
          orderId: vendorOrder.orderId,
          vendorOrderId: vendorOrder.id,
          deliveryId: delivery.id,
          raisedById: actor.userId,
          status: "OPEN",
          reason: input.reason as DisputeReason,
          description: input.description,
          ...snapshot,
        },
        select: DISPUTE_SUMMARY_SELECT,
      });

      await recordAudit(
        {
          action: AuditAction.DISPUTE_FILED,
          entityType: "Dispute",
          entityId: created.id,
          actorId: actor.userId,
          actorRole: actor.role,
          campusId: vendorOrder.campusId,
          after: {
            reference,
            vendorOrderId: vendorOrder.id,
            reason: input.reason,
            ...snapshot,
          },
        },
        tx,
      );

      return created;
    }),
  );

  // The vendor and every admin on the campus. The vendor is told because a case
  // they never hear about is one they cannot answer.
  await notify({
    type: "DISPUTE_RAISED",
    recipients: [
      { userId: vendorOrder.vendorProfile.userId, campusId: vendorOrder.campusId },
      ...(await campusAdminRecipients(vendorOrder.campusId)),
    ],
    facts: { reference: dispute.reference, storeName: vendorOrder.vendorProfile.storeName },
    entityType: "Dispute",
    entityId: dispute.id,
  });

  return dispute;
}

/**
 * Retries once per collision on the human-readable reference.
 *
 * The generator is random, so uniqueness is the column's job. Three attempts is
 * plenty: with a 32-character alphabet over six places, a second collision means
 * something is wrong that a fourth attempt will not fix.
 */
async function createWithUniqueReference<T>(
  create: (reference: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await create(generateDisputeReference());
    } catch (error) {
      if (!isUniqueViolation(error)) throw translateLiveDisputeConflict(error);
      lastError = error;
    }
  }
  throw lastError;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002" &&
    // Only a reference clash is worth retrying. A live-dispute clash is a
    // conflict the user must be told about, not something to retry into.
    !isLiveDisputeViolation(error)
  );
}

function isLiveDisputeViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  const meta = "meta" in error ? JSON.stringify((error as { meta?: unknown }).meta ?? {}) : "";
  return /dispute_live_per_vendor_order/i.test(`${message} ${meta}`);
}

/** Turns the partial unique index's violation into a sentence, not a 500. */
function translateLiveDisputeConflict(error: unknown): unknown {
  if (isLiveDisputeViolation(error)) {
    return new ConflictError(
      "There is already an open case about this purchase. Wait for it to be resolved, or withdraw it first.",
    );
  }
  return error;
}

// ---------------------------------------------------------------------------
// Withdrawing
// ---------------------------------------------------------------------------

/** The student takes their case back. Only while it is still live. */
export async function withdrawDispute(
  actor: Actor,
  disputeId: string,
  input: DisputeWithdrawInput,
): Promise<DisputeSummary> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    select: { id: true, campusId: true, status: true, raisedById: true, reference: true },
  });
  if (!dispute) throw new NotFoundError("Case not found");
  if (dispute.raisedById !== actor.userId) {
    throw new ForbiddenError("Only the student who opened a case can withdraw it");
  }
  if (!canWithdrawDispute(dispute.status as DisputeStatusName)) {
    throw new StateConflictError("This case is already closed");
  }

  return prisma.$transaction(async (tx) => {
    // Re-read inside the transaction and assert the state, so two taps on the
    // button cannot both proceed.
    const current = await tx.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { status: true },
    });
    if (!canTransitionDispute(current.status as DisputeStatusName, "WITHDRAWN")) {
      throw new StateConflictError("This case is already closed");
    }

    const updated = await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: "WITHDRAWN",
        withdrawnAt: new Date(),
        // Appended rather than overwriting: the student's own note about why
        // they withdrew belongs with their original account.
        resolutionNote: input.note?.trim() || null,
      },
      select: DISPUTE_SUMMARY_SELECT,
    });

    await recordAudit(
      {
        action: AuditAction.DISPUTE_WITHDRAWN,
        entityType: "Dispute",
        entityId: disputeId,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: dispute.campusId,
        before: { status: current.status },
        after: { status: "WITHDRAWN", note: input.note ?? null },
      },
      tx,
    );

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Admin: picking a case up
// ---------------------------------------------------------------------------

/** An admin claims a case, so the student stops wondering whether anyone read it. */
export async function startDisputeReview(
  actor: Actor,
  disputeId: string,
): Promise<DisputeSummary> {
  const dispute = await loadForAdmin(actor, disputeId);

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { status: true },
    });
    if (!canTransitionDispute(current.status as DisputeStatusName, "UNDER_REVIEW")) {
      throw new StateConflictError(
        current.status === "UNDER_REVIEW"
          ? "This case is already under review"
          : "This case is closed",
      );
    }

    const row = await tx.dispute.update({
      where: { id: disputeId },
      data: { status: "UNDER_REVIEW" },
      select: DISPUTE_SUMMARY_SELECT,
    });

    await recordAudit(
      {
        action: AuditAction.DISPUTE_REVIEW_STARTED,
        entityType: "Dispute",
        entityId: disputeId,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: dispute.campusId,
        before: { status: current.status },
        after: { status: "UNDER_REVIEW" },
      },
      tx,
    );

    return row;
  });

  await notify({
    type: "DISPUTE_UPDATED",
    recipients: [{ userId: dispute.raisedById, campusId: dispute.campusId }],
    facts: { reference: dispute.reference },
    entityType: "Dispute",
    entityId: disputeId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Admin: resolving
// ---------------------------------------------------------------------------

export type ResolveOutcome = {
  dispute: DisputeSummary;
  /** Null when the outcome owed nothing. */
  refund: {
    id: string;
    amountKobo: number;
    fromPlatformKobo: number;
    fromVendorKobo: number;
    /** False when the provider has not confirmed it yet or refused it. */
    succeeded: boolean;
    failureReason: string | null;
  } | null;
};

/**
 * Closes a case, and moves money if the outcome says so.
 *
 * The sequence is: decide (pure) → record (transaction) → ask the provider →
 * record the provider's answer. The middle step is what makes a failed provider
 * call recoverable: the intent is already durable, so a human can retry it
 * against a row rather than reconstructing what was meant to happen.
 */
export async function resolveDispute(
  actor: Actor,
  disputeId: string,
  input: DisputeResolveInput,
): Promise<ResolveOutcome> {
  const dispute = await loadForAdmin(actor, disputeId);
  if (!canTransitionDispute(dispute.status as DisputeStatusName, "RESOLVED")) {
    throw new StateConflictError("This case is already closed");
  }

  // 1. Decide. Throws a readable message if the outcome and the amount disagree.
  let decision: ReturnType<typeof resolveRefundAmount>;
  try {
    decision = resolveRefundAmount({
      resolution: input.resolution,
      goodsSubtotalKobo: dispute.goodsSubtotalKobo,
      requestedAmountKobo: input.refundAmountKobo ?? null,
    });
  } catch (error) {
    throw new BadRequestError(error instanceof Error ? error.message : "Invalid resolution");
  }

  const attribution = attributeRefund({
    refundAmountKobo: decision.refundAmountKobo,
    goodsSubtotalKobo: dispute.goodsSubtotalKobo,
    commissionKobo: dispute.commissionKobo,
    vendorPayoutKobo: dispute.vendorPayoutKobo,
  });

  // 2. Find the money, if any is owed.
  const payment = decision.refundRequired ? await findGoodsPayment(dispute) : null;
  if (decision.refundRequired && !payment) {
    throw new StateConflictError(
      "No settled payment was found for this purchase, so there is nothing to refund. Close the case with 'no refund' if that is the outcome.",
    );
  }

  if (payment) {
    const capacity = refundCapacity({
      paymentAmountKobo: payment.amountKobo,
      alreadyRefundedKobo: payment.refundedAmountKobo ?? 0,
      requestedKobo: decision.refundAmountKobo,
    });
    if (!capacity.allowed) throw new BadRequestError(capacity.reason);
  }

  // 3. Record the decision and the intent to refund, atomically.
  const idempotencyKey = `dispute_${dispute.id}_refund`;
  const resolvedAt = new Date();

  const { updated, refundRow } = await prisma.$transaction(async (tx) => {
    const current = await tx.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: { status: true },
    });
    if (!canTransitionDispute(current.status as DisputeStatusName, "RESOLVED")) {
      throw new StateConflictError("This case is already closed");
    }

    const row = await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: "RESOLVED",
        resolution: input.resolution,
        resolutionNote: input.resolutionNote,
        refundAmountKobo: decision.refundAmountKobo,
        resolvedAt,
        resolvedById: actor.userId,
      },
      select: DISPUTE_SUMMARY_SELECT,
    });

    let created: { id: string } | null = null;
    if (payment) {
      created = await tx.refund.create({
        data: {
          campusId: dispute.campusId,
          paymentId: payment.id,
          disputeId: dispute.id,
          amountKobo: decision.refundAmountKobo,
          fromPlatformKobo: attribution.fromPlatformKobo,
          fromVendorKobo: attribution.fromVendorKobo,
          reason: `${input.resolution}: ${input.resolutionNote}`,
          idempotencyKey,
          initiatedById: actor.userId,
        },
        select: { id: true },
      });

      // The cumulative total is the invariant the CHECK constraint guards, so it
      // is written in the same transaction as the row that justifies it.
      const totalRefunded = (payment.refundedAmountKobo ?? 0) + decision.refundAmountKobo;
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmountKobo: totalRefunded,
          refundReason: input.resolutionNote,
          status: totalRefunded >= payment.amountKobo ? "REFUNDED" : "PARTIALLY_REFUNDED",
        },
      });
    }

    await recordAudit(
      {
        action: AuditAction.DISPUTE_RESOLVED,
        entityType: "Dispute",
        entityId: disputeId,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: dispute.campusId,
        before: { status: current.status },
        after: {
          status: "RESOLVED",
          resolution: input.resolution,
          refundAmountKobo: decision.refundAmountKobo,
          ...attribution,
        },
      },
      tx,
    );

    return { updated: row, refundRow: created };
  });

  // 4. Ask the provider. Outside the transaction: a network call must never hold
  //    a database lock, and its outcome is recorded separately either way.
  let succeeded = false;
  let failureReason: string | null = null;

  if (payment && refundRow) {
    if (!isPaystackConfigured()) {
      failureReason = "Payments are not configured on this deployment";
      logger.error("Refund recorded but payments are not configured", {
        disputeId,
        refundId: refundRow.id,
      });
    } else {
      try {
        const providerRefund = await refundTransaction(
          payment.reference,
          decision.refundAmountKobo,
        );
        succeeded = true;
        await prisma.refund.update({
          where: { id: refundRow.id },
          data: { succeededAt: new Date(), providerRefundId: String(providerRefund.id ?? "") },
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { refundedAt: new Date() },
        });
        await recordAudit({
          action: AuditAction.REFUND_ISSUED,
          entityType: "Refund",
          entityId: refundRow.id,
          actorId: actor.userId,
          actorRole: actor.role,
          campusId: dispute.campusId,
          after: {
            disputeReference: dispute.reference,
            amountKobo: decision.refundAmountKobo,
            ...attribution,
            providerRefundId: providerRefund.id ?? null,
          },
        });
      } catch (error) {
        failureReason = error instanceof Error ? error.message : "The refund could not be sent";
        // Deliberately not rethrown. The decision is made and recorded; failing
        // the request would tell the admin their resolution did not happen,
        // which is false and would invite them to do it twice.
        logger.error("Refund could not be sent to the provider", {
          disputeId,
          refundId: refundRow.id,
          error,
        });
        await prisma.refund.update({
          where: { id: refundRow.id },
          data: { failureReason },
        });
        await recordAudit({
          action: AuditAction.REFUND_FAILED,
          entityType: "Refund",
          entityId: refundRow.id,
          actorId: actor.userId,
          actorRole: actor.role,
          campusId: dispute.campusId,
          after: { amountKobo: decision.refundAmountKobo, failureReason },
        });
      }
    }
  }

  // 5. Tell everyone who is affected.
  const storeName = updated.vendorOrder.vendorProfile.storeName;
  await notify({
    type: "DISPUTE_RESOLVED",
    recipients: [
      { userId: dispute.raisedById, campusId: dispute.campusId },
      { userId: dispute.vendorUserId, campusId: dispute.campusId },
    ],
    facts: { reference: dispute.reference, storeName, reason: input.resolutionNote },
    entityType: "Dispute",
    entityId: disputeId,
  });

  if (succeeded) {
    await notify({
      type: "REFUND_ISSUED",
      recipients: [{ userId: dispute.raisedById, campusId: dispute.campusId }],
      facts: { reference: dispute.reference, amountKobo: decision.refundAmountKobo },
      entityType: "Refund",
      entityId: refundRow?.id,
    });
  }

  return {
    dispute: updated,
    refund: refundRow
      ? {
          id: refundRow.id,
          amountKobo: decision.refundAmountKobo,
          fromPlatformKobo: attribution.fromPlatformKobo,
          fromVendorKobo: attribution.fromVendorKobo,
          succeeded,
          failureReason,
        }
      : null,
  };
}

/**
 * The settled goods payment behind a disputed purchase.
 *
 * Preferred by delivery, because a goods payment is unlocked by one hand-over and
 * therefore belongs to one vendor order. The fallback by order exists for data
 * written before that link was set, and is filtered to SUCCESS-like statuses so a
 * failed attempt can never be refunded.
 */
async function findGoodsPayment(dispute: {
  orderId: string;
  deliveryId: string | null;
}): Promise<{
  id: string;
  reference: string;
  amountKobo: number;
  refundedAmountKobo: number | null;
} | null> {
  const select = {
    id: true,
    reference: true,
    amountKobo: true,
    refundedAmountKobo: true,
  } as const;
  // A partially refunded payment is still refundable up to its remaining
  // balance; a FAILED or PENDING one was never money the platform holds.
  const refundable: PaymentStatus[] = ["SUCCESS", "PARTIALLY_REFUNDED"];

  if (dispute.deliveryId) {
    const byDelivery = await prisma.payment.findFirst({
      where: { deliveryId: dispute.deliveryId, purpose: "GOODS", status: { in: refundable } },
      orderBy: { createdAt: "desc" },
      select,
    });
    if (byDelivery) return byDelivery;
  }

  return prisma.payment.findFirst({
    where: { orderId: dispute.orderId, purpose: "GOODS", status: { in: refundable } },
    orderBy: { createdAt: "desc" },
    select,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The student's own cases. Never filtered in the browser (Rule 25). */
export async function listMyDisputes(
  actor: Actor,
  query: DisputeListQuery,
): Promise<DisputeSummary[]> {
  return prisma.dispute.findMany({
    where: {
      raisedById: actor.userId,
      ...(query.status ? { status: query.status as DisputeStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: query.limit ?? 20,
    select: DISPUTE_SUMMARY_SELECT,
  });
}

/**
 * Whether this purchase can be disputed, and what is already on it.
 *
 * The order page asks this so it can show a form, a live case or an explanation
 * of why neither applies — rather than offering a button that will be refused.
 */
export async function getDisputeContext(
  actor: Actor,
  vendorOrderId: string,
  now: Date = new Date(),
): Promise<{
  canFile: boolean;
  reasonBlocked: string | null;
  daysRemaining: number;
  goodsSubtotalKobo: number;
  storeName: string;
  disputes: DisputeSummary[];
}> {
  const vendorOrder = await prisma.vendorOrder.findUnique({
    where: { id: vendorOrderId },
    select: {
      id: true,
      goodsSubtotalKobo: true,
      vendorProfile: { select: { storeName: true } },
      order: { select: { studentId: true } },
      delivery: { select: { status: true, completedAt: true } },
    },
  });
  if (!vendorOrder) throw new NotFoundError("That purchase could not be found");
  if (vendorOrder.order.studentId !== actor.userId) {
    throw new ForbiddenError("You can only view cases about your own purchase");
  }

  const disputes = await prisma.dispute.findMany({
    where: { vendorOrderId, raisedById: actor.userId },
    orderBy: { createdAt: "desc" },
    select: DISPUTE_SUMMARY_SELECT,
  });

  const completed = vendorOrder.delivery?.status === "COMPLETED";
  const completedAt = vendorOrder.delivery?.completedAt ?? null;
  const live = disputes.find((d) => d.status === "OPEN" || d.status === "UNDER_REVIEW");

  let reasonBlocked: string | null = null;
  if (!completed) reasonBlocked = "This purchase has not been delivered yet";
  else if (!isWithinDisputeWindow(completedAt, now)) reasonBlocked = "The 7-day window has closed";
  else if (live) reasonBlocked = "You already have an open case about this purchase";

  return {
    canFile: reasonBlocked === null,
    reasonBlocked,
    daysRemaining: disputeWindowDaysRemaining(completedAt, now),
    goodsSubtotalKobo: vendorOrder.goodsSubtotalKobo,
    storeName: vendorOrder.vendorProfile.storeName,
    disputes,
  };
}

/** The admin queue for a campus. Super Admins see every campus. */
export async function listCampusDisputes(
  actor: Actor,
  query: DisputeQueueQuery,
): Promise<DisputeSummary[]> {
  const state = query.state ?? "live";
  const statusFilter =
    state === "live"
      ? { status: { in: ["OPEN", "UNDER_REVIEW"] as DisputeStatus[] } }
      : state === "all"
        ? {}
        : { status: state.toUpperCase() as DisputeStatus };

  return prisma.dispute.findMany({
    where: {
      // Rule 29: the campus filter is applied in the query, from the actor,
      // never from anything the client sent.
      ...(actor.role === "SUPER_ADMIN" ? {} : { campusId: actor.campusId ?? "__none__" }),
      ...statusFilter,
      ...(query.reason ? { reason: query.reason as DisputeReason } : {}),
    },
    // Oldest first within the queue: a complaint that has waited longest is the
    // one most in need of an answer.
    orderBy: { createdAt: "asc" },
    take: query.limit ?? 50,
    select: DISPUTE_SUMMARY_SELECT,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Loads a case an admin is entitled to act on, with the facts a decision needs. */
async function loadForAdmin(
  actor: Actor,
  disputeId: string,
): Promise<{
  id: string;
  reference: string;
  campusId: string;
  orderId: string;
  deliveryId: string | null;
  status: DisputeStatus;
  raisedById: string;
  vendorUserId: string;
  goodsSubtotalKobo: number;
  commissionKobo: number;
  vendorPayoutKobo: number;
}> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      reference: true,
      campusId: true,
      orderId: true,
      deliveryId: true,
      status: true,
      raisedById: true,
      goodsSubtotalKobo: true,
      commissionKobo: true,
      vendorPayoutKobo: true,
      vendorOrder: { select: { vendorProfile: { select: { userId: true } } } },
    },
  });
  if (!dispute) throw new NotFoundError("Case not found");

  if (actor.role !== "SUPER_ADMIN" && dispute.campusId !== actor.campusId) {
    // Deliberately the same message a missing case gets, so the queue cannot be
    // used to discover that a case exists on another campus.
    throw new NotFoundError("Case not found");
  }

  const { vendorOrder, ...rest } = dispute;
  return { ...rest, vendorUserId: vendorOrder.vendorProfile.userId };
}

/** Every admin who should see a new case on this campus. */
async function campusAdminRecipients(
  campusId: string,
): Promise<{ userId: string; campusId: string }[]> {
  const admins = await prisma.user.findMany({
    where: { campusId, role: "CAMPUS_ADMIN", isSuspended: false },
    select: { id: true },
  });
  return admins.map((admin) => ({ userId: admin.id, campusId }));
}

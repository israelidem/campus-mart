import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { prisma, type PrismaTransactionClient } from "@/lib/db/prisma";
import { requireApprovedAgent } from "@/lib/delivery/agent-service";
import {
  ACTIVE_AGENT_STATUSES,
  canTransition,
  deadlineFrom,
  escalationForCancellations,
  isPastDeadline,
} from "@/lib/delivery/rules";
import {
  attemptsRemaining,
  checkOtpUsable,
  generateHandoverCode,
  hashHandoverCode,
  hashesMatch,
  OTP_VALIDITY_MINUTES,
} from "@/lib/delivery/otp";
import { env } from "@/lib/env";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  ValidationError,
} from "@/lib/errors";
import type {
  DeliveryEventType,
  DeliveryStatus,
  NotificationType,
} from "@/lib/generated/prisma/enums";

import { logger } from "@/lib/logger";
import type { NotificationFacts } from "@/lib/notifications/messages";
import { notify, onDutyAgentRecipients } from "@/lib/notifications/notification-service";

import type {
  DeliveryCancelInput,

  DeliveryProgressInput,
  HandoverVerifyInput,
} from "@/validations/delivery";


/**
 * The delivery engine (PRD §36–44).
 *
 * Every change of state here is a named operation that opens a transaction,
 * re-reads the row, asserts the state it expects, and writes both the new state
 * and a `DeliveryEvent`. Nothing assigns a status directly, and no deadline is
 * ever taken from a client: the server stores `pickupDeadline` and
 * `waitDeadline` and compares them to its own clock, so a frozen browser tab or
 * a doctored request cannot buy an agent extra time (PRD §41).
 */

const deliverySelect = {
  id: true,
  campusId: true,
  status: true,
  vendorOrderId: true,
  pickupName: true,
  pickupLocation: true,
  pickupPhone: true,
  destinationName: true,
  destinationNote: true,
  destinationLocationId: true,
  studentPhone: true,
  orderDeliveryFeeKobo: true,
  agentProfileId: true,
  agentUserId: true,
  acceptedAt: true,
  pickupDeadline: true,
  pickedUpAt: true,
  arrivedAt: true,
  waitDeadline: true,
  offerCount: true,
  resolutionNote: true,
  vendorOrder: { select: { order: { select: { reference: true } } } },
} as const;

export type DeliveryView = {
  id: string;
  status: DeliveryStatus;
  orderReference: string;
  pickupName: string;
  pickupLocation: string;
  /** Only disclosed to the assigned agent; null in the open pool. */
  pickupPhone: string | null;
  destinationName: string;
  destinationNote: string | null;
  /** Only disclosed to the assigned agent (PRD §57). */
  studentPhone: string | null;
  orderDeliveryFeeKobo: number;
  acceptedAt: Date | null;
  pickupDeadline: Date | null;
  waitDeadline: Date | null;
  offerCount: number;
};

type DeliveryRow = {
  id: string;
  status: DeliveryStatus;
  pickupName: string;
  pickupLocation: string;
  pickupPhone: string;
  destinationName: string;
  destinationNote: string | null;
  studentPhone: string;
  orderDeliveryFeeKobo: number;
  acceptedAt: Date | null;
  pickupDeadline: Date | null;
  waitDeadline: Date | null;
  offerCount: number;
  vendorOrder: { order: { reference: string } };
};

/**
 * Contact details are part of the assignment, not of the advertisement: an
 * unclaimed job in the pool shows where to go and what it pays, but a student's
 * phone number is only revealed to the one agent carrying their package.
 */
function toView(row: DeliveryRow, options: { assigned: boolean }): DeliveryView {
  return {
    id: row.id,
    status: row.status,
    orderReference: row.vendorOrder.order.reference,
    pickupName: row.pickupName,
    pickupLocation: row.pickupLocation,
    pickupPhone: options.assigned ? row.pickupPhone : null,
    destinationName: row.destinationName,
    destinationNote: options.assigned ? row.destinationNote : null,
    studentPhone: options.assigned ? row.studentPhone : null,
    orderDeliveryFeeKobo: row.orderDeliveryFeeKobo,
    acceptedAt: row.acceptedAt,
    pickupDeadline: row.pickupDeadline,
    waitDeadline: row.waitDeadline,
    offerCount: row.offerCount,
  };
}

async function recordEvent(
  tx: PrismaTransactionClient,
  input: {
    deliveryId: string;
    campusId: string;
    type: DeliveryEventType;
    actorId?: string | null;
    actorRole?: Actor["role"] | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.deliveryEvent.create({
    data: {
      deliveryId: input.deliveryId,
      campusId: input.campusId,
      type: input.type,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      note: input.note ?? null,
    },
  });
}

async function campusTimers(
  tx: PrismaTransactionClient,
  campusId: string,
): Promise<{
  pickupWindowMinutes: number;
  studentWaitMinutes: number;
  goodsPaymentWindowMinutes: number;
}> {
  const settings = await tx.campusSettings.findUnique({
    where: { campusId },
    select: {
      pickupWindowMinutes: true,
      studentWaitMinutes: true,
      goodsPaymentWindowMinutes: true,
    },
  });
  // Every campus is created with settings; the fallback exists so a missing row
  // degrades to the PRD defaults instead of an unbounded window.
  return {
    pickupWindowMinutes: settings?.pickupWindowMinutes ?? 15,
    studentWaitMinutes: settings?.studentWaitMinutes ?? 10,
    goodsPaymentWindowMinutes: settings?.goodsPaymentWindowMinutes ?? 10,
  };
}


/**
 * Create the delivery for a vendor order the vendor has just marked ready.
 *
 * Called from the vendor order transition inside its transaction, so a package
 * becomes ready and gains a delivery atomically. The job is only advertised once
 * the delivery fee is settled (PRD §32); until then it waits, which is why a
 * fresh delivery on an unpaid order is AWAITING_DELIVERY_PAYMENT rather than
 * AVAILABLE.
 */
export async function createDeliveryForVendorOrder(
  tx: PrismaTransactionClient,
  vendorOrderId: string,
  actor: Actor,
): Promise<void> {
  const vendorOrder = await tx.vendorOrder.findUnique({
    where: { id: vendorOrderId },
    select: {
      id: true,
      campusId: true,
      vendorProfile: { select: { storeName: true, storefrontLocation: true, phone: true } },
      order: {
        select: {
          status: true,
          deliveryLocationId: true,
          deliveryLocationName: true,
          deliveryNote: true,
          contactPhone: true,
          deliveryFeeKobo: true,
        },
      },
    },
  });
  if (!vendorOrder) throw new NotFoundError("Order not found");

  const existing = await tx.delivery.findUnique({
    where: { vendorOrderId },
    select: { id: true },
  });
  // The unique index already forbids a second delivery; returning quietly keeps
  // a repeated "ready for pickup" idempotent rather than an error the vendor
  // cannot act on.
  if (existing) return;

  const feePaid = vendorOrder.order.status === "DELIVERY_PAID";
  const now = new Date();

  const delivery = await tx.delivery.create({
    data: {
      campusId: vendorOrder.campusId,
      vendorOrderId: vendorOrder.id,
      status: feePaid ? "AVAILABLE" : "AWAITING_DELIVERY_PAYMENT",
      pooledAt: feePaid ? now : null,
      pickupName: vendorOrder.vendorProfile.storeName,
      pickupLocation: vendorOrder.vendorProfile.storefrontLocation,
      pickupPhone: vendorOrder.vendorProfile.phone,
      destinationLocationId: vendorOrder.order.deliveryLocationId,
      destinationName: vendorOrder.order.deliveryLocationName,
      destinationNote: vendorOrder.order.deliveryNote,
      studentPhone: vendorOrder.order.contactPhone,
      orderDeliveryFeeKobo: vendorOrder.order.deliveryFeeKobo,
    },
    select: { id: true, status: true },
  });

  if (feePaid) {
    await recordEvent(tx, {
      deliveryId: delivery.id,
      campusId: vendorOrder.campusId,
      type: "POOLED",
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await recordAudit(
      {
        action: AuditAction.DELIVERY_POOLED,
        entityType: "Delivery",
        entityId: delivery.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: vendorOrder.campusId,
        after: { status: delivery.status },
      },
      tx,
    );
  }
}

/**
 * Release every waiting delivery on an order whose fee has just been settled.
 *
 * This is the seam Phase 8 calls from the Paystack webhook. It is deliberately
 * not exposed as a route: nothing in the product may declare a payment
 * successful except the payment provider.
 */
export async function publishDeliveriesForPaidOrder(
  orderId: string,
  tx?: PrismaTransactionClient,
): Promise<number> {
  const client = tx ?? prisma;

  const waiting = await client.delivery.findMany({
    where: { vendorOrder: { orderId }, status: "AWAITING_DELIVERY_PAYMENT" },
    select: {
      id: true,
      campusId: true,
      destinationName: true,
      orderDeliveryFeeKobo: true,
    },
  });

  const pooled: typeof waiting = [];

  for (const delivery of waiting) {
    const claimed = await client.delivery.updateMany({
      where: { id: delivery.id, status: "AWAITING_DELIVERY_PAYMENT" },
      data: { status: "AVAILABLE", pooledAt: new Date() },
    });
    if (claimed.count === 0) continue;

    await client.deliveryEvent.create({
      data: { deliveryId: delivery.id, campusId: delivery.campusId, type: "POOLED" },
    });
    pooled.push(delivery);
  }

  // Announced only for deliveries this call actually pooled, and only after the
  // status write: a webhook that retries must not re-alert every agent.
  //
  // When `tx` is present the caller is mid-transaction, so the fan-out is left
  // to them — pushing inside a transaction risks announcing a payment that then
  // rolls back (PRD §52).
  if (!tx) {
    for (const delivery of pooled) {
      await notifyPoolOfDelivery(delivery);
    }
  }

  return waiting.length;
}

/**
 * Tells every on-duty agent on the campus that work is available (PRD §38).
 *
 * Exported for the paths that pool a delivery in their own transaction and must
 * announce it once they have committed.
 */
export async function notifyPoolOfDelivery(delivery: {
  id: string;
  campusId: string;
  destinationName: string;
  orderDeliveryFeeKobo: number;
}): Promise<void> {
  const recipients = await onDutyAgentRecipients(delivery.campusId);

  await notify({
    type: "DELIVERY_AVAILABLE",
    recipients,
    // Destination and fee only. An agent who has not accepted this job has no
    // business knowing whose package it is or what is in it (PRD §38).
    facts: {
      destinationName: delivery.destinationName,
      amountKobo: delivery.orderDeliveryFeeKobo,
    },
    entityType: "Delivery",
    entityId: delivery.id,
  });
}

/**
 * Tell the student who is waiting for this package that it moved.
 *
 * Reads the audience itself, after the transaction that changed the state has
 * committed, so a rolled-back progress step never produces a notification.
 * Failures are swallowed by `notify`, so a delivery step never fails because a
 * phone could not be reached (PRD §52).
 */
async function notifyStudentOfDelivery(
  deliveryId: string,
  type: NotificationType,
  extra?: NotificationFacts,
): Promise<void> {
  const row = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    select: {
      campusId: true,
      pickupName: true,
      destinationName: true,
      vendorOrder: {
        select: { order: { select: { id: true, reference: true, studentId: true } } },
      },
    },
  });
  if (!row) return;

  await notify({
    type,
    recipients: [{ userId: row.vendorOrder.order.studentId, campusId: row.campusId }],
    facts: {
      reference: row.vendorOrder.order.reference,
      storeName: row.pickupName,
      destinationName: row.destinationName,
      ...extra,
    },
    // Linked to the order, not the delivery: /orders is where a student can act
    // on it, and a delivery id means nothing to them.
    entityType: "Order",
    entityId: row.vendorOrder.order.id,
  });
}


/**
 * The destination an agent is currently locked to, or null when free (PRD §43).
 */

async function currentLock(
  client: PrismaTransactionClient | typeof prisma,
  agentProfileId: string,
): Promise<string | null> {
  const active = await client.delivery.findFirst({
    where: { agentProfileId, status: { in: [...ACTIVE_AGENT_STATUSES] } },
    orderBy: { acceptedAt: "asc" },
    select: { destinationLocationId: true },
  });
  return active?.destinationLocationId ?? null;
}

/**
 * The pool an agent may see right now.
 *
 * Campus and destination lock are applied in the query, not in the component
 * (Rule 25): an agent carrying a package to Hostel B is offered further jobs to
 * Hostel B so one trip can serve several vendors, and nothing else.
 */
export async function listPool(actor: Actor): Promise<DeliveryView[]> {
  const agent = await requireApprovedAgent(actor, { requireOnDuty: true });

  // Reading the pool is also when abandoned claims are cleaned up, so a package
  // whose 15 minutes ran out is offered again even with no scheduler running
  // (PRD §41).
  await expirePickups({ campusId: agent.campusId });

  const lockedDestinationId = await currentLock(prisma, agent.id);


  const rows = await prisma.delivery.findMany({
    where: {
      campusId: agent.campusId,
      status: "AVAILABLE",
      ...(lockedDestinationId ? { destinationLocationId: lockedDestinationId } : {}),
    },
    orderBy: { pooledAt: "asc" },
    select: deliverySelect,
  });

  return rows.map((row) => toView(row, { assigned: false }));
}

/** The agent's own work: everything live, plus recent history. */
export async function listMyDeliveries(actor: Actor): Promise<DeliveryView[]> {
  const agent = await requireApprovedAgent(actor);

  const rows = await prisma.delivery.findMany({
    where: { agentProfileId: agent.id, campusId: agent.campusId },
    orderBy: { acceptedAt: "desc" },
    take: 40,
    select: deliverySelect,
  });

  return rows.map((row) => toView(row, { assigned: true }));
}

/**
 * First valid acceptance wins (PRD §40).
 *
 * The claim is a single conditional `updateMany` on status and agent: two agents
 * tapping at the same instant both run it, but only one row matches
 * `status = AVAILABLE AND agentProfileId IS NULL`, so exactly one gets a count
 * of 1 and the other is told it is gone. No advisory lock, no read-then-write
 * window, nothing that depends on which request arrived first.
 */
export async function acceptDelivery(actor: Actor, deliveryId: string): Promise<DeliveryView> {
  const agent = await requireApprovedAgent(actor, { requireOnDuty: true });

  const accepted = await prisma.$transaction(async (tx) => {

    const existing = await tx.delivery.findFirst({
      where: { id: deliveryId, campusId: agent.campusId },
      select: { id: true, status: true, campusId: true, destinationLocationId: true },
    });
    if (!existing) throw new NotFoundError("Delivery not found");
    if (!canTransition(existing.status, "ACCEPTED")) {
      throw new ConflictError("This delivery has already been taken");
    }

    const lockedDestinationId = await currentLock(tx, agent.id);
    if (lockedDestinationId && lockedDestinationId !== existing.destinationLocationId) {
      throw new ForbiddenError(
        "Finish the delivery you are carrying before taking one to another destination",
      );
    }

    const { pickupWindowMinutes } = await campusTimers(tx, existing.campusId);
    const acceptedAt = new Date();

    const claimed = await tx.delivery.updateMany({
      where: { id: existing.id, status: "AVAILABLE", agentProfileId: null },
      data: {
        status: "ACCEPTED",
        agentProfileId: agent.id,
        agentUserId: actor.userId,
        acceptedAt,
        pickupDeadline: deadlineFrom(acceptedAt, pickupWindowMinutes),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictError("Another agent accepted this delivery first");
    }

    await recordEvent(tx, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: "ACCEPTED",
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await recordAudit(
      {
        action: AuditAction.DELIVERY_ACCEPTED,
        entityType: "Delivery",
        entityId: existing.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: { status: existing.status },
        after: { status: "ACCEPTED", pickupWindowMinutes },
      },
      tx,
    );

    const row = await tx.delivery.findUniqueOrThrow({
      where: { id: existing.id },
      select: deliverySelect,
    });
    return toView(row, { assigned: true });
  });

  // Only the student is told, and only after the claim is committed: the losing
  // agent in a race must not trigger a "an agent is on it" for someone else.
  await notifyStudentOfDelivery(accepted.id, "DELIVERY_ACCEPTED");

  return accepted;
}

const PROGRESS_EVENT: Record<DeliveryProgressInput["action"], DeliveryEventType> = {

  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  ARRIVED: "ARRIVED",
};

/**
 * Move a delivery the agent is carrying one step forward.
 *
 * Collecting the package is the step the pickup deadline guards: if the window
 * has already closed the server expires the job back to the pool instead of
 * accepting a late pickup, which is the whole point of storing the deadline
 * server-side (PRD §41).
 */
export async function progressDelivery(
  actor: Actor,
  deliveryId: string,
  input: DeliveryProgressInput,
): Promise<DeliveryView> {
  const agent = await requireApprovedAgent(actor);

  const progressed = await prisma.$transaction(async (tx) => {
    const existing = await tx.delivery.findFirst({
      where: { id: deliveryId, agentProfileId: agent.id, campusId: agent.campusId },
      select: {
        id: true,
        campusId: true,
        status: true,
        pickupDeadline: true,
        vendorOrderId: true,
      },
    });
    if (!existing) throw new NotFoundError("Delivery not found");


    if (!canTransition(existing.status, input.action)) {
      throw new StateConflictError(
        `A delivery that is ${existing.status.toLowerCase()} cannot become ${input.action.toLowerCase()}`,
      );
    }

    const now = new Date();

    if (input.action === "PICKED_UP" && isPastDeadline(existing.pickupDeadline, now)) {
      await releaseToPool(tx, {
        deliveryId: existing.id,
        campusId: existing.campusId,
        type: "PICKUP_EXPIRED",
        note: "Pickup window closed before collection",
      });
      throw new StateConflictError(
        "Your pickup window closed, so the delivery went back to the pool",
      );
    }

    const { studentWaitMinutes } = await campusTimers(tx, existing.campusId);

    await tx.delivery.update({
      where: { id: existing.id },
      data: {
        status: input.action,
        ...(input.action === "PICKED_UP" ? { pickedUpAt: now } : {}),
        ...(input.action === "IN_TRANSIT" ? { inTransitAt: now } : {}),
        ...(input.action === "ARRIVED"
          ? { arrivedAt: now, waitDeadline: deadlineFrom(now, studentWaitMinutes) }
          : {}),
      },
    });

    // The vendor's slice follows the package: once it leaves the store the
    // vendor's queue should show it as out for delivery, not still waiting.
    if (input.action === "PICKED_UP") {
      await tx.vendorOrder.updateMany({
        where: { id: existing.vendorOrderId, status: "READY_FOR_PICKUP" },
        data: { status: "IN_DELIVERY" },
      });
    }

    await recordEvent(tx, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: PROGRESS_EVENT[input.action],
      actorId: actor.userId,
      actorRole: actor.role,
    });

    if (input.action !== "IN_TRANSIT") {
      await recordAudit(
        {
          action:
            input.action === "PICKED_UP"
              ? AuditAction.DELIVERY_PICKED_UP
              : AuditAction.DELIVERY_ARRIVED,
          entityType: "Delivery",
          entityId: existing.id,
          actorId: actor.userId,
          actorRole: actor.role,
          campusId: existing.campusId,
          before: { status: existing.status },
          after: { status: input.action },
        },
        tx,
      );
    }

    const row = await tx.delivery.findUniqueOrThrow({
      where: { id: existing.id },
      select: deliverySelect,
    });
    return toView(row, { assigned: true });
  });

  // IN_TRANSIT is deliberately silent: it tells a student nothing they cannot
  // already see, and a phone buzzing for every leg of a five-minute walk is the
  // fastest way to have notifications switched off (PRD §55).
  if (input.action === "PICKED_UP") {
    await notifyStudentOfDelivery(progressed.id, "DELIVERY_PICKED_UP");
  }
  if (input.action === "ARRIVED") {
    // The wait is on a clock the server owns, so the student is told how long
    // they have rather than left to guess.
    const minutes = progressed.waitDeadline
      ? Math.max(0, Math.round((progressed.waitDeadline.getTime() - Date.now()) / 60_000))
      : undefined;
    await notifyStudentOfDelivery(progressed.id, "DELIVERY_ARRIVED", { minutes });
  }

  return progressed;
}

/**
 * Put a claimed delivery back in the pool, unassigned (PRD §41, §42).

 *
 * Shared by the pickup-expiry sweep and by an agent giving a job up, because
 * both end in the same place: no agent, no deadlines, one more offer, and the
 * reason on the record.
 */
async function releaseToPool(
  tx: PrismaTransactionClient,
  input: {
    deliveryId: string;
    campusId: string;
    type: Extract<DeliveryEventType, "PICKUP_EXPIRED" | "AGENT_CANCELLED">;
    note: string;
    actorId?: string | null;
    actorRole?: Actor["role"] | null;
  },
): Promise<void> {
  await tx.delivery.update({
    where: { id: input.deliveryId },
    data: {
      status: "AVAILABLE",
      agentProfileId: null,
      agentUserId: null,
      acceptedAt: null,
      pickupDeadline: null,
      pooledAt: new Date(),
      offerCount: { increment: 1 },
      resolutionNote: input.note,
    },
  });

  await recordEvent(tx, {
    deliveryId: input.deliveryId,
    campusId: input.campusId,
    type: input.type,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    note: input.note,
  });
}

/**
 * An agent gives up a delivery they accepted but have not collected (PRD §42).
 *
 * Only before pickup: once the package is in the agent's hands, walking away is
 * a return to the vendor, not a re-offer, and Phase 6 handles that through the
 * student-unavailable path so the goods are always accounted for.
 *
 * The cancellation raises the agent's counter in the same transaction and
 * applies Rule 27's escalation, so an unreliable agent cannot outrun the count
 * by cancelling quickly.
 */
export async function cancelByAgent(
  actor: Actor,
  deliveryId: string,
  input: DeliveryCancelInput,
): Promise<{ id: string; escalation: string }> {
  const agent = await requireApprovedAgent(actor);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.delivery.findFirst({
      where: { id: deliveryId, agentProfileId: agent.id, campusId: agent.campusId },
      select: { id: true, campusId: true, status: true },
    });
    if (!existing) throw new NotFoundError("Delivery not found");
    if (existing.status !== "ACCEPTED") {
      throw new StateConflictError(
        "You can only cancel before collecting the package. Report the student as unavailable instead.",
      );
    }

    await releaseToPool(tx, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: "AGENT_CANCELLED",
      note: input.reason,
      actorId: actor.userId,
      actorRole: actor.role,
    });

    const updatedAgent = await tx.deliveryAgentProfile.update({
      where: { id: agent.id },
      data: { cancellationCount: { increment: 1 } },
      select: { cancellationCount: true },
    });

    const escalation = escalationForCancellations(updatedAgent.cancellationCount);
    if (escalation === "WARNING") {
      await tx.deliveryAgentProfile.update({
        where: { id: agent.id },
        data: { warnedAt: new Date() },
      });
    }
    if (escalation === "REVIEW") {
      // Flagged for an admin, not auto-suspended: taking someone's income away
      // is a human decision (PRD §42).
      await tx.deliveryAgentProfile.update({
        where: { id: agent.id },
        data: { underReviewAt: new Date(), isOnDuty: false },
      });
    }

    await recordAudit(
      {
        action: AuditAction.DELIVERY_AGENT_CANCELLED,
        entityType: "Delivery",
        entityId: existing.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        after: {
          reason: input.reason,
          cancellationCount: updatedAgent.cancellationCount,
          escalation,
        },
      },
      tx,
    );

    return { id: existing.id, escalation };
  });
}

/**
 * The student never came for the package (PRD §44).
 *
 * Allowed only after the wait deadline the server set on arrival, so an agent
 * cannot declare a student absent the moment they get there. The goods go back
 * to the vendor: the vendor order is cancelled, every reserved unit is returned
 * to stock as a recorded `RETURN` movement, and the invoice is cancelled when no
 * vendor slice survives. The student's delivery fee is not refunded (PRD §44) —
 * settlement of what was already paid belongs to Phase 8.
 */
export async function reportStudentUnavailable(
  actor: Actor,
  deliveryId: string,
  input: { note?: string },
): Promise<{ id: string; status: DeliveryStatus }> {
  const agent = await requireApprovedAgent(actor);

  const returned = await prisma.$transaction(async (tx) => {
    const existing = await tx.delivery.findFirst({
      where: { id: deliveryId, agentProfileId: agent.id, campusId: agent.campusId },
      select: {
        id: true,
        campusId: true,
        status: true,
        waitDeadline: true,
        vendorOrderId: true,
      },
    });
    if (!existing) throw new NotFoundError("Delivery not found");


    if (!canTransition(existing.status, "RETURNED")) {
      throw new StateConflictError(
        `A delivery that is ${existing.status.toLowerCase()} cannot be returned`,
      );
    }
    if (existing.status !== "ARRIVED") {
      throw new StateConflictError("Mark yourself as arrived before reporting the student absent");
    }
    if (!isPastDeadline(existing.waitDeadline, new Date())) {
      throw new StateConflictError("Keep waiting: the student still has time to arrive");
    }

    const note = input.note?.trim() || "Student did not arrive within the waiting period";
    const now = new Date();

    await tx.delivery.update({
      where: { id: existing.id },
      data: { status: "RETURNED", returnedAt: now, resolutionNote: note },
    });

    await recordEvent(tx, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: "STUDENT_UNAVAILABLE",
      actorId: actor.userId,
      actorRole: actor.role,
      note,
    });
    await recordEvent(tx, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: "RETURNED",
      actorId: actor.userId,
      actorRole: actor.role,
    });

    await returnVendorOrderToStock(tx, existing.vendorOrderId, actor.userId, note);


    await recordAudit(
      {
        action: AuditAction.DELIVERY_RETURNED,
        entityType: "Delivery",
        entityId: existing.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: { status: existing.status },
        after: { status: "RETURNED", note },
      },
      tx,
    );

    return { id: existing.id, status: "RETURNED" as DeliveryStatus, note };
  });

  // The student is told their goods went back, and why. This is one of the few
  // push-worthy messages: they are waiting for something that is no longer
  // coming (PRD §44, §55).
  await notifyStudentOfDelivery(returned.id, "DELIVERY_RETURNED", { reason: returned.note });

  return { id: returned.id, status: returned.status };
}

/**
 * Cancel one vendor's slice and give its reserved units back.

 *
 * Every unit that leaves or re-enters stock is written as an
 * `InventoryTransaction` in the same transaction as the movement itself, so the
 * level always reconciles with its history (PRD §22).
 *
 * `actorId` is nullable because the same routine serves a human decision (an
 * agent reporting an absent student) and a timeout sweep, which has no actor.
 */
async function returnVendorOrderToStock(
  tx: PrismaTransactionClient,
  vendorOrderId: string,
  actorId: string | null,
  reason: string,
): Promise<void> {

  const vendorOrder = await tx.vendorOrder.findUnique({
    where: { id: vendorOrderId },
    select: {
      id: true,
      orderId: true,
      campusId: true,
      status: true,
      vendorProfileId: true,
      items: { select: { productId: true, quantity: true } },
    },
  });
  if (!vendorOrder) return;
  if (vendorOrder.status === "CANCELLED") return;

  await tx.vendorOrder.update({
    where: { id: vendorOrder.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason },
  });

  for (const item of vendorOrder.items) {
    const restored = await tx.product.update({
      where: { id: item.productId },
      data: {
        stockQuantity: { increment: item.quantity },
        soldCount: { decrement: item.quantity },
      },
      select: { stockQuantity: true },
    });

    await tx.inventoryTransaction.create({
      data: {
        productId: item.productId,
        campusId: vendorOrder.campusId,
        vendorProfileId: vendorOrder.vendorProfileId,
        reason: "RETURN",
        delta: item.quantity,
        resultingStock: restored.stockQuantity,
        note: `Returned from order ${vendorOrder.orderId}: ${reason}`,
        actorId,

      },
    });
  }

  // The invoice is only cancelled when nothing is left to deliver; a
  // multi-vendor order survives one store's return.
  const remaining = await tx.vendorOrder.count({
    where: { orderId: vendorOrder.orderId, status: { not: "CANCELLED" } },
  });
  if (remaining === 0) {
    await tx.order.updateMany({
      where: { id: vendorOrder.orderId, status: { notIn: ["CANCELLED", "COMPLETED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason },
    });
  }
}

/**
 * Expire pickups whose window has closed (PRD §41).
 *
 * Written as a sweep the server can run from a scheduler, and also called
 * opportunistically when the pool is read, so a stale ACCEPTED row cannot keep
 * a package hidden from every other agent just because nobody triggered a
 * timer. Each row is released in its own transaction: one bad row must not
 * block the rest.
 */
export async function expirePickups(options?: { campusId?: string; now?: Date }): Promise<number> {
  const now = options?.now ?? new Date();

  const stale = await prisma.delivery.findMany({
    where: {
      status: "ACCEPTED",
      pickupDeadline: { lte: now },
      ...(options?.campusId ? { campusId: options.campusId } : {}),
    },
    select: { id: true, campusId: true },
    take: 50,
  });

  let released = 0;

  for (const delivery of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.delivery.findUnique({
          where: { id: delivery.id },
          select: { status: true, pickupDeadline: true },
        });
        if (!fresh || fresh.status !== "ACCEPTED") return;
        if (!isPastDeadline(fresh.pickupDeadline, now)) return;

        await releaseToPool(tx, {
          deliveryId: delivery.id,
          campusId: delivery.campusId,
          type: "PICKUP_EXPIRED",
          note: "Pickup window closed",
        });

        await recordAudit(
          {
            action: AuditAction.DELIVERY_PICKUP_EXPIRED,
            entityType: "Delivery",
            entityId: delivery.id,
            campusId: delivery.campusId,
            after: { status: "AVAILABLE" },
          },
          tx,
        );

        released += 1;
      });
    } catch (error) {
      logger.error("Failed to expire delivery pickup", { deliveryId: delivery.id, error });
    }
  }

  return released;
}

/**
 * What the student is told about their order's deliveries.
 *
 * Deliberately narrow: progress, the agent's name and number once one is
 * carrying the package, and nothing about the pool or other students.
 */
export async function listDeliveriesForStudentOrder(
  actor: Actor,
  orderId: string,
): Promise<
  {
    id: string;
    status: DeliveryStatus;
    pickupName: string;
    agentName: string | null;
    agentPhone: string | null;
    waitDeadline: Date | null;
    /** Set once the code is verified: how long is left to pay for the goods. */
    goodsPaymentDeadline: Date | null;
  }[]
> {

  const order = await prisma.order.findFirst({
    where: { id: orderId, studentId: actor.userId, campusId: actor.campusId ?? undefined },
    select: { id: true },
  });
  if (!order) throw new NotFoundError("Order not found");

  const rows = await prisma.delivery.findMany({
    where: { vendorOrder: { orderId } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      pickupName: true,
      waitDeadline: true,
      goodsPaymentDeadline: true,
      agent: { select: { name: true } },

      agentProfile: { select: { phone: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    pickupName: row.pickupName,
    agentName: row.agent?.name ?? null,
    agentPhone: row.agentProfile?.phone ?? null,
    waitDeadline: row.waitDeadline,
    goodsPaymentDeadline: row.goodsPaymentDeadline,
  }));
}

// ---------------------------------------------------------------------------
// Hand-over code and goods payment (PRD §45–46, Phase 7)
// ---------------------------------------------------------------------------

/**
 * Issue the hand-over code to the student standing in front of the agent
 * (PRD §45).
 *
 * The student asks for it, not the agent: the code is the student's proof that
 * they received their own package, and an agent able to mint it could release
 * payment for goods they never handed over. The plaintext is returned exactly
 * once, in this response, and only its HMAC is stored — so asking again does not
 * re-reveal the old code, it replaces it, which also invalidates a code that was
 * read out to the wrong person.
 */
export async function issueHandoverCode(
  actor: Actor,
  deliveryId: string,
): Promise<{ code: string; expiresAt: Date; goodsPaymentWindowMinutes: number }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.delivery.findFirst({
      // Ownership is in the query: the delivery must belong to an order this
      // student placed, on this campus (Rule 25).
      where: {
        id: deliveryId,
        campusId: actor.campusId ?? undefined,
        vendorOrder: { order: { studentId: actor.userId } },
      },
      select: { id: true, campusId: true, status: true, otpIssueCount: true },
    });
    if (!existing) throw new NotFoundError("Delivery not found");

    if (existing.status !== "ARRIVED" && existing.status !== "AWAITING_OTP") {
      throw new StateConflictError(
        "Your code appears once the agent has arrived with your package",
      );
    }

    const now = new Date();
    const expiresAt = deadlineFrom(now, OTP_VALIDITY_MINUTES);
    const code = generateHandoverCode();

    const { goodsPaymentWindowMinutes } = await campusTimers(tx, existing.campusId);

    await tx.delivery.update({
      where: { id: existing.id },
      data: {
        status: "AWAITING_OTP",
        otpHash: hashHandoverCode({
          code,
          deliveryId: existing.id,
          secret: env().BETTER_AUTH_SECRET,
        }),

        otpIssuedAt: now,
        otpExpiresAt: expiresAt,
        // A new code starts with a clean slate of attempts, so a locked-out
        // agent is unblocked by the student issuing another one.
        otpAttempts: 0,
        otpIssueCount: { increment: 1 },
      },
    });

    await recordEvent(tx, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: "OTP_ISSUED",
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await recordAudit(
      {
        action: AuditAction.DELIVERY_OTP_ISSUED,
        entityType: "Delivery",
        entityId: existing.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: { status: existing.status },
        // Never the code itself: an audit trail is not a place to keep a
        // credential.
        after: { status: "AWAITING_OTP", issueCount: existing.otpIssueCount + 1, expiresAt },
      },
      tx,
    );

    return { code, expiresAt, goodsPaymentWindowMinutes };
  });
}

/**
 * The agent types the code the student read out (PRD §45–46).
 *
 * A correct code is the hand-over: it moves the delivery to PAYMENT_PENDING and
 * starts the campus's goods-payment window, which is the only thing that unlocks
 * payment for the goods. Phase 8 settles that payment; nothing here takes money,
 * and nothing here trusts a client for the deadline.
 *
 * A wrong code costs an attempt and is recorded. After
 * `MAX_OTP_ATTEMPTS` the code is dead and the student must issue a new one —
 * that is the brute-force limit, and it deliberately puts the recovery in the
 * student's hands rather than the agent's.
 */
export async function verifyHandoverCode(
  actor: Actor,
  deliveryId: string,
  input: HandoverVerifyInput,
): Promise<DeliveryView> {
  const agent = await requireApprovedAgent(actor);

  const verified = await prisma.$transaction(async (tx) => {
    const existing = await tx.delivery.findFirst({
      where: { id: deliveryId, agentProfileId: agent.id, campusId: agent.campusId },
      select: {
        id: true,
        campusId: true,
        status: true,
        otpHash: true,
        otpExpiresAt: true,
        otpAttempts: true,
        otpVerifiedAt: true,
        vendorOrder: { select: { goodsSubtotalKobo: true } },
      },
    });
    if (!existing) throw new NotFoundError("Delivery not found");


    if (existing.status !== "AWAITING_OTP") {
      throw new StateConflictError(
        "Ask the student to show their hand-over code, then enter it here",
      );
    }

    const now = new Date();
    const usable = checkOtpUsable(
      {
        hash: existing.otpHash,
        expiresAt: existing.otpExpiresAt,
        attemptCount: existing.otpAttempts,
        verifiedAt: existing.otpVerifiedAt,
      },
      now,
    );
    if (!usable.ok) {
      if (usable.reason === "ALREADY_VERIFIED") {
        throw new StateConflictError("This hand-over has already been confirmed");
      }
      // Expired, locked and never-issued all end the same way for the agent:
      // the student has to produce a fresh code.
      throw new StateConflictError("That code is no longer valid. Ask the student for a new one.");
    }

    const submitted = hashHandoverCode({
      code: input.code,
      deliveryId: existing.id,
      secret: env().BETTER_AUTH_SECRET,
    });


    if (!hashesMatch(submitted, existing.otpHash ?? "")) {
      const failed = await tx.delivery.update({
        where: { id: existing.id },
        data: { otpAttempts: { increment: 1 } },
        select: { otpAttempts: true },
      });

      await recordEvent(tx, {
        deliveryId: existing.id,
        campusId: existing.campusId,
        type: "OTP_FAILED",
        actorId: actor.userId,
        actorRole: actor.role,
        note: `Attempt ${failed.otpAttempts}`,
      });
      await recordAudit(
        {
          action: AuditAction.DELIVERY_OTP_FAILED,
          entityType: "Delivery",
          entityId: existing.id,
          actorId: actor.userId,
          actorRole: actor.role,
          campusId: existing.campusId,
          after: { attempts: failed.otpAttempts },
        },
        tx,
      );

      const left = attemptsRemaining(failed.otpAttempts);
      throw new ValidationError(
        left > 0
          ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`
          : "Too many wrong tries. Ask the student to issue a new code.",
        { attemptsRemaining: left },
      );
    }

    const { goodsPaymentWindowMinutes } = await campusTimers(tx, existing.campusId);
    const goodsPaymentDeadline = deadlineFrom(now, goodsPaymentWindowMinutes);

    await tx.delivery.update({
      where: { id: existing.id },
      data: {
        status: "PAYMENT_PENDING",
        otpVerifiedAt: now,
        // Single use: the hash goes as soon as it has done its job.
        otpHash: null,
        goodsPaymentDeadline,
      },
    });

    await recordEvent(tx, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: "OTP_VERIFIED",
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await recordAudit(
      {
        action: AuditAction.DELIVERY_OTP_VERIFIED,
        entityType: "Delivery",
        entityId: existing.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: { status: existing.status },
        after: { status: "PAYMENT_PENDING", goodsPaymentDeadline, goodsPaymentWindowMinutes },
      },
      tx,
    );

    const row = await tx.delivery.findUniqueOrThrow({
      where: { id: existing.id },
      select: deliverySelect,
    });
    return {
      view: toView(row, { assigned: true }),
      goodsSubtotalKobo: existing.vendorOrder.goodsSubtotalKobo,
      goodsPaymentWindowMinutes,
    };
  });

  // The one notification with money and a deadline in it, because the student
  // now has a window to pay for goods they are already holding (PRD §46).
  await notifyStudentOfDelivery(verified.view.id, "HANDOVER_VERIFIED", {
    amountKobo: verified.goodsSubtotalKobo,
    minutes: verified.goodsPaymentWindowMinutes,
  });

  return verified.view;
}

/**
 * Close a delivery once the goods have been paid for (PRD §46).

 *
 * The seam Phase 8 calls from the Paystack webhook, deliberately not a route:
 * only the payment provider may declare money received (Rule 3). Idempotent,
 * because a webhook is retried — a delivery that is already COMPLETED returns
 * quietly instead of failing the retry.
 */
export async function completeDeliveryOnGoodsPayment(
  deliveryId: string,
  tx?: PrismaTransactionClient,
): Promise<{ id: string; status: DeliveryStatus }> {
  const run = async (client: PrismaTransactionClient) => {
    const existing = await client.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, campusId: true, status: true, vendorOrderId: true },
    });
    if (!existing) throw new NotFoundError("Delivery not found");
    if (existing.status === "COMPLETED") {
      return { id: existing.id, status: existing.status };
    }
    if (existing.status !== "PAYMENT_PENDING") {
      throw new StateConflictError(
        `A delivery that is ${existing.status.toLowerCase()} cannot be completed`,
      );
    }

    const now = new Date();

    await client.delivery.update({
      where: { id: existing.id },
      data: { status: "COMPLETED", completedAt: now, goodsPaymentDeadline: null },
    });

    const vendorOrder = await client.vendorOrder.update({
      where: { id: existing.vendorOrderId },
      data: { status: "COMPLETED" },
      select: { orderId: true },
    });

    // The invoice closes when no slice is still in flight. A multi-vendor order
    // waits for its last package.
    const outstanding = await client.vendorOrder.count({
      where: {
        orderId: vendorOrder.orderId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
    });
    if (outstanding === 0) {
      await client.order.updateMany({
        where: { id: vendorOrder.orderId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        data: { status: "COMPLETED" },
      });
    }

    await recordEvent(client, {
      deliveryId: existing.id,
      campusId: existing.campusId,
      type: "COMPLETED",
    });
    await recordAudit(
      {
        action: AuditAction.DELIVERY_COMPLETED,
        entityType: "Delivery",
        entityId: existing.id,
        campusId: existing.campusId,
        before: { status: existing.status },
        after: { status: "COMPLETED" },
      },
      client,
    );

    return { id: existing.id, status: "COMPLETED" as DeliveryStatus };
  };

  return tx ? run(tx) : prisma.$transaction(run);
}

/**
 * Return the goods when the student never pays for them (PRD §46).
 *
 * The mirror image of the pickup sweep: a package handed over but unpaid cannot
 * sit in limbo, so once the campus's goods-payment window closes the delivery is
 * returned, the vendor order is cancelled and every reserved unit goes back to
 * stock as a recorded movement. The delivery fee already paid is not refunded —
 * the trip happened. Each row runs in its own transaction so one failure does
 * not block the rest.
 */
export async function expireGoodsPayments(options?: {
  campusId?: string;
  now?: Date;
}): Promise<number> {
  const now = options?.now ?? new Date();

  const stale = await prisma.delivery.findMany({
    where: {
      status: "PAYMENT_PENDING",
      goodsPaymentDeadline: { lte: now },
      ...(options?.campusId ? { campusId: options.campusId } : {}),
    },
    select: { id: true, campusId: true },
    take: 50,
  });

  let returned = 0;

  for (const delivery of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.delivery.findUnique({
          where: { id: delivery.id },
          select: { status: true, goodsPaymentDeadline: true, vendorOrderId: true },
        });
        if (!fresh || fresh.status !== "PAYMENT_PENDING") return;
        if (!isPastDeadline(fresh.goodsPaymentDeadline, now)) return;

        const note = "Goods were not paid for within the payment window";

        await tx.delivery.update({
          where: { id: delivery.id },
          data: { status: "RETURNED", returnedAt: now, resolutionNote: note },
        });

        await recordEvent(tx, {
          deliveryId: delivery.id,
          campusId: delivery.campusId,
          type: "PAYMENT_TIMED_OUT",
          note,
        });
        await recordEvent(tx, {
          deliveryId: delivery.id,
          campusId: delivery.campusId,
          type: "RETURNED",
        });

        await returnVendorOrderToStock(tx, fresh.vendorOrderId, null, note);

        await recordAudit(
          {
            action: AuditAction.DELIVERY_PAYMENT_TIMED_OUT,
            entityType: "Delivery",
            entityId: delivery.id,
            campusId: delivery.campusId,
            before: { status: "PAYMENT_PENDING" },
            after: { status: "RETURNED", note },
          },
          tx,
        );

        returned += 1;
      });
    } catch (error) {
      logger.error("Failed to expire goods payment", { deliveryId: delivery.id, error });
    }
  }

  return returned;
}



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
import { ConflictError, ForbiddenError, NotFoundError, StateConflictError } from "@/lib/errors";
import type { DeliveryEventType, DeliveryStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import type { DeliveryCancelInput, DeliveryProgressInput } from "@/validations/delivery";

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
): Promise<{ pickupWindowMinutes: number; studentWaitMinutes: number }> {
  const settings = await tx.campusSettings.findUnique({
    where: { campusId },
    select: { pickupWindowMinutes: true, studentWaitMinutes: true },
  });
  // Every campus is created with settings; the fallback exists so a missing row
  // degrades to the PRD defaults instead of an unbounded window.
  return {
    pickupWindowMinutes: settings?.pickupWindowMinutes ?? 15,
    studentWaitMinutes: settings?.studentWaitMinutes ?? 10,
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
    select: { id: true, campusId: true },
  });

  for (const delivery of waiting) {
    const claimed = await client.delivery.updateMany({
      where: { id: delivery.id, status: "AWAITING_DELIVERY_PAYMENT" },
      data: { status: "AVAILABLE", pooledAt: new Date() },
    });
    if (claimed.count === 0) continue;

    await client.deliveryEvent.create({
      data: { deliveryId: delivery.id, campusId: delivery.campusId, type: "POOLED" },
    });
  }

  return waiting.length;
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

  return prisma.$transaction(async (tx) => {
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

  return prisma.$transaction(async (tx) => {
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

  return prisma.$transaction(async (tx) => {
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

    await returnVendorOrderToStock(tx, existing.vendorOrderId, actor, note);

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

    return { id: existing.id, status: "RETURNED" as DeliveryStatus };
  });
}

/**
 * Cancel one vendor's slice and give its reserved units back.
 *
 * Every unit that leaves or re-enters stock is written as an
 * `InventoryTransaction` in the same transaction as the movement itself, so the
 * level always reconciles with its history (PRD §22).
 */
async function returnVendorOrderToStock(
  tx: PrismaTransactionClient,
  vendorOrderId: string,
  actor: Actor,
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
        actorId: actor.userId,
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
  }));
}

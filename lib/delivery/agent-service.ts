import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { VerificationStatus } from "@/lib/generated/prisma/enums";
import { requireVerifiedStudent } from "@/lib/orders/cart-service";
import type { AgentApplicationInput, AgentDutyInput, AgentReviewInput } from "@/validations/delivery";

/**
 * Delivery agents (PRD §36, §38, §42).
 *
 * Agency is a capability layered on a verified student, not a different kind of
 * account: only a verified student of the campus may apply, and approval does
 * not take away their ability to shop. That is why the user's `role` is left
 * alone and every agent action is gated on this profile instead — a suspended
 * agent is still a customer.
 */

export type AgentProfileView = {
  id: string;
  campusId: string;
  phone: string;
  status: VerificationStatus;
  isOnDuty: boolean;
  cancellationCount: number;
  isWarned: boolean;
  isUnderReview: boolean;
  reviewNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
};

type AgentRow = {
  id: string;
  campusId: string;
  phone: string;
  status: VerificationStatus;
  isOnDuty: boolean;
  cancellationCount: number;
  warnedAt: Date | null;
  underReviewAt: Date | null;
  reviewNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
};

function toView(row: AgentRow): AgentProfileView {
  return {
    id: row.id,
    campusId: row.campusId,
    phone: row.phone,
    status: row.status,
    isOnDuty: row.isOnDuty,
    cancellationCount: row.cancellationCount,
    isWarned: row.warnedAt !== null,
    isUnderReview: row.underReviewAt !== null,
    reviewNote: row.reviewNote,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
  };
}

const agentSelect = {
  id: true,
  campusId: true,
  phone: true,
  status: true,
  isOnDuty: true,
  cancellationCount: true,
  warnedAt: true,
  underReviewAt: true,
  reviewNote: true,
  submittedAt: true,
  reviewedAt: true,
} as const;

/** The caller's own agent profile, or null if they have never applied. */
export async function getMyAgentProfile(actor: Actor): Promise<AgentProfileView | null> {
  const row = await prisma.deliveryAgentProfile.findUnique({
    where: { userId: actor.userId },
    select: agentSelect,
  });
  return row ? toView(row) : null;
}

/**
 * Apply, or resubmit after a correction request.
 *
 * Re-applying is an update rather than a second row: an agent has one history on
 * a campus, and a new row would reset the cancellation count that Rule 27
 * depends on.
 */
export async function applyToBeAgent(
  actor: Actor,
  input: AgentApplicationInput,
): Promise<AgentProfileView> {
  const { campusId } = await requireVerifiedStudent(actor);

  const existing = await prisma.deliveryAgentProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === "APPROVED" || existing.status === "PENDING_VERIFICATION") {
      throw new ConflictError("You have already applied to deliver on this campus");
    }
    if (existing.status === "SUSPENDED") {
      throw new ForbiddenError("Your agent account is suspended. Contact your campus admin.");
    }
  }

  const row = await prisma.deliveryAgentProfile.upsert({
    where: { userId: actor.userId },
    create: {
      userId: actor.userId,
      campusId,
      phone: input.phone,
      status: "PENDING_VERIFICATION",
      submittedAt: new Date(),
    },
    update: {
      phone: input.phone,
      status: "PENDING_VERIFICATION",
      submittedAt: new Date(),
      reviewNote: null,
    },
    select: agentSelect,
  });

  await recordAudit({
    action: AuditAction.AGENT_APPLIED,
    entityType: "DeliveryAgentProfile",
    entityId: row.id,
    actorId: actor.userId,
    actorRole: actor.role,
    campusId,
    after: { status: row.status },
  });

  return toView(row);
}

/**
 * The single approval gate for the delivery engine.
 *
 * Every pool read and every state transition goes through this, so "who may
 * carry a package" is decided in exactly one place: approved, not suspended, on
 * duty, and on the campus the work belongs to.
 */
export async function requireApprovedAgent(
  actor: Actor,
  options?: { requireOnDuty?: boolean },
): Promise<{ id: string; campusId: string; isOnDuty: boolean }> {
  if (actor.isSuspended) {
    throw new ForbiddenError("Your account is suspended");
  }

  const profile = await prisma.deliveryAgentProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, campusId: true, status: true, isOnDuty: true },
  });

  if (!profile) throw new ForbiddenError("You are not registered as a delivery agent");
  if (profile.status !== "APPROVED") {
    throw new ForbiddenError("Your agent application has not been approved yet");
  }
  // Campus isolation: an agent may only work the campus they were approved on,
  // and the actor's campus is re-read from the database on every request.
  if (actor.role !== "SUPER_ADMIN" && profile.campusId !== actor.campusId) {
    throw new ForbiddenError("You may only deliver on your own campus");
  }
  if (options?.requireOnDuty && !profile.isOnDuty) {
    throw new ForbiddenError("Go on duty to take deliveries");
  }

  return { id: profile.id, campusId: profile.campusId, isOnDuty: profile.isOnDuty };
}

/** The agent's own duty switch. Going off duty never drops work in progress. */
export async function setDutyStatus(actor: Actor, input: AgentDutyInput): Promise<AgentProfileView> {
  const agent = await requireApprovedAgent(actor);

  const row = await prisma.deliveryAgentProfile.update({
    where: { id: agent.id },
    data: { isOnDuty: input.isOnDuty },
    select: agentSelect,
  });

  return toView(row);
}

/** The Campus Admin review queue, newest application first. */
export async function listAgentsForAdmin(
  actor: Actor,
  options?: { status?: VerificationStatus },
): Promise<(AgentProfileView & { name: string; email: string })[]> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Only a campus admin may review delivery agents");
  }

  const rows = await prisma.deliveryAgentProfile.findMany({
    // Campus isolation happens in the query, never in the view (Rule 25).
    where: {
      ...(actor.role === "SUPER_ADMIN" ? {} : { campusId: actor.campusId ?? "" }),
      ...(options?.status ? { status: options.status } : {}),
    },
    orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
    select: { ...agentSelect, user: { select: { name: true, email: true } } },
  });

  return rows.map((row) => ({
    ...toView(row),
    name: row.user.name,
    email: row.user.email,
  }));
}

const REVIEW_RESULT: Record<AgentReviewInput["decision"], VerificationStatus> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  REQUEST_CORRECTION: "CORRECTION_REQUESTED",
  SUSPEND: "SUSPENDED",
  REINSTATE: "APPROVED",
};

const REVIEW_AUDIT: Record<AgentReviewInput["decision"], string> = {
  APPROVE: AuditAction.AGENT_APPROVED,
  REJECT: AuditAction.AGENT_REJECTED,
  REQUEST_CORRECTION: AuditAction.AGENT_REJECTED,
  SUSPEND: AuditAction.AGENT_SUSPENDED,
  REINSTATE: AuditAction.AGENT_APPROVED,
};

/**
 * A Campus Admin's decision.
 *
 * A named operation inside a transaction that re-reads the row: two admins
 * clicking at once cannot produce an approval written over a suspension.
 * Suspending also takes the agent off duty and clears the escalation flags, so
 * a reinstated agent starts from a known state rather than an old warning.
 */
export async function reviewAgent(
  actor: Actor,
  agentProfileId: string,
  input: AgentReviewInput,
): Promise<AgentProfileView> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("Only a campus admin may review delivery agents");
  }

  const nextStatus = REVIEW_RESULT[input.decision];

  return prisma.$transaction(async (tx) => {
    const existing = await tx.deliveryAgentProfile.findFirst({
      where: {
        id: agentProfileId,
        ...(actor.role === "SUPER_ADMIN" ? {} : { campusId: actor.campusId ?? "" }),
      },
      select: { id: true, status: true, campusId: true },
    });
    if (!existing) throw new NotFoundError("Agent application not found");

    if (existing.status === nextStatus && input.decision !== "REINSTATE") {
      throw new ConflictError(`This application is already ${nextStatus.toLowerCase()}`);
    }
    if (input.decision === "REINSTATE" && existing.status !== "SUSPENDED") {
      throw new ConflictError("Only a suspended agent can be reinstated");
    }

    const row = await tx.deliveryAgentProfile.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        reviewNote: input.note ?? null,
        reviewedAt: new Date(),
        reviewedById: actor.userId,
        // A suspended or rejected agent is never left on duty holding the pool
        // open, and reinstatement wipes the escalation flags.
        ...(nextStatus === "APPROVED"
          ? { warnedAt: null, underReviewAt: null }
          : { isOnDuty: false }),
      },
      select: agentSelect,
    });

    await recordAudit(
      {
        action: REVIEW_AUDIT[input.decision],
        entityType: "DeliveryAgentProfile",
        entityId: row.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: existing.campusId,
        before: { status: existing.status },
        after: { status: row.status, note: input.note ?? null },
      },
      tx,
    );

    return toView(row);
  });
}

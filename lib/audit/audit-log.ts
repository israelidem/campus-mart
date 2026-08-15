import { prisma, type PrismaTransactionClient } from "@/lib/db/prisma";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";

/**
 * Audit logging (PRD §65).
 *
 * Sensitive state changes are recorded with actor, entity and before/after
 * snapshots. Writing an audit entry must never break the operation that
 * triggered it, so failures are logged rather than thrown — except when the
 * caller passes a transaction client, in which case the entry is part of the
 * transaction and shares its atomicity.
 */
export const AuditAction = {
  CAMPUS_CREATED: "CAMPUS_CREATED",
  CAMPUS_UPDATED: "CAMPUS_UPDATED",
  CAMPUS_STATUS_CHANGED: "CAMPUS_STATUS_CHANGED",
  CAMPUS_ADMIN_ASSIGNED: "CAMPUS_ADMIN_ASSIGNED",
  STUDENT_VERIFIED: "STUDENT_VERIFIED",
  STUDENT_REJECTED: "STUDENT_REJECTED",
  STUDENT_CORRECTION_REQUESTED: "STUDENT_CORRECTION_REQUESTED",
  STUDENT_REGISTRY_IMPORTED: "STUDENT_REGISTRY_IMPORTED",

  VENDOR_APPLIED: "VENDOR_APPLIED",
  VENDOR_APPROVED: "VENDOR_APPROVED",
  VENDOR_REJECTED: "VENDOR_REJECTED",
  VENDOR_CORRECTION_REQUESTED: "VENDOR_CORRECTION_REQUESTED",
  VENDOR_SUSPENDED: "VENDOR_SUSPENDED",
  VENDOR_REINSTATED: "VENDOR_REINSTATED",
  VENDOR_STORE_UPDATED: "VENDOR_STORE_UPDATED",
  VENDOR_HOURS_UPDATED: "VENDOR_HOURS_UPDATED",

  AGENT_APPROVED: "AGENT_APPROVED",
  AGENT_REJECTED: "AGENT_REJECTED",
  AGENT_SUSPENDED: "AGENT_SUSPENDED",
  USER_SUSPENDED: "USER_SUSPENDED",
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  REFUND_INITIATED: "REFUND_INITIATED",
  COMMISSION_CHANGED: "COMMISSION_CHANGED",
  DELIVERY_PRICING_CHANGED: "DELIVERY_PRICING_CHANGED",
} as const;

export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction] | string;

export type AuditEntry = {
  action: AuditActionName;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  actorRole?: UserRole | null;
  campusId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
};

export async function recordAudit(
  entry: AuditEntry,
  tx?: PrismaTransactionClient,
): Promise<void> {
  const data = {
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    campusId: entry.campusId ?? null,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
    ipAddress: entry.ipAddress ?? null,
  };

  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }

  try {
    await prisma.auditLog.create({ data });
  } catch (error) {
    logger.error("Failed to write audit log", { entry, error });
  }
}

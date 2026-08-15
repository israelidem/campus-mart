import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";

/**
 * Super Admin bootstrap (PRD §9).
 *
 * The platform owner cannot be created through the UI — there is no one to
 * approve them. Instead, an environment allowlist names the owner's email; the
 * first time that account is seen with a verified email, the role is granted and
 * the promotion is audited.
 *
 * The allowlist lives in the environment rather than the database so that
 * database write access alone is not enough to mint a Super Admin.
 */
function allowlist(): Set<string> {
  return new Set(
    env()
      .SUPER_ADMIN_EMAILS.split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isBootstrapSuperAdmin(email: string): boolean {
  return allowlist().has(email.trim().toLowerCase());
}

/**
 * Grants SUPER_ADMIN if the account is on the allowlist and does not already
 * hold the role. Returns the role the caller should act with.
 *
 * A campus-bound account is detached from its campus, because a Super Admin is
 * global by definition and a lingering campusId would silently scope global
 * queries. An unverified email is left alone: verification is the only evidence
 * that the person controls the allowlisted address.
 */
export async function ensureSuperAdmin(user: {
  id: string;
  email: string;
  role: UserRole;
  campusId: string | null;
  emailVerified: boolean;
}): Promise<{ role: UserRole; campusId: string | null }> {
  if (user.role === "SUPER_ADMIN") return { role: user.role, campusId: null };
  if (!user.emailVerified) return { role: user.role, campusId: user.campusId };
  if (!isBootstrapSuperAdmin(user.email)) return { role: user.role, campusId: user.campusId };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { role: "SUPER_ADMIN", campusId: null },
    });

    await recordAudit(
      {
        action: AuditAction.USER_ROLE_CHANGED,
        entityType: "User",
        entityId: user.id,
        actorId: user.id,
        actorRole: "SUPER_ADMIN",
        before: { role: user.role, campusId: user.campusId },
        after: { role: "SUPER_ADMIN", campusId: null, reason: "SUPER_ADMIN_EMAILS allowlist" },
      },
      tx,
    );
  });

  logger.warn("Super Admin granted from allowlist", { userId: user.id, email: user.email });

  return { role: "SUPER_ADMIN", campusId: null };
}

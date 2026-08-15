import { AuditAction, recordAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/session";
import { assertSameCampus } from "@/lib/authorization/campus";
import { prisma } from "@/lib/db/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  ValidationError,
} from "@/lib/errors";
import type { CampusSettings, Campus } from "@/lib/generated/prisma/client";
import type { CampusStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import {
  assertFeeBoundsCoherent,
  type AssignCampusAdminInput,
  type CampusSettingsInput,
  type CampusStatusInput,
  type CreateCampusInput,
  type UpdateCampusInput,
} from "@/validations/campus";

/**
 * Campus management (PRD Part D, Phase 2).
 *
 * Campus creation and cross-campus reads belong exclusively to the Super Admin.
 * Campus Admins may read and configure only their own campus; `assertSameCampus`
 * is applied on every path that accepts a campus id from a request.
 */

function assertSuperAdmin(actor: Actor): void {
  if (actor.role !== "SUPER_ADMIN") throw new ForbiddenError();
}

export type CampusSummary = {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string | null;
  country: string;
  status: CampusStatus;
  createdAt: Date;
  counts: { students: number; admins: number };
};

/** Global campus list. Super Admin only (PRD §9). */
export async function listCampuses(actor: Actor): Promise<CampusSummary[]> {
  assertSuperAdmin(actor);

  const campuses = await prisma.campus.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { students: true } },
      users: { where: { role: "CAMPUS_ADMIN" }, select: { id: true } },
    },
  });

  return campuses.map((campus) => ({
    id: campus.id,
    code: campus.code,
    name: campus.name,
    city: campus.city,
    state: campus.state,
    country: campus.country,
    status: campus.status,
    createdAt: campus.createdAt,
    counts: { students: campus._count.students, admins: campus.users.length },
  }));
}

/**
 * Reads one campus with its settings. A Campus Admin may only read their own
 * campus; a Super Admin may read any.
 */
export async function getCampus(
  actor: Actor,
  campusId: string,
): Promise<Campus & { settings: CampusSettings }> {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "CAMPUS_ADMIN") throw new ForbiddenError();
  assertSameCampus(actor, campusId);

  const campus = await prisma.campus.findUnique({
    where: { id: campusId },
    include: { settings: true },
  });
  if (!campus) throw new NotFoundError("Campus not found");

  // Settings are created with the campus; a missing row means older data.
  const settings = campus.settings ?? (await ensureSettings(campusId));

  return { ...campus, settings };
}

/** Backfills a settings row for a campus created before settings existed. */
async function ensureSettings(campusId: string): Promise<CampusSettings> {
  return prisma.campusSettings.upsert({
    where: { campusId },
    create: { campusId },
    update: {},
  });
}

/**
 * Creates a campus and its settings in one transaction (PRD §11), so a campus
 * can never exist without configuration.
 */
export async function createCampus(
  actor: Actor,
  input: CreateCampusInput,
): Promise<Campus & { settings: CampusSettings }> {
  assertSuperAdmin(actor);

  const existing = await prisma.campus.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (existing) throw new ConflictError(`A campus with the code ${input.code} already exists`);

  const campus = await prisma.$transaction(async (tx) => {
    const created = await tx.campus.create({
      data: {
        code: input.code,
        name: input.name,
        city: input.city,
        state: input.state ?? null,
        country: input.country,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        timezone: input.timezone,
        settings: { create: {} },
      },
      include: { settings: true },
    });

    await recordAudit(
      {
        action: AuditAction.CAMPUS_CREATED,
        entityType: "Campus",
        entityId: created.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: created.id,
        after: { code: created.code, name: created.name, status: created.status },
      },
      tx,
    );

    return created;
  });

  logger.info("Campus created", { campusId: campus.id, code: campus.code, actorId: actor.userId });

  // `settings` is non-null because it is created in the same statement.
  return { ...campus, settings: campus.settings! };
}

/** Updates campus details. The code is immutable. */
export async function updateCampus(
  actor: Actor,
  campusId: string,
  input: UpdateCampusInput,
): Promise<Campus> {
  assertSuperAdmin(actor);

  const before = await prisma.campus.findUnique({ where: { id: campusId } });
  if (!before) throw new NotFoundError("Campus not found");

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.campus.update({
      where: { id: campusId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      },
    });

    await recordAudit(
      {
        action: AuditAction.CAMPUS_UPDATED,
        entityType: "Campus",
        entityId: campusId,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        before: {
          name: before.name,
          city: before.city,
          state: before.state,
          country: before.country,
          latitude: before.latitude,
          longitude: before.longitude,
          timezone: before.timezone,
        },
        after: {
          name: saved.name,
          city: saved.city,
          state: saved.state,
          country: saved.country,
          latitude: saved.latitude,
          longitude: saved.longitude,
          timezone: saved.timezone,
        },
      },
      tx,
    );

    return saved;
  });

  return updated;
}

/**
 * Activates or deactivates a campus (PRD §9). Deactivation hides the campus
 * from registration immediately; it does not delete data.
 */
export async function setCampusStatus(
  actor: Actor,
  campusId: string,
  input: CampusStatusInput,
): Promise<Campus> {
  assertSuperAdmin(actor);

  const before = await prisma.campus.findUnique({
    where: { id: campusId },
    select: { id: true, status: true, code: true },
  });
  if (!before) throw new NotFoundError("Campus not found");
  if (before.status === input.status) {
    throw new StateConflictError(`This campus is already ${input.status.toLowerCase()}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.campus.update({
      where: { id: campusId },
      data: { status: input.status },
    });

    await recordAudit(
      {
        action: AuditAction.CAMPUS_STATUS_CHANGED,
        entityType: "Campus",
        entityId: campusId,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        before: { status: before.status },
        after: { status: saved.status, reason: input.reason ?? null },
      },
      tx,
    );

    return saved;
  });

  logger.info("Campus status changed", {
    campusId,
    code: before.code,
    from: before.status,
    to: updated.status,
    actorId: actor.userId,
  });

  return updated;
}

export type CampusAdminSummary = {
  id: string;
  name: string;
  email: string;
  isSuspended: boolean;
  createdAt: Date;
};

/** Campus Admins of one campus. Super Admin only. */
export async function listCampusAdmins(
  actor: Actor,
  campusId: string,
): Promise<CampusAdminSummary[]> {
  assertSuperAdmin(actor);

  const admins = await prisma.user.findMany({
    where: { campusId, role: "CAMPUS_ADMIN" },
    select: { id: true, name: true, email: true, suspendedAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return admins.map((admin) => ({
    id: admin.id,
    name: admin.name,
    email: admin.email,
    isSuspended: admin.suspendedAt !== null,
    createdAt: admin.createdAt,
  }));
}

/**
 * Promotes an existing user to Campus Admin of a campus (PRD §9).
 *
 * The user must already have a confirmed email address. Promotion is refused
 * for a Super Admin (a global role must not be downgraded silently) and for a
 * user who already holds a campus-scoped profile, because their existing
 * records belong to a different role.
 */
export async function assignCampusAdmin(
  actor: Actor,
  campusId: string,
  input: AssignCampusAdminInput,
): Promise<CampusAdminSummary> {
  assertSuperAdmin(actor);

  const campus = await prisma.campus.findUnique({
    where: { id: campusId },
    select: { id: true, code: true },
  });
  if (!campus) throw new NotFoundError("Campus not found");

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      campusId: true,
      emailVerified: true,
      suspendedAt: true,
      createdAt: true,
      studentProfile: { select: { id: true } },
    },
  });
  if (!user) {
    throw new NotFoundError("No account exists with that email address. Ask them to register first.");
  }
  if (!user.emailVerified) {
    throw new StateConflictError("That user must confirm their email address first");
  }
  if (user.role === "SUPER_ADMIN") {
    throw new ValidationError("A Super Admin cannot be reassigned as a Campus Admin");
  }
  if (user.role === "CAMPUS_ADMIN" && user.campusId === campusId) {
    throw new ConflictError("That user already administers this campus");
  }
  if (user.studentProfile) {
    throw new ValidationError(
      "That account is already a student on a campus. Use a separate account for administration.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.user.update({
      where: { id: user.id },
      data: { role: "CAMPUS_ADMIN", campusId },
      select: { id: true, name: true, email: true, suspendedAt: true, createdAt: true },
    });

    await recordAudit(
      {
        action: AuditAction.CAMPUS_ADMIN_ASSIGNED,
        entityType: "User",
        entityId: user.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        before: { role: user.role, campusId: user.campusId },
        after: { role: "CAMPUS_ADMIN", campusId },
      },
      tx,
    );

    return saved;
  });

  logger.info("Campus admin assigned", {
    userId: updated.id,
    campusId,
    code: campus.code,
    actorId: actor.userId,
  });

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    isSuspended: updated.suspendedAt !== null,
    createdAt: updated.createdAt,
  };
}

/**
 * Updates campus settings (PRD §18, §29, §35, §47).
 *
 * A Campus Admin may configure only their own campus. Commission changes are
 * audited separately from other settings because they alter platform economics.
 * Changes apply to future records only: delivery fees are snapshotted onto the
 * delivery record when it is created (PRD §29).
 */
export async function updateCampusSettings(
  actor: Actor,
  campusId: string,
  input: CampusSettingsInput,
): Promise<CampusSettings> {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "CAMPUS_ADMIN") throw new ForbiddenError();
  assertSameCampus(actor, campusId);

  const before = await prisma.campusSettings.findUnique({ where: { campusId } });
  if (!before) {
    const campus = await prisma.campus.findUnique({ where: { id: campusId }, select: { id: true } });
    if (!campus) throw new NotFoundError("Campus not found");
    await ensureSettings(campusId);
  }

  const current = before ?? (await ensureSettings(campusId));

  const merged = {
    deliveryMinimumFeeKobo: input.deliveryMinimumFeeKobo ?? current.deliveryMinimumFeeKobo,
    deliveryMaximumFeeKobo: input.deliveryMaximumFeeKobo ?? current.deliveryMaximumFeeKobo,
  };
  assertFeeBoundsCoherent(merged);

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.campusSettings.update({
      where: { campusId },
      data: {
        ...(input.allowStudentVendors !== undefined
          ? { allowStudentVendors: input.allowStudentVendors }
          : {}),
        ...(input.requireRegistryMatch !== undefined
          ? { requireRegistryMatch: input.requireRegistryMatch }
          : {}),
        ...(input.deliveryBaseFeeKobo !== undefined
          ? { deliveryBaseFeeKobo: input.deliveryBaseFeeKobo }
          : {}),
        ...(input.deliveryPerKmKobo !== undefined
          ? { deliveryPerKmKobo: input.deliveryPerKmKobo }
          : {}),
        ...(input.deliveryMinimumFeeKobo !== undefined
          ? { deliveryMinimumFeeKobo: input.deliveryMinimumFeeKobo }
          : {}),
        ...(input.deliveryMaximumFeeKobo !== undefined
          ? { deliveryMaximumFeeKobo: input.deliveryMaximumFeeKobo }
          : {}),
        ...(input.commissionBps !== undefined ? { commissionBps: input.commissionBps } : {}),
        ...(input.pickupWindowMinutes !== undefined
          ? { pickupWindowMinutes: input.pickupWindowMinutes }
          : {}),
        ...(input.studentWaitMinutes !== undefined
          ? { studentWaitMinutes: input.studentWaitMinutes }
          : {}),
        ...(input.goodsPaymentWindowMinutes !== undefined
          ? { goodsPaymentWindowMinutes: input.goodsPaymentWindowMinutes }
          : {}),
        ...(input.announcement !== undefined ? { announcement: input.announcement } : {}),
      },
    });

    if (input.commissionBps !== undefined && input.commissionBps !== current.commissionBps) {
      await recordAudit(
        {
          action: AuditAction.COMMISSION_CHANGED,
          entityType: "CampusSettings",
          entityId: updated.id,
          actorId: actor.userId,
          actorRole: actor.role,
          campusId,
          before: { commissionBps: current.commissionBps },
          after: { commissionBps: updated.commissionBps },
        },
        tx,
      );
    }

    const pricingChanged =
      input.deliveryBaseFeeKobo !== undefined ||
      input.deliveryPerKmKobo !== undefined ||
      input.deliveryMinimumFeeKobo !== undefined ||
      input.deliveryMaximumFeeKobo !== undefined;

    if (pricingChanged) {
      await recordAudit(
        {
          action: AuditAction.DELIVERY_PRICING_CHANGED,
          entityType: "CampusSettings",
          entityId: updated.id,
          actorId: actor.userId,
          actorRole: actor.role,
          campusId,
          before: {
            deliveryBaseFeeKobo: current.deliveryBaseFeeKobo,
            deliveryPerKmKobo: current.deliveryPerKmKobo,
            deliveryMinimumFeeKobo: current.deliveryMinimumFeeKobo,
            deliveryMaximumFeeKobo: current.deliveryMaximumFeeKobo,
          },
          after: {
            deliveryBaseFeeKobo: updated.deliveryBaseFeeKobo,
            deliveryPerKmKobo: updated.deliveryPerKmKobo,
            deliveryMinimumFeeKobo: updated.deliveryMinimumFeeKobo,
            deliveryMaximumFeeKobo: updated.deliveryMaximumFeeKobo,
          },
        },
        tx,
      );
    }

    await recordAudit(
      {
        action: AuditAction.CAMPUS_UPDATED,
        entityType: "CampusSettings",
        entityId: updated.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        before: {
          allowStudentVendors: current.allowStudentVendors,
          requireRegistryMatch: current.requireRegistryMatch,
          pickupWindowMinutes: current.pickupWindowMinutes,
          studentWaitMinutes: current.studentWaitMinutes,
          goodsPaymentWindowMinutes: current.goodsPaymentWindowMinutes,
          announcement: current.announcement,
        },
        after: {
          allowStudentVendors: updated.allowStudentVendors,
          requireRegistryMatch: updated.requireRegistryMatch,
          pickupWindowMinutes: updated.pickupWindowMinutes,
          studentWaitMinutes: updated.studentWaitMinutes,
          goodsPaymentWindowMinutes: updated.goodsPaymentWindowMinutes,
          announcement: updated.announcement,
        },
      },
      tx,
    );

    return updated;
  });

  return saved;
}

/**
 * Reads the settings a feature needs. Used by later phases (pricing, vendor
 * eligibility, delivery timers) so those modules never hard-code a default.
 */
export async function getCampusSettings(campusId: string): Promise<CampusSettings> {
  const settings = await prisma.campusSettings.findUnique({ where: { campusId } });
  if (settings) return settings;

  const campus = await prisma.campus.findUnique({ where: { id: campusId }, select: { id: true } });
  if (!campus) throw new NotFoundError("Campus not found");
  return ensureSettings(campusId);
}

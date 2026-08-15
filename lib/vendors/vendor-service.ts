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
import type { DocumentType, VerificationStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import {
  assertValidDocument,
  getDocumentStorage,
  type StoredObject,
} from "@/lib/storage/storage";
import {
  defaultOperatingHours,
  isWithinOperatingHours,
  type OperatingHoursDay,
} from "@/lib/vendors/operating-hours";
import { slugifyStoreName } from "@/validations/vendor";
import type {
  OperatingHoursInput,
  VendorApplicationInput,
  VendorReviewInput,
  VendorStatusInput,
  VendorStoreUpdateInput,
} from "@/validations/vendor";

/**
 * Vendor business logic (PRD §17–19, §23, Phase 3).
 *
 * Campus always comes from the authenticated actor, status transitions are
 * checked against the stored state, and only APPROVED vendors are visible to
 * students. A vendor can never approve itself or change another vendor's store
 * (PRD §6).
 */

/** Statuses from which a vendor may (re)submit an application. */
const SUBMITTABLE_STATUSES: readonly VerificationStatus[] = [
  "INCOMPLETE",
  "CORRECTION_REQUESTED",
  "REJECTED",
];

const VENDOR_DOCUMENT_TYPES: readonly DocumentType[] = ["VENDOR_STOREFRONT", "VENDOR_IDENTITY"];

export type VendorStoreState = {
  status: VerificationStatus | "NO_APPLICATION";
  id: string | null;
  storeName: string | null;
  slug: string | null;
  description: string | null;
  phone: string | null;
  storefrontLocation: string | null
  latitude: number | null;
  longitude: number | null;
  studentVendor: boolean;
  acceptingOrders: boolean;
  isOpenNow: boolean;
  reviewNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  operatingHours: OperatingHoursDay[];
  documents: { id: string; type: DocumentType; createdAt: Date }[];
  /** Whether this campus currently allows students to apply (PRD §18). */
  studentVendorsAllowed: boolean;
};

/**
 * The vendor's own view of their application and store.
 *
 * Also used before an application exists, so the apply screen can tell a
 * student whether their campus permits student vendors at all.
 */
export async function getVendorState(actor: Actor): Promise<VendorStoreState> {
  const campusId = actor.campusId;
  if (!campusId) throw new ForbiddenError("Your account is not associated with a campus");

  const [profile, campus] = await Promise.all([
    prisma.vendorProfile.findUnique({
      where: { userId: actor.userId },
      include: {
        operatingHours: { orderBy: { dayOfWeek: "asc" } },
        documents: {
          select: { id: true, type: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.campus.findUnique({
      where: { id: campusId },
      select: { timezone: true, settings: { select: { allowStudentVendors: true } } },
    }),
  ]);

  const studentVendorsAllowed = campus?.settings?.allowStudentVendors ?? false;

  if (!profile) {
    return {
      status: "NO_APPLICATION",
      id: null,
      storeName: null,
      slug: null,
      description: null,
      phone: null,
      storefrontLocation: null,
      latitude: null,
      longitude: null,
      studentVendor: false,
      acceptingOrders: false,
      isOpenNow: false,
      reviewNote: null,
      submittedAt: null,
      reviewedAt: null,
      operatingHours: [],
      documents: [],
      studentVendorsAllowed,
    };
  }

  const hours: OperatingHoursDay[] = profile.operatingHours.map((day) => ({
    dayOfWeek: day.dayOfWeek,
    isClosed: day.isClosed,
    opensAt: day.opensAt,
    closesAt: day.closesAt,
  }));

  return {
    status: profile.status,
    id: profile.id,
    storeName: profile.storeName,
    slug: profile.slug,
    description: profile.description,
    phone: profile.phone,
    storefrontLocation: profile.storefrontLocation,
    latitude: profile.latitude,
    longitude: profile.longitude,
    studentVendor: profile.studentVendor,
    acceptingOrders: profile.acceptingOrders,
    isOpenNow:
      profile.status === "APPROVED" &&
      profile.acceptingOrders &&
      isWithinOperatingHours(hours, new Date(), campus?.timezone ?? "Africa/Lagos"),
    reviewNote: profile.reviewNote,
    submittedAt: profile.submittedAt,
    reviewedAt: profile.reviewedAt,
    operatingHours: hours,
    documents: profile.documents,
    studentVendorsAllowed,
  };
}

/**
 * Resolves the actor's own approved vendor profile.
 *
 * Ownership is proved by the profile's userId rather than by the account's
 * role, because a student vendor keeps the STUDENT role (see
 * `reviewVendorApplication`). This is also the stricter check: it confirms the
 * store exists, belongs to this user, is approved, and sits on their campus.
 */
export async function requireApprovedVendor(
  actor: Actor,
): Promise<{ id: string; campusId: string; storeName: string }> {
  if (!actor.campusId) throw new ForbiddenError("Your account is not associated with a campus");

  const profile = await prisma.vendorProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, campusId: true, storeName: true, status: true },
  });
  if (!profile) throw new ForbiddenError("You do not have a vendor store");

  assertSameCampus(actor, profile.campusId);

  if (profile.status !== "APPROVED") {
    throw new StateConflictError(
      profile.status === "SUSPENDED"
        ? "Your store is suspended. Contact your campus admin."
        : "Your store has not been approved yet",
    );
  }

  return { id: profile.id, campusId: profile.campusId, storeName: profile.storeName };
}

/** Stores a private vendor document (storefront evidence or identity). */
export async function uploadVendorDocument(
  actor: Actor,
  input: { type: DocumentType; filename: string; mimeType: string; bytes: Uint8Array },
): Promise<{ id: string; type: DocumentType }> {
  const campusId = actor.campusId;
  if (!campusId) throw new ForbiddenError("Your account is not associated with a campus");
  if (!actor.emailVerified) {
    throw new StateConflictError("Verify your email address before uploading documents");
  }
  if (!VENDOR_DOCUMENT_TYPES.includes(input.type)) {
    throw new ValidationError("Unsupported document type for vendor onboarding");
  }

  assertValidDocument(input.mimeType, input.bytes);

  const existing = await prisma.vendorProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, status: true },
  });
  if (existing && !SUBMITTABLE_STATUSES.includes(existing.status)) {
    throw new StateConflictError("Your application has already been submitted for review");
  }

  const stored: StoredObject = await getDocumentStorage().put({
    prefix: `campus/${campusId}/vendors/${actor.userId}`,
    filename: input.filename,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  const document = await prisma.onboardingDocument.create({
    data: {
      type: input.type,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      campusId,
      uploadedById: actor.userId,
      vendorProfileId: existing?.id ?? null,
    },
    select: { id: true, type: true },
  });

  logger.info("Vendor document stored", {
    documentId: document.id,
    type: document.type,
    userId: actor.userId,
    campusId,
  });

  return document;
}

/**
 * Creates or resubmits a vendor application and moves it to
 * PENDING_VERIFICATION (PRD §17).
 *
 * Student eligibility is decided here, at submission time, and the outcome is
 * stored on the row: if the campus later stops allowing student vendors, that
 * must not silently invalidate a vendor who was legitimately approved.
 */
export async function submitVendorApplication(
  actor: Actor,
  input: VendorApplicationInput,
): Promise<{ id: string; status: VerificationStatus }> {
  const campusId = actor.campusId;
  if (!campusId) throw new ForbiddenError("Your account is not associated with a campus");
  if (!actor.emailVerified) {
    throw new StateConflictError("Verify your email address before applying");
  }
  if (actor.role === "CAMPUS_ADMIN" || actor.role === "SUPER_ADMIN") {
    // An administrator reviewing their own store would be their own approver.
    throw new ForbiddenError("Administrators cannot operate a store");
  }

  const campus = await prisma.campus.findUnique({
    where: { id: campusId },
    select: { status: true, settings: { select: { allowStudentVendors: true } } },
  });
  if (!campus) throw new NotFoundError("Campus not found");
  if (campus.status !== "ACTIVE") {
    throw new StateConflictError("This campus is not currently active");
  }

  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId: actor.userId },
    select: { status: true },
  });

  if (studentProfile) {
    if (!campus.settings?.allowStudentVendors) {
      throw new ForbiddenError("This campus does not currently allow students to open stores");
    }
    if (studentProfile.status !== "APPROVED") {
      throw new StateConflictError(
        "Your student verification must be approved before you can open a store",
      );
    }
  }

  const existing = await prisma.vendorProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, status: true },
  });
  if (existing && !SUBMITTABLE_STATUSES.includes(existing.status)) {
    throw new StateConflictError(
      existing.status === "APPROVED"
        ? "Your store is already approved"
        : "Your application is already under review",
    );
  }

  // Documents must belong to this user, this campus and be of the right type.
  const documents = await prisma.onboardingDocument.findMany({
    where: {
      id: { in: [input.storefrontDocumentId, input.identityDocumentId] },
      uploadedById: actor.userId,
      campusId,
    },
    select: { id: true, type: true },
  });
  const storefront = documents.find(
    (document) => document.id === input.storefrontDocumentId && document.type === "VENDOR_STOREFRONT",
  );
  const identity = documents.find(
    (document) => document.id === input.identityDocumentId && document.type === "VENDOR_IDENTITY",
  );
  if (!storefront) throw new ValidationError("Upload a photograph of your storefront");
  if (!identity) throw new ValidationError("Upload an identity or business document");

  const slug = slugifyStoreName(input.storeName);

  const clash = await prisma.vendorProfile.findFirst({
    where: { campusId, slug, userId: { not: actor.userId } },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError("Another store on this campus already uses that name");
  }

  const submittedAt = new Date();

  const saved = await prisma.$transaction(async (tx) => {
    const profile = await tx.vendorProfile.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        campusId,
        storeName: input.storeName,
        slug,
        description: input.description ?? null,
        phone: input.phone,
        storefrontLocation: input.storefrontLocation,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        status: "PENDING_VERIFICATION",
        studentVendor: studentProfile !== null,
        acceptingOrders: false,
        submittedAt,
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
        operatingHours: {
          create: defaultOperatingHours().map((day) => ({
            dayOfWeek: day.dayOfWeek,
            isClosed: day.isClosed,
            opensAt: day.opensAt,
            closesAt: day.closesAt,
          })),
        },
      },
      update: {
        storeName: input.storeName,
        slug,
        description: input.description ?? null,
        phone: input.phone,
        storefrontLocation: input.storefrontLocation,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        status: "PENDING_VERIFICATION",
        studentVendor: studentProfile !== null,
        submittedAt,
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
      },
      select: { id: true, status: true },
    });

    await tx.onboardingDocument.updateMany({
      where: { id: { in: [storefront.id, identity.id] }, uploadedById: actor.userId },
      data: { vendorProfileId: profile.id },
    });

    await recordAudit(
      {
        action: AuditAction.VENDOR_APPLIED,
        entityType: "VendorProfile",
        entityId: profile.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId,
        after: { storeName: input.storeName, slug, studentVendor: studentProfile !== null },
      },
      tx,
    );

    return profile;
  });

  logger.info("Vendor application submitted", {
    vendorProfileId: saved.id,
    userId: actor.userId,
    campusId,
  });

  return saved;
}

/** Updates the vendor's own store details. */
export async function updateVendorStore(
  actor: Actor,
  input: VendorStoreUpdateInput,
): Promise<{ id: string; storeName: string; slug: string }> {
  const vendor = await requireApprovedVendor(actor);

  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.storefrontLocation !== undefined) data.storefrontLocation = input.storefrontLocation;
  if (input.latitude !== undefined) data.latitude = input.latitude;
  if (input.longitude !== undefined) data.longitude = input.longitude;

  if (input.storeName !== undefined) {
    const slug = slugifyStoreName(input.storeName);
    const clash = await prisma.vendorProfile.findFirst({
      where: { campusId: vendor.campusId, slug, id: { not: vendor.id } },
      select: { id: true },
    });
    if (clash) throw new ConflictError("Another store on this campus already uses that name");

    data.storeName = input.storeName;
    data.slug = slug;
  }

  const before = await prisma.vendorProfile.findUniqueOrThrow({
    where: { id: vendor.id },
    select: { storeName: true, description: true, phone: true, storefrontLocation: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.vendorProfile.update({
      where: { id: vendor.id },
      data,
      select: { id: true, storeName: true, slug: true },
    });

    await recordAudit(
      {
        action: AuditAction.VENDOR_STORE_UPDATED,
        entityType: "VendorProfile",
        entityId: vendor.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: vendor.campusId,
        before,
        after: data,
      },
      tx,
    );

    return saved;
  });

  return updated;
}

/** Replaces the weekly schedule (PRD §23). */
export async function setVendorOperatingHours(
  actor: Actor,
  input: OperatingHoursInput,
): Promise<OperatingHoursDay[]> {
  const vendor = await requireApprovedVendor(actor);

  const days = await prisma.$transaction(async (tx) => {
    await tx.vendorOperatingHours.deleteMany({ where: { vendorProfileId: vendor.id } });
    await tx.vendorOperatingHours.createMany({
      data: input.days.map((day) => ({
        vendorProfileId: vendor.id,
        dayOfWeek: day.dayOfWeek,
        isClosed: day.isClosed,
        opensAt: day.isClosed ? null : (day.opensAt ?? null),
        closesAt: day.isClosed ? null : (day.closesAt ?? null),
      })),
    });

    await recordAudit(
      {
        action: AuditAction.VENDOR_HOURS_UPDATED,
        entityType: "VendorProfile",
        entityId: vendor.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: vendor.campusId,
        after: { days: input.days },
      },
      tx,
    );

    return tx.vendorOperatingHours.findMany({
      where: { vendorProfileId: vendor.id },
      orderBy: { dayOfWeek: "asc" },
      select: { dayOfWeek: true, isClosed: true, opensAt: true, closesAt: true },
    });
  });

  return days;
}

/** The vendor's manual switch for incoming orders (PRD §23). */
export async function setVendorAcceptingOrders(
  actor: Actor,
  acceptingOrders: boolean,
): Promise<{ acceptingOrders: boolean }> {
  const vendor = await requireApprovedVendor(actor);

  const updated = await prisma.vendorProfile.update({
    where: { id: vendor.id },
    data: { acceptingOrders },
    select: { acceptingOrders: true },
  });

  return updated;
}

export type VendorApplicationSummary = {
  id: string;
  storeName: string;
  ownerName: string;
  ownerEmail: string;
  phone: string;
  storefrontLocation: string;
  description: string | null;
  status: VerificationStatus;
  studentVendor: boolean;
  submittedAt: Date | null;
  documents: { id: string; type: DocumentType }[];
};

/** Campus Admin review queue, scoped to the admin's own campus. */
export async function listVendorsForReview(
  actor: Actor,
  options?: { status?: VerificationStatus; campusId?: string; take?: number; skip?: number },
): Promise<VendorApplicationSummary[]> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError();

  const campusId = actor.role === "SUPER_ADMIN" ? options?.campusId : actor.campusId;
  if (!campusId) throw new ValidationError("A campus must be specified");
  assertSameCampus(actor, campusId);

  const profiles = await prisma.vendorProfile.findMany({
    where: { campusId, status: options?.status ?? "PENDING_VERIFICATION" },
    orderBy: { submittedAt: "asc" },
    take: Math.min(options?.take ?? 50, 100),
    skip: options?.skip ?? 0,
    include: {
      user: { select: { name: true, email: true } },
      documents: { select: { id: true, type: true } },
    },
  });

  return profiles.map((profile) => ({
    id: profile.id,
    storeName: profile.storeName,
    ownerName: profile.user.name,
    ownerEmail: profile.user.email,
    phone: profile.phone,
    storefrontLocation: profile.storefrontLocation,
    description: profile.description,
    status: profile.status,
    studentVendor: profile.studentVendor,
    submittedAt: profile.submittedAt,
    documents: profile.documents,
  }));
}

const DECISION_STATUS: Record<VendorReviewInput["decision"], VerificationStatus> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  REQUEST_CORRECTION: "CORRECTION_REQUESTED",
};

const DECISION_AUDIT_ACTION: Record<VendorReviewInput["decision"], string> = {
  APPROVE: AuditAction.VENDOR_APPROVED,
  REJECT: AuditAction.VENDOR_REJECTED,
  REQUEST_CORRECTION: AuditAction.VENDOR_CORRECTION_REQUESTED,
};

/**
 * Approve, reject or request a correction on a vendor application (PRD §17).
 *
 * On approval the account's role is promoted to VENDOR only when it has no
 * student profile. A student vendor keeps the STUDENT role, because they remain
 * a student who buys and is subject to student verification; vendor
 * authorization is derived from the approved store instead (see
 * `requireApprovedVendor`).
 *
 * Approval deliberately leaves `acceptingOrders` false: the vendor decides when
 * to open, and nothing can be ordered before they have products anyway.
 */
export async function reviewVendorApplication(
  actor: Actor,
  vendorProfileId: string,
  input: VendorReviewInput,
): Promise<{ id: string; status: VerificationStatus }> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError();

  const profile = await prisma.vendorProfile.findUnique({
    where: { id: vendorProfileId },
    select: {
      id: true,
      campusId: true,
      status: true,
      userId: true,
      studentVendor: true,
      user: { select: { role: true } },
    },
  });
  if (!profile) throw new NotFoundError("Vendor application not found");

  assertSameCampus(actor, profile.campusId);

  if (profile.status !== "PENDING_VERIFICATION") {
    throw new StateConflictError(
      `This application is ${profile.status.toLowerCase().replace(/_/g, " ")} and cannot be reviewed again`,
    );
  }

  const nextStatus = DECISION_STATUS[input.decision];
  const promoteRole =
    nextStatus === "APPROVED" && !profile.studentVendor && profile.user.role === "STUDENT";

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.vendorProfile.update({
      where: { id: profile.id },
      data: {
        status: nextStatus,
        reviewNote: input.note ?? null,
        reviewedAt: new Date(),
        reviewedById: actor.userId,
      },
      select: { id: true, status: true },
    });

    if (promoteRole) {
      await tx.user.update({ where: { id: profile.userId }, data: { role: "VENDOR" } });
    }

    await recordAudit(
      {
        action: DECISION_AUDIT_ACTION[input.decision],
        entityType: "VendorProfile",
        entityId: profile.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: profile.campusId,
        before: { status: profile.status, role: profile.user.role },
        after: {
          status: saved.status,
          note: input.note ?? null,
          role: promoteRole ? "VENDOR" : profile.user.role,
        },
      },
      tx,
    );

    return saved;
  });

  logger.info("Vendor application reviewed", {
    vendorProfileId: profile.id,
    decision: input.decision,
    reviewerId: actor.userId,
    campusId: profile.campusId,
  });

  return updated;
}

/**
 * Suspends or reinstates an approved vendor (PRD §8).
 *
 * Suspension also clears `acceptingOrders`, so that a reinstated store cannot
 * silently start taking orders again before its owner is ready.
 */
export async function setVendorStatus(
  actor: Actor,
  vendorProfileId: string,
  input: VendorStatusInput,
): Promise<{ id: string; status: VerificationStatus }> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError();

  const profile = await prisma.vendorProfile.findUnique({
    where: { id: vendorProfileId },
    select: { id: true, campusId: true, status: true },
  });
  if (!profile) throw new NotFoundError("Vendor not found");

  assertSameCampus(actor, profile.campusId);

  if (input.action === "SUSPEND" && profile.status !== "APPROVED") {
    throw new StateConflictError("Only an approved vendor can be suspended");
  }
  if (input.action === "REINSTATE" && profile.status !== "SUSPENDED") {
    throw new StateConflictError("Only a suspended vendor can be reinstated");
  }

  const nextStatus: VerificationStatus = input.action === "SUSPEND" ? "SUSPENDED" : "APPROVED";

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.vendorProfile.update({
      where: { id: profile.id },
      data: {
        status: nextStatus,
        acceptingOrders: false,
        reviewNote: input.reason ?? null,
        reviewedAt: new Date(),
        reviewedById: actor.userId,
      },
      select: { id: true, status: true },
    });

    await recordAudit(
      {
        action:
          input.action === "SUSPEND" ? AuditAction.VENDOR_SUSPENDED : AuditAction.VENDOR_REINSTATED,
        entityType: "VendorProfile",
        entityId: profile.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: profile.campusId,
        before: { status: profile.status },
        after: { status: saved.status, reason: input.reason ?? null },
      },
      tx,
    );

    return saved;
  });

  logger.info("Vendor status changed", {
    vendorProfileId: profile.id,
    action: input.action,
    actorId: actor.userId,
    campusId: profile.campusId,
  });

  return updated;
}

export type StorefrontSummary = {
  id: string;
  storeName: string;
  slug: string;
  description: string | null;
  storefrontLocation: string;
  isOpenNow: boolean;
  acceptingOrders: boolean;
};

/**
 * Approved storefronts on the actor's campus (Phase 3 acceptance; the full
 * marketplace arrives in Phase 4).
 *
 * The status filter and the campus filter are both applied in the query, so a
 * rejected, pending or suspended vendor is not merely hidden by the UI — it is
 * never returned (Rule 25, Rule 29).
 */
export async function listStorefronts(
  actor: Actor,
  options?: { campusId?: string },
): Promise<StorefrontSummary[]> {
  const campusId = actor.role === "SUPER_ADMIN" ? options?.campusId : actor.campusId;
  if (!campusId) throw new ValidationError("A campus must be specified");
  assertSameCampus(actor, campusId);

  const campus = await prisma.campus.findUnique({
    where: { id: campusId },
    select: { timezone: true },
  });

  const vendors = await prisma.vendorProfile.findMany({
    where: { campusId, status: "APPROVED" },
    orderBy: { storeName: "asc" },
    include: {
      operatingHours: {
        select: { dayOfWeek: true, isClosed: true, opensAt: true, closesAt: true },
      },
    },
  });

  const now = new Date();
  const timezone = campus?.timezone ?? "Africa/Lagos";

  return vendors.map((vendor) => ({
    id: vendor.id,
    storeName: vendor.storeName,
    slug: vendor.slug,
    description: vendor.description,
    storefrontLocation: vendor.storefrontLocation,
    acceptingOrders: vendor.acceptingOrders,
    isOpenNow:
      vendor.acceptingOrders && isWithinOperatingHours(vendor.operatingHours, now, timezone),
  }));
}

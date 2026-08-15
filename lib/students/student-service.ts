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
import { logger } from "@/lib/logger";
import {
  assertValidDocument,
  getDocumentStorage,
  type StoredObject,
} from "@/lib/storage/storage";
import { parseRegistryCsv, type RegistryParseResult } from "@/lib/students/registry-csv";
import type { DocumentType, VerificationStatus } from "@/lib/generated/prisma/enums";
import type {
  RegistryRow,
  StudentProfileSubmissionInput,
  StudentReviewInput,
} from "@/validations/student";

/**
 * Student onboarding business logic (PRD §13–16, Phase 1).
 *
 * Every function here is server-authoritative: campus comes from the
 * authenticated actor, status transitions are validated against the current
 * state, and duplicate protection relies on database constraints rather than
 * pre-checks alone.
 */

/** Statuses from which a student may (re)submit their details. */
const SUBMITTABLE_STATUSES: readonly VerificationStatus[] = [
  "INCOMPLETE",
  "CORRECTION_REQUESTED",
  "REJECTED",
];

const STUDENT_DOCUMENT_TYPES: readonly DocumentType[] = [
  "STUDENT_PASSPORT_PHOTO",
  "STUDENT_ID_CARD",
];

export type StudentOnboardingState = {
  status: VerificationStatus | "NO_PROFILE";
  emailVerified: boolean;
  campusId: string | null;
  matricNumber: string | null;
  studentIdNumber: string | null;
  department: string | null;
  level: string | null;
  reviewNote: string | null;
  registryMatched: boolean;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  documents: { id: string; type: DocumentType; createdAt: Date }[];
};

/** The student's own view of their onboarding progress. */
export async function getOnboardingState(actor: Actor): Promise<StudentOnboardingState> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: actor.userId },
    include: {
      documents: {
        select: { id: true, type: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!profile) {
    return {
      status: "NO_PROFILE",
      emailVerified: actor.emailVerified,
      campusId: actor.campusId,
      matricNumber: null,
      studentIdNumber: null,
      department: null,
      level: null,
      reviewNote: null,
      registryMatched: false,
      submittedAt: null,
      reviewedAt: null,
      documents: [],
    };
  }

  return {
    status: profile.status,
    emailVerified: actor.emailVerified,
    campusId: profile.campusId,
    matricNumber: profile.matricNumber,
    studentIdNumber: profile.studentIdNumber,
    department: profile.department,
    level: profile.level,
    reviewNote: profile.reviewNote,
    registryMatched: profile.registryMatched,
    submittedAt: profile.submittedAt,
    reviewedAt: profile.reviewedAt,
    documents: profile.documents,
  };
}

/** True when the student may transact on the marketplace. */
export async function isVerifiedStudent(actor: Actor): Promise<boolean> {
  if (actor.role !== "STUDENT" || !actor.campusId || actor.isSuspended) return false;
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: actor.userId },
    select: { status: true, campusId: true },
  });
  return profile?.status === "APPROVED" && profile.campusId === actor.campusId;
}

/**
 * Stores an onboarding document privately and records its metadata.
 *
 * Documents are uploaded before submission and linked to the profile when the
 * student submits, so an abandoned upload never produces a half-created profile.
 */
export async function uploadStudentDocument(
  actor: Actor,
  input: { type: DocumentType; filename: string; mimeType: string; bytes: Uint8Array },
): Promise<{ id: string; type: DocumentType }> {
  if (actor.role !== "STUDENT") throw new ForbiddenError();
  if (!actor.campusId) throw new ForbiddenError("Your account is not associated with a campus");
  if (!actor.emailVerified) {
    throw new StateConflictError("Verify your email address before uploading documents");
  }
  if (!STUDENT_DOCUMENT_TYPES.includes(input.type)) {
    throw new ValidationError("Unsupported document type for student onboarding");
  }

  assertValidDocument(input.mimeType, input.bytes);

  const stored: StoredObject = await getDocumentStorage().put({
    prefix: `campus/${actor.campusId}/students/${actor.userId}`,
    filename: input.filename,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, status: true },
  });

  if (profile && !SUBMITTABLE_STATUSES.includes(profile.status)) {
    throw new StateConflictError("Your documents have already been submitted for review");
  }

  const document = await prisma.onboardingDocument.create({
    data: {
      type: input.type,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      campusId: actor.campusId,
      uploadedById: actor.userId,
      studentProfileId: profile?.id ?? null,
    },
    select: { id: true, type: true },
  });

  logger.info("Onboarding document stored", {
    documentId: document.id,
    type: document.type,
    userId: actor.userId,
    campusId: actor.campusId,
  });

  return document;
}

/**
 * Creates or updates the student's profile and moves it to
 * PENDING_VERIFICATION. Uniqueness of matric/ID number per campus is enforced
 * by the database; the pre-check exists only to give a friendlier message.
 */
export async function submitStudentProfile(
  actor: Actor,
  input: StudentProfileSubmissionInput,
): Promise<{ id: string; status: VerificationStatus; registryMatched: boolean }> {
  if (actor.role !== "STUDENT") throw new ForbiddenError();
  const campusId = actor.campusId;
  if (!campusId) throw new ForbiddenError("Your account is not associated with a campus");
  if (!actor.emailVerified) {
    throw new StateConflictError("Verify your email address before submitting your details");
  }

  const existing = await prisma.studentProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, status: true },
  });

  if (existing && !SUBMITTABLE_STATUSES.includes(existing.status)) {
    throw new StateConflictError(
      existing.status === "APPROVED"
        ? "Your account has already been verified"
        : "Your submission is already under review",
    );
  }

  // Documents must belong to this user, this campus, and be of the right type.
  const documents = await prisma.onboardingDocument.findMany({
    where: {
      id: { in: [input.passportDocumentId, input.studentIdDocumentId] },
      uploadedById: actor.userId,
      campusId,
    },
    select: { id: true, type: true },
  });

  const passport = documents.find(
    (document) => document.id === input.passportDocumentId && document.type === "STUDENT_PASSPORT_PHOTO",
  );
  const idCard = documents.find(
    (document) => document.id === input.studentIdDocumentId && document.type === "STUDENT_ID_CARD",
  );
  if (!passport) throw new ValidationError("Upload your passport photograph");
  if (!idCard) throw new ValidationError("Upload your student ID card");

  const clash = await prisma.studentProfile.findFirst({
    where: {
      campusId,
      userId: { not: actor.userId },
      OR: [
        { matricNumber: input.matricNumber },
        ...(input.studentIdNumber ? [{ studentIdNumber: input.studentIdNumber }] : []),
      ],
    },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      "Those student details are already registered on this campus. Contact your campus admin if this is a mistake.",
    );
  }

  const registryEntry = await prisma.studentRegistryEntry.findUnique({
    where: { campusId_matricNumber: { campusId, matricNumber: input.matricNumber } },
    select: { id: true },
  });

  const submittedAt = new Date();

  const profile = await prisma.$transaction(async (tx) => {
    const saved = await tx.studentProfile.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        campusId,
        matricNumber: input.matricNumber,
        studentIdNumber: input.studentIdNumber ?? null,
        department: input.department ?? null,
        level: input.level ?? null,
        status: "PENDING_VERIFICATION",
        registryMatched: registryEntry !== null,
        submittedAt,
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
      },
      update: {
        matricNumber: input.matricNumber,
        studentIdNumber: input.studentIdNumber ?? null,
        department: input.department ?? null,
        level: input.level ?? null,
        status: "PENDING_VERIFICATION",
        registryMatched: registryEntry !== null,
        submittedAt,
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
      },
      select: { id: true, status: true, registryMatched: true },
    });

    // Attach the submitted documents to the profile.
    await tx.onboardingDocument.updateMany({
      where: { id: { in: [passport.id, idCard.id] }, uploadedById: actor.userId },
      data: { studentProfileId: saved.id },
    });

    if (input.phone) {
      await tx.user.update({ where: { id: actor.userId }, data: { phone: input.phone } });
    }

    return saved;
  });

  logger.info("Student profile submitted for verification", {
    studentProfileId: profile.id,
    userId: actor.userId,
    campusId,
    registryMatched: profile.registryMatched,
  });

  return profile;
}

export type PendingStudentSummary = {
  id: string;
  name: string;
  email: string;
  matricNumber: string;
  studentIdNumber: string | null;
  department: string | null;
  level: string | null;
  status: VerificationStatus;
  registryMatched: boolean;
  submittedAt: Date | null;
  documents: { id: string; type: DocumentType }[];
};

/**
 * Campus Admin review queue, always scoped to the admin's own campus. A Super
 * Admin must name the campus explicitly.
 */
export async function listStudentsForReview(
  actor: Actor,
  options?: { status?: VerificationStatus; campusId?: string; take?: number; skip?: number },
): Promise<PendingStudentSummary[]> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError();

  const campusId = actor.role === "SUPER_ADMIN" ? options?.campusId : actor.campusId;
  if (!campusId) {
    throw new ValidationError("A campus must be specified");
  }
  assertSameCampus(actor, campusId);

  const profiles = await prisma.studentProfile.findMany({
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
    name: profile.user.name,
    email: profile.user.email,
    matricNumber: profile.matricNumber,
    studentIdNumber: profile.studentIdNumber,
    department: profile.department,
    level: profile.level,
    status: profile.status,
    registryMatched: profile.registryMatched,
    submittedAt: profile.submittedAt,
    documents: profile.documents,
  }));
}

const DECISION_STATUS: Record<StudentReviewInput["decision"], VerificationStatus> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  REQUEST_CORRECTION: "CORRECTION_REQUESTED",
};

const DECISION_AUDIT_ACTION: Record<StudentReviewInput["decision"], string> = {
  APPROVE: AuditAction.STUDENT_VERIFIED,
  REJECT: AuditAction.STUDENT_REJECTED,
  REQUEST_CORRECTION: AuditAction.STUDENT_CORRECTION_REQUESTED,
};

/** Approve, reject or request a correction on a student submission. */
export async function reviewStudentProfile(
  actor: Actor,
  studentProfileId: string,
  input: StudentReviewInput,
): Promise<{ id: string; status: VerificationStatus }> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError();

  const profile = await prisma.studentProfile.findUnique({
    where: { id: studentProfileId },
    select: { id: true, campusId: true, status: true, userId: true },
  });
  if (!profile) throw new NotFoundError("Student submission not found");

  assertSameCampus(actor, profile.campusId);

  if (profile.status !== "PENDING_VERIFICATION") {
    throw new StateConflictError(
      `This submission is ${profile.status.toLowerCase().replace(/_/g, " ")} and cannot be reviewed again`,
    );
  }

  const nextStatus = DECISION_STATUS[input.decision];

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.studentProfile.update({
      where: { id: profile.id },
      data: {
        status: nextStatus,
        reviewNote: input.note ?? null,
        reviewedAt: new Date(),
        reviewedById: actor.userId,
      },
      select: { id: true, status: true },
    });

    await recordAudit(
      {
        action: DECISION_AUDIT_ACTION[input.decision],
        entityType: "StudentProfile",
        entityId: profile.id,
        actorId: actor.userId,
        actorRole: actor.role,
        campusId: profile.campusId,
        before: { status: profile.status },
        after: { status: saved.status, note: input.note ?? null },
      },
      tx,
    );

    return saved;
  });

  logger.info("Student submission reviewed", {
    studentProfileId: profile.id,
    decision: input.decision,
    reviewerId: actor.userId,
    campusId: profile.campusId,
  });

  return updated;
}

/**
 * Serves a private onboarding document to an authorised viewer: the owner, a
 * Campus Admin of the document's campus, or a Super Admin (PRD §56).
 */
export async function readOnboardingDocument(
  actor: Actor,
  documentId: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const document = await prisma.onboardingDocument.findUnique({
    where: { id: documentId },
    select: { storageKey: true, mimeType: true, campusId: true, uploadedById: true },
  });
  if (!document) throw new NotFoundError("Document not found");

  const isOwner = document.uploadedById === actor.userId;
  const isReviewer = actor.role === "CAMPUS_ADMIN" || actor.role === "SUPER_ADMIN";
  if (!isOwner && !isReviewer) throw new ForbiddenError();
  if (!isOwner) assertSameCampus(actor, document.campusId);

  const stored = await getDocumentStorage().get(document.storageKey);
  return { bytes: stored.bytes, mimeType: document.mimeType || stored.mimeType };
}

export type RegistryImportResult = RegistryParseResult & {
  created: number;
  updated: number;
};

/**
 * Imports an official student list for a campus. Existing entries are updated
 * rather than duplicated, keyed on (campusId, matricNumber).
 */
export async function importStudentRegistry(
  actor: Actor,
  csv: string,
  options?: { campusId?: string },
): Promise<RegistryImportResult> {
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") throw new ForbiddenError();

  const campusId = actor.role === "SUPER_ADMIN" ? options?.campusId : actor.campusId;
  if (!campusId) throw new ValidationError("A campus must be specified");
  assertSameCampus(actor, campusId);

  const campus = await prisma.campus.findUnique({ where: { id: campusId }, select: { id: true } });
  if (!campus) throw new NotFoundError("Campus not found");

  const parsed = parseRegistryCsv(csv);

  const existing = await prisma.studentRegistryEntry.findMany({
    where: { campusId, matricNumber: { in: parsed.valid.map((row) => row.matricNumber) } },
    select: { matricNumber: true },
  });
  const existingSet = new Set(existing.map((entry) => entry.matricNumber));

  const write = async (row: RegistryRow) =>
    prisma.studentRegistryEntry.upsert({
      where: { campusId_matricNumber: { campusId, matricNumber: row.matricNumber } },
      create: {
        campusId,
        matricNumber: row.matricNumber,
        name: row.name,
        department: row.department ?? null,
        level: row.level ?? null,
        importedById: actor.userId,
      },
      update: {
        name: row.name,
        department: row.department ?? null,
        level: row.level ?? null,
        importedById: actor.userId,
      },
      select: { id: true },
    });

  // Batched to keep transaction sizes reasonable for large registries.
  const BATCH = 200;
  for (let index = 0; index < parsed.valid.length; index += BATCH) {
    const batch = parsed.valid.slice(index, index + BATCH);
    await prisma.$transaction(batch.map((row) => write(row)) as never);
  }

  const created = parsed.valid.filter((row) => !existingSet.has(row.matricNumber)).length;
  const result: RegistryImportResult = {
    ...parsed,
    created,
    updated: parsed.valid.length - created,
  };

  await recordAudit({
    action: AuditAction.STUDENT_REGISTRY_IMPORTED,
    entityType: "StudentRegistryEntry",
    entityId: null,
    actorId: actor.userId,
    actorRole: actor.role,
    campusId,
    after: {
      created: result.created,
      updated: result.updated,
      invalid: result.invalid.length,
      duplicates: result.duplicates.length,
    },
  });

  return result;
}

import { z } from "zod";

/**
 * Student onboarding validation (PRD §13–16).
 *
 * These schemas are the only accepted shape for student input. They also
 * normalise identifiers so that database uniqueness on
 * (campusId, matricNumber) and (campusId, studentIdNumber) cannot be bypassed
 * with case or whitespace variants.
 */

/** Uppercases, trims and collapses internal whitespace. */
export function normaliseIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Matric numbers vary by institution (ABUAD uses e.g. "25/LAW01/001"), so the
 * rule is deliberately permissive in shape but strict in character set.
 */
export const matricNumberSchema = z
  .string()
  .trim()
  .min(3, "Matric number is too short")
  .max(32, "Matric number is too long")
  .transform(normaliseIdentifier)
  .refine((value) => /^[A-Z0-9][A-Z0-9/\-.]*[A-Z0-9]$/.test(value), {
    message: "Matric number may only contain letters, numbers, slashes, dots and hyphens",
  });

export const studentIdNumberSchema = z
  .string()
  .trim()
  .min(3, "Student ID number is too short")
  .max(32, "Student ID number is too long")
  .transform(normaliseIdentifier)
  .refine((value) => /^[A-Z0-9][A-Z0-9/\-.]*[A-Z0-9]$/.test(value), {
    message: "Student ID number contains unsupported characters",
  });

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Enter your full name")
  .max(120, "Name is too long")
  .transform(normaliseName);

/** Nigerian mobile numbers, accepted as 0803… or +234803…, stored as +234…. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .refine((value) => /^(?:\+?234|0)[789]\d{9}$/.test(value), {
    message: "Enter a valid Nigerian phone number",
  })
  .transform((value) => (value.startsWith("0") ? `+234${value.slice(1)}` : `+${value.replace(/^\+/, "")}`));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Password is too long")
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), {
    message: "Include an upper-case letter, a lower-case letter and a number",
  });

/** Registration input. Role is never accepted from the client. */
export const studentSignUpSchema = z.object({
  name: fullNameSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: passwordSchema,
  campusId: z.string().min(1, "Select your campus"),
});
export type StudentSignUpInput = z.infer<typeof studentSignUpSchema>;

/**
 * Onboarding details submitted after email verification. `campusId` is absent
 * on purpose: campus is taken from the authenticated user, never from the body.
 */
export const studentProfileSubmissionSchema = z.object({
  matricNumber: matricNumberSchema,
  studentIdNumber: studentIdNumberSchema.optional(),
  department: z.string().trim().max(120).optional(),
  level: z.string().trim().max(16).optional(),
  phone: phoneSchema.optional(),
  passportDocumentId: z.string().min(1, "Upload your passport photograph"),
  studentIdDocumentId: z.string().min(1, "Upload your student ID card"),
});
export type StudentProfileSubmissionInput = z.infer<typeof studentProfileSubmissionSchema>;

/** Campus Admin review decision. */
export const studentReviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "REQUEST_CORRECTION"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.decision === "APPROVE" || Boolean(value.note), {
    message: "A reason is required when rejecting or requesting a correction",
    path: ["note"],
  });
export type StudentReviewInput = z.infer<typeof studentReviewSchema>;

/** One parsed row of an uploaded student registry CSV. */
export const registryRowSchema = z.object({
  matricNumber: matricNumberSchema,
  name: fullNameSchema,
  department: z.string().trim().max(120).optional(),
  level: z.string().trim().max(16).optional(),
});
export type RegistryRow = z.infer<typeof registryRowSchema>;

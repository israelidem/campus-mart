import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import type { VerificationStatus } from "@/lib/generated/prisma/enums";
import { listStudentsForReview } from "@/lib/students/student-service";

const REVIEWABLE_STATUSES = new Set<VerificationStatus>([
  "PENDING_VERIFICATION",
  "CORRECTION_REQUESTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
]);

/**
 * Student verification queue for admins.
 *
 * A Campus Admin always sees only their own campus; a Super Admin must pass
 * `?campusId=` explicitly (PRD Part D, Rule 25).
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
  const url = new URL(request.url);

  const rawStatus = url.searchParams.get("status");
  const status =
    rawStatus && REVIEWABLE_STATUSES.has(rawStatus as VerificationStatus)
      ? (rawStatus as VerificationStatus)
      : undefined;

  const students = await listStudentsForReview(actor, {
    status,
    campusId: url.searchParams.get("campusId") ?? undefined,
    take: Number(url.searchParams.get("take") ?? 50) || 50,
    skip: Number(url.searchParams.get("skip") ?? 0) || 0,
  });

  return jsonOk({ students });
});

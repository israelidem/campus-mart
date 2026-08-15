import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import type { VerificationStatus } from "@/lib/generated/prisma/enums";
import { listVendorsForReview } from "@/lib/vendors/vendor-service";

const STATUSES = new Set<VerificationStatus>([
  "INCOMPLETE",
  "PENDING_VERIFICATION",
  "CORRECTION_REQUESTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
]);

/**
 * Vendor applications awaiting review (PRD §17).
 *
 * The campus is taken from the admin's session. A Super Admin may pass
 * `campusId` explicitly; anyone else passing it is rejected by
 * `assertSameCampus` in the service layer.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const status =
    rawStatus && STATUSES.has(rawStatus as VerificationStatus)
      ? (rawStatus as VerificationStatus)
      : undefined;

  const vendors = await listVendorsForReview(actor, {
    status,
    campusId: url.searchParams.get("campusId") ?? undefined,
    take: Number(url.searchParams.get("take") ?? 50),
    skip: Number(url.searchParams.get("skip") ?? 0),
  });

  return jsonOk({ vendors });
});

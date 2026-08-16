import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { startDisputeReview } from "@/lib/disputes/dispute-service";

/**
 * An admin picks a case up (PRD §61).
 *
 * Separate from resolving, and worth its own endpoint, because it is the only
 * signal a waiting student gets that a person — not a queue — now has their
 * complaint.
 */
export const POST = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ disputeId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
    const { disputeId } = await context.params;

    return jsonOk(await startDisputeReview(actor, disputeId));
  },
);

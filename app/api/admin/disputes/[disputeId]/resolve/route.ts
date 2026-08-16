import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { resolveDispute } from "@/lib/disputes/dispute-service";
import { disputeResolveSchema } from "@/validations/dispute";

/**
 * An admin closes a case, and moves money if the outcome says so (PRD §62–63).
 *
 * Returns 200 even when the provider refused the refund. That is deliberate: the
 * resolution *did* happen and is recorded, and the response carries
 * `refund.succeeded` plus `refund.failureReason` so the UI can say "resolved, but
 * the refund needs retrying" instead of implying the whole decision was lost.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ disputeId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
    const { disputeId } = await context.params;
    const input = disputeResolveSchema.parse(await request.json());

    return jsonOk(await resolveDispute(actor, disputeId, input));
  },
);

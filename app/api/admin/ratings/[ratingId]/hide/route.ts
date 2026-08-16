import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { hideRating, unhideRating } from "@/lib/ratings/rating-service";
import { ratingHideSchema } from "@/validations/rating";

/**
 * Hiding and restoring a review (PRD §59).
 *
 * POST hides with a required reason; DELETE restores. Two verbs on one resource
 * rather than a `hidden: boolean` field, because each direction has different
 * inputs — hiding needs a justification, restoring needs none — and each moves
 * the subject's aggregate in the opposite direction.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ ratingId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
    const { ratingId } = await context.params;
    const input = ratingHideSchema.parse(await request.json());

    const result = await hideRating(actor, ratingId, input);

    return jsonOk(result);
  },
);

export const DELETE = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ ratingId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
    const { ratingId } = await context.params;

    const result = await unhideRating(actor, ratingId);

    return jsonOk(result);
  },
);

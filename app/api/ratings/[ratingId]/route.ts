import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { updateRating } from "@/lib/ratings/rating-service";
import { ratingUpdateSchema } from "@/validations/rating";

/**
 * Changing a rating you gave, inside the edit window (PRD §58).
 *
 * PATCH rather than PUT: a student may adjust the score, the words, or both, and
 * an absent field means "leave it as it was" rather than "clear it". The window
 * itself is checked in the service against the server clock.
 */
export const PATCH = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ ratingId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { ratingId } = await context.params;
    const input = ratingUpdateSchema.parse(await request.json());

    const rating = await updateRating(actor, ratingId, input);

    return jsonOk({ rating });
  },
);

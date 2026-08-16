import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { listRatingsForModeration } from "@/lib/ratings/rating-service";
import { ratingModerationQuerySchema } from "@/validations/rating";

/**
 * The Campus Admin moderation queue (PRD §59).
 *
 * Separate from the public list because it shows what the public one hides: the
 * rater's identity, the order the review belongs to, and hidden reviews
 * themselves. Role is enforced here and re-asserted in the service, so a route
 * added later cannot accidentally expose it.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
  const url = new URL(request.url);

  const query = ratingModerationQuerySchema.parse({
    state: url.searchParams.get("state") ?? undefined,
    subject: url.searchParams.get("subject") ?? undefined,
    maxScore: url.searchParams.get("maxScore") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  const ratings = await listRatingsForModeration(actor, query);

  return jsonOk({ ratings });
});

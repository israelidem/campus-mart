import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { listRatings } from "@/lib/ratings/rating-service";
import { ratingListQuerySchema } from "@/validations/rating";

/**
 * A store's or an agent's visible reviews (PRD §24).
 *
 * Signed-in only, and scoped to the caller's campus in the query, so one
 * campus's reviews are not readable from another (Rule 3). Hidden reviews are
 * excluded here, which is what makes moderation take effect immediately without
 * destroying the record.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const url = new URL(request.url);

  const query = ratingListQuerySchema.parse({
    vendorProfileId: url.searchParams.get("vendorProfileId") ?? undefined,
    agentProfileId: url.searchParams.get("agentProfileId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  const result = await listRatings(actor, query);

  return jsonOk(result);
});

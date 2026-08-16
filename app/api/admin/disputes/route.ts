import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { listCampusDisputes } from "@/lib/disputes/dispute-service";
import { disputeQueueQuerySchema } from "@/validations/dispute";

/**
 * The admin dispute queue (PRD §61).
 *
 * There is no `campusId` parameter, and that is the point: the scope comes from
 * the actor inside the service, so a Campus Admin cannot widen it by editing a
 * URL (Rule 29). A Super Admin sees every campus because oversight is their job.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
  const url = new URL(request.url);

  const query = disputeQueueQuerySchema.parse({
    state: url.searchParams.get("state") ?? undefined,
    reason: url.searchParams.get("reason") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  return jsonOk({ disputes: await listCampusDisputes(actor, query) });
});

import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { getCampusDashboard } from "@/lib/analytics/analytics-service";
import { requireRole } from "@/lib/auth/session";
import { analyticsDashboardQuerySchema } from "@/validations/analytics";

/**
 * The Campus Admin dashboard (PRD §65–68).
 *
 * A Campus Admin sends no `campusId`; the scope is taken from their session inside
 * the service (Rule 29). A Super Admin may name one campus or omit it to see the
 * whole platform — and if a Campus Admin names someone else's campus, `campusScope`
 * refuses before a single query runs.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
  const url = new URL(request.url);

  const query = analyticsDashboardQuerySchema.parse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    campusId: url.searchParams.get("campusId") ?? undefined,
    topLimit: url.searchParams.get("topLimit") ?? undefined,
  });

  return jsonOk({ dashboard: await getCampusDashboard(actor, query) });
});

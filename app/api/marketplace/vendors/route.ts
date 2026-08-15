import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { listStorefronts } from "@/lib/vendors/vendor-service";

/**
 * Approved storefronts on the caller's campus (Phase 3 acceptance).
 *
 * Both the campus and the APPROVED filter are applied in the query, so a
 * pending, rejected or suspended vendor is never returned — the marketplace
 * cannot leak a store the UI merely forgot to hide (Rule 25).
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const url = new URL(request.url);

  const vendors = await listStorefronts(actor, {
    campusId: url.searchParams.get("campusId") ?? undefined,
  });

  return jsonOk({ vendors });
});

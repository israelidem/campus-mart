import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { searchProducts } from "@/lib/products/marketplace-service";
import { parseMarketplaceQuery } from "@/validations/product";

/**
 * Marketplace search (PRD §24).
 *
 * The campus filter is applied by the service from the session, so no query
 * parameter can widen the result set beyond the caller's campus (Rule 25).
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const query = parseMarketplaceQuery(new URL(request.url).searchParams);

  return jsonOk(await searchProducts(actor, query));
});

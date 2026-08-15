import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { listVendorOrders } from "@/lib/orders/order-service";

/**
 * The approved vendor's own order slices (PRD §27).
 *
 * Only this store's lines are returned — never the rest of the invoice.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const url = new URL(request.url);

  const orders = await listVendorOrders(actor, {
    status: url.searchParams.get("status") ?? undefined,
  });

  return jsonOk({ orders });
});

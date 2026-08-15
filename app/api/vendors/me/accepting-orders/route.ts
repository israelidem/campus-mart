import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { setVendorAcceptingOrders } from "@/lib/vendors/vendor-service";
import { acceptingOrdersSchema } from "@/validations/vendor";

/**
 * The vendor's manual switch for incoming orders (PRD §23).
 *
 * Kept separate from the store-details endpoint because it is toggled often and
 * has an immediate effect on whether students can order.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = acceptingOrdersSchema.parse(await request.json());

  const store = await setVendorAcceptingOrders(actor, input.acceptingOrders);

  return jsonOk({ store });
});

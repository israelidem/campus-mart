import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { listMyDeliveries } from "@/lib/delivery/delivery-service";

/** The agent's own deliveries, live work first. */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  const deliveries = await listMyDeliveries(actor);
  return jsonOk({ deliveries });
});

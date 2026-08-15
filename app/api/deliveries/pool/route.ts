import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { listPool } from "@/lib/delivery/delivery-service";

/**
 * The campus delivery pool as this agent may see it (PRD §39, §43).
 *
 * Approval, duty state, campus and destination lock are all decided server-side;
 * the client sends nothing but its session.
 */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  const deliveries = await listPool(actor);
  return jsonOk({ deliveries });
});

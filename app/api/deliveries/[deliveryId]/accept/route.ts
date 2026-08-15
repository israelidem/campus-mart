import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { acceptDelivery } from "@/lib/delivery/delivery-service";

/**
 * Claim a delivery from the pool (PRD §40).
 *
 * Several agents may call this for the same delivery at the same moment; the
 * service resolves it with one conditional update, so exactly one wins and the
 * rest receive a conflict.
 */
export const POST = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;

    const delivery = await acceptDelivery(actor, deliveryId);

    return jsonOk({ delivery });
  },
);

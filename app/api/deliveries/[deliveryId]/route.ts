import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { progressDelivery } from "@/lib/delivery/delivery-service";
import { deliveryProgressSchema } from "@/validations/delivery";

/**
 * Move a delivery the caller is carrying one step forward.
 *
 * The client names the step it believes comes next; the service decides whether
 * that step is legal from the delivery's current state and whether the pickup
 * window is still open (PRD §37, §41).
 */
export const PATCH = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;
    const input = deliveryProgressSchema.parse(await request.json());

    const delivery = await progressDelivery(actor, deliveryId, input);

    return jsonOk({ delivery });
  },
);

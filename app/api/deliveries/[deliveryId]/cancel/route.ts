import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { cancelByAgent } from "@/lib/delivery/delivery-service";
import { deliveryCancelSchema } from "@/validations/delivery";

/**
 * Give up an accepted delivery, returning it to the pool (PRD §42).
 *
 * The response carries the escalation the cancellation triggered so the agent is
 * told plainly when they have been warned or flagged for review.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;
    const input = deliveryCancelSchema.parse(await request.json());

    const result = await cancelByAgent(actor, deliveryId, input);

    return jsonOk(result);
  },
);

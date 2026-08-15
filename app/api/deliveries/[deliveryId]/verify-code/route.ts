import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { verifyHandoverCode } from "@/lib/delivery/delivery-service";
import { handoverVerifySchema } from "@/validations/delivery";

/**
 * The agent submits the code the student showed them (PRD §45–46).
 *
 * A correct code hands the package over and starts the campus's goods-payment
 * window. Wrong codes are counted server-side and the code locks after a few
 * tries, so this route is not a place to guess from.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;
    const input = handoverVerifySchema.parse(await request.json());

    const delivery = await verifyHandoverCode(actor, deliveryId, input);

    return jsonOk({ delivery });
  },
);

import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { updateDeliveryLocation } from "@/lib/orders/delivery-location-service";
import { deliveryLocationUpdateSchema } from "@/validations/order";

/** Renames, moves, reorders or retires a delivery location. Admins only. */
export const PATCH = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ locationId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { locationId } = await context.params;
    const input = deliveryLocationUpdateSchema.parse(await request.json());

    const location = await updateDeliveryLocation(actor, locationId, input);

    return jsonOk({ location });
  },
);

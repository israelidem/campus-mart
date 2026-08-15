import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import {
  createDeliveryLocation,
  listDeliveryLocations,
} from "@/lib/orders/delivery-location-service";
import { deliveryLocationCreateSchema } from "@/validations/order";

/**
 * Delivery locations on the caller's campus (PRD §28).
 *
 * Students receive only the active ones; `includeInactive` is honoured for
 * admins alone, and that decision is made in the service, not here.
 */
export const GET = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const url = new URL(request.url);

  const locations = await listDeliveryLocations(actor, {
    campusId: url.searchParams.get("campusId") ?? undefined,
    includeInactive: url.searchParams.get("includeInactive") === "true",
  });

  return jsonOk({ locations });
});

/** Creates a delivery location. Campus Admin (own campus) or Super Admin. */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const body = (await request.json()) as Record<string, unknown>;
  const input = deliveryLocationCreateSchema.parse(body);

  const location = await createDeliveryLocation(actor, input, {
    campusId: typeof body.campusId === "string" ? body.campusId : undefined,
  });

  return jsonOk({ location }, { status: 201 });
});

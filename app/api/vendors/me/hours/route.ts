import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { setVendorOperatingHours } from "@/lib/vendors/vendor-service";
import { operatingHoursSchema } from "@/validations/vendor";

/**
 * Replaces the vendor's weekly trading hours (PRD §23).
 *
 * PUT rather than PATCH: the whole week is submitted at once, so a partially
 * applied schedule can never leave the store with contradictory days.
 */
export const PUT = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = operatingHoursSchema.parse(await request.json());

  const operatingHours = await setVendorOperatingHours(actor, input);

  return jsonOk({ operatingHours });
});

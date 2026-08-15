import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { setVendorStatus } from "@/lib/vendors/vendor-service";
import { vendorStatusSchema } from "@/validations/vendor";

/**
 * Suspends or reinstates an approved vendor (PRD §8).
 *
 * Separate from the review endpoint because it applies to a vendor that is
 * already trading, and because the state machine allows it only from APPROVED
 * or SUSPENDED.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ vendorProfileId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
    const { vendorProfileId } = await context.params;
    const input = vendorStatusSchema.parse(await request.json());

    const vendor = await setVendorStatus(actor, vendorProfileId, input);

    return jsonOk({ vendor });
  },
);

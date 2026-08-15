import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { reviewVendorApplication } from "@/lib/vendors/vendor-service";
import { vendorReviewSchema } from "@/validations/vendor";

/**
 * Approve, reject or request a correction on a vendor application (PRD §17).
 *
 * Campus ownership of the application is verified in the service layer, so a
 * Campus Admin cannot review another campus's vendors.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ vendorProfileId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
    const { vendorProfileId } = await context.params;
    const input = vendorReviewSchema.parse(await request.json());

    const vendor = await reviewVendorApplication(actor, vendorProfileId, input);

    return jsonOk({ vendor });
  },
);

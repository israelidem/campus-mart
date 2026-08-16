import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { getDisputeContext } from "@/lib/disputes/dispute-service";

/**
 * Whether this purchase can be disputed, and what is already on it (PRD §60).
 *
 * The server answers the question the UI would otherwise have to guess at — is
 * the window open, is there already a live case, was it even delivered — so the
 * page can show the right thing rather than offer a button that will be refused.
 */
export const GET = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ vendorOrderId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { vendorOrderId } = await context.params;

    return jsonOk(await getDisputeContext(actor, vendorOrderId));
  },
);

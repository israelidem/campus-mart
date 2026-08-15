import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { issueHandoverCode } from "@/lib/delivery/delivery-service";

/**
 * Issue the student's hand-over code (PRD §45).
 *
 * POST, not GET: each call mints a new code and invalidates the previous one, so
 * it is a state change and must not be cacheable or prefetchable. The plaintext
 * appears in this response only — the server keeps nothing but its HMAC.
 */
export const POST = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;

    const handover = await issueHandoverCode(actor, deliveryId);

    return jsonOk({ handover });
  },
);

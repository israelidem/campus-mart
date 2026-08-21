import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { issueHandoverCode } from "@/lib/delivery/delivery-service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * Issue the student's hand-over code (PRD §45).
 *
 * POST, not GET: each call mints a new code and invalidates the previous one, so
 * it is a state change and must not be cacheable or prefetchable. The plaintext
 * appears in this response only — the server keeps nothing but its HMAC.
 *
 * Rate limited from Phase 13 as the other half of the pair with `verify-code`.
 * Issuing is the cheap half to abuse: every new code resets the per-code attempt
 * counter, so unlimited issuing turns a five-guess lock into an unlimited one. Ten
 * per ten minutes is more than a hand-over that goes wrong twice ever needs.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;

    await enforceRateLimit({
      action: "HANDOVER_CODE_ISSUE",
      userId: actor.userId,
      headers: request.headers,
    });

    const handover = await issueHandoverCode(actor, deliveryId);

    return jsonOk({ handover });
  },
);

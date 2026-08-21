import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { verifyHandoverCode } from "@/lib/delivery/delivery-service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { handoverVerifySchema } from "@/validations/delivery";

/**
 * The agent submits the code the student showed them (PRD §45–46).
 *
 * A correct code hands the package over and starts the campus's goods-payment
 * window. Wrong codes are counted server-side and the code locks after a few
 * tries, so this route is not a place to guess from.
 *
 * Phase 13 added a rate limit on top of that per-code lock, because the two stop
 * different things. `MAX_OTP_ATTEMPTS` protects *one* code: five wrong guesses and
 * it is dead. It does nothing about an agent who asks for a new code after every
 * fifth failure and keeps going — each new code resets the counter, so the guessing
 * surface widens without limit. The rate limit caps the conversation itself, across
 * codes.
 *
 * It runs after `requireActor` and before the body is parsed. After, because the
 * limit is keyed by agent as well as by IP and the actor has to be known to do
 * that; before, because a refused attempt should cost nothing but the counter.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;

    await enforceRateLimit({
      action: "HANDOVER_CODE_VERIFY",
      userId: actor.userId,
      headers: request.headers,
    });

    const input = handoverVerifySchema.parse(await request.json());

    const delivery = await verifyHandoverCode(actor, deliveryId, input);

    return jsonOk({ delivery });
  },
);

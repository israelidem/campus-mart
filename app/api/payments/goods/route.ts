import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { initialiseGoodsPayment } from "@/lib/payments/payment-service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { goodsPaymentSchema } from "@/validations/payment";

/**
 * Start the goods payment for a delivery whose hand-over code was verified
 * (PRD §46).
 *
 * The campus's payment window is checked server-side, so a student who let it
 * lapse is refused here rather than at the point the money would have moved.
 *
 * Rate limited from Phase 13. Each call creates a `Payment` row and asks Paystack
 * to initialise a transaction, so a loop here writes our rows *and* spends our
 * provider quota. The limit is on the initialisation, not on paying: a student who
 * is genuinely retrying a failed card is well inside twelve in ten minutes.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();

  await enforceRateLimit({
    action: "PAYMENT_INITIATION",
    userId: actor.userId,
    headers: request.headers,
  });

  const { deliveryId } = goodsPaymentSchema.parse(await request.json());

  const payment = await initialiseGoodsPayment(actor, deliveryId);

  return jsonOk({ payment });
});

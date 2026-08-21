import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { initialiseDeliveryFeePayment } from "@/lib/payments/payment-service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { deliveryFeePaymentSchema } from "@/validations/payment";

/**
 * Start the delivery-fee payment for a placed invoice (PRD §32).
 *
 * The response is a checkout URL, not a settlement: the order only moves once
 * Paystack confirms, through the webhook or the callback verification.
 *
 * Rate limited from Phase 13, sharing the `PAYMENT_INITIATION` bucket with the
 * goods payment. One bucket rather than two because the resource being protected
 * is the same — our Paystack quota and our `Payment` table — and an attacker who
 * alternated between the two endpoints would otherwise get double the allowance.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();

  await enforceRateLimit({
    action: "PAYMENT_INITIATION",
    userId: actor.userId,
    headers: request.headers,
  });

  const { orderId } = deliveryFeePaymentSchema.parse(await request.json());

  const payment = await initialiseDeliveryFeePayment(actor, orderId);

  return jsonOk({ payment });
});

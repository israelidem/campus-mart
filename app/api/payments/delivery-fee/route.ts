import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { initialiseDeliveryFeePayment } from "@/lib/payments/payment-service";
import { deliveryFeePaymentSchema } from "@/validations/payment";

/**
 * Start the delivery-fee payment for a placed invoice (PRD §32).
 *
 * The response is a checkout URL, not a settlement: the order only moves once
 * Paystack confirms, through the webhook or the callback verification.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const { orderId } = deliveryFeePaymentSchema.parse(await request.json());

  const payment = await initialiseDeliveryFeePayment(actor, orderId);

  return jsonOk({ payment });
});

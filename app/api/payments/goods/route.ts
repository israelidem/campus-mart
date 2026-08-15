import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { initialiseGoodsPayment } from "@/lib/payments/payment-service";
import { goodsPaymentSchema } from "@/validations/payment";

/**
 * Start the goods payment for a delivery whose hand-over code was verified
 * (PRD §46).
 *
 * The campus's payment window is checked server-side, so a student who let it
 * lapse is refused here rather than at the point the money would have moved.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const { deliveryId } = goodsPaymentSchema.parse(await request.json());

  const payment = await initialiseGoodsPayment(actor, deliveryId);

  return jsonOk({ payment });
});

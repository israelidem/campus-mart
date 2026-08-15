import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { verifyPaymentForActor } from "@/lib/payments/payment-service";
import { paymentReferenceSchema } from "@/validations/payment";

/**
 * The outcome of one payment attempt, for the student who started it.
 *
 * Used by the callback page after Paystack sends the student back. It asks
 * Paystack directly rather than trusting the redirect, and applies the result
 * through the same guarded path as the webhook — so a student who returns before
 * the webhook arrives is not left staring at an unpaid order.
 */
export const GET = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ reference: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { reference } = await context.params;

    const payment = await verifyPaymentForActor(actor, paymentReferenceSchema.parse(reference));

    return jsonOk({ payment });
  },
);

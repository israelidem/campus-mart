import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { handlePaystackWebhook } from "@/lib/payments/payment-service";

/**
 * Paystack's webhook (PRD §50).
 *
 * The only unauthenticated mutating route on the platform, and the only one that
 * may be: it is authenticated by the HMAC signature over the raw body, checked
 * before the body is parsed. There is deliberately no session here — Paystack
 * has no cookie.
 *
 * The raw text is read with `request.text()` rather than `request.json()`,
 * because re-serialising the body would change the bytes the signature was
 * computed over and every event would be rejected.
 *
 * A duplicate event answers 200. Paystack retries anything else, and retrying a
 * payment we have already applied would be noise, not safety.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  const result = await handlePaystackWebhook(rawBody, signature);

  return jsonOk(result);
});

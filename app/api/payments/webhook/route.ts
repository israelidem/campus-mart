import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { ValidationError } from "@/lib/errors";
import { handlePaystackWebhook } from "@/lib/payments/payment-service";

/**
 * The largest webhook body we will read (PRD §50).
 *
 * A Paystack `charge.success` event is a couple of kilobytes. 64 KB is far more
 * than any real event and small enough that reading it costs nothing.
 */
const MAX_WEBHOOK_BYTES = 64 * 1024;

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
 *
 * Phase 13 added the size cap and left the route otherwise alone. The cap is the one
 * thing signature verification cannot do for you: the HMAC is computed *over* the
 * body, so the body must be in memory before it can be checked, and an anonymous
 * caller can therefore make us buffer as much as they like before we reject them.
 * Bounding the read closes that, and does so from the header, before any bytes are
 * pulled.
 *
 * Deliberately *not* rate limited. The route is anonymous, so the only key would be
 * the IP — and Paystack's addresses are shared and undocumented, so a limit tuned to
 * be safe would either be useless or would drop real settlement events. Since a
 * forged event cannot pass the HMAC, an unsigned flood costs one hash, and the size
 * cap already bounds what that hash is computed over.
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    throw new ValidationError("Webhook payload too large");
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    // Belt and braces: `content-length` is the sender's claim, and a chunked
    // request does not send one at all.
    throw new ValidationError("Webhook payload too large");
  }

  const signature = request.headers.get("x-paystack-signature");

  const result = await handlePaystackWebhook(rawBody, signature);

  return jsonOk(result);
});

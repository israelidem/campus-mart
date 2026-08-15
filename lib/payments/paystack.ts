import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * The Paystack boundary (PRD §33–35, §47–50).
 *
 * Everything that talks to Paystack lives here, and nothing here knows about
 * orders or deliveries. Two rules shape the module:
 *
 * 1. **Money is never declared paid by a client.** A browser can only ask for a
 *    checkout URL. The truth arrives either in a signed webhook or from
 *    `verifyTransaction`, and both are re-checked server-side.
 * 2. **Amounts are kobo integers**, which is also Paystack's own unit for NGN,
 *    so no conversion happens anywhere in this file.
 */

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Paystack signs webhooks with HMAC-SHA512 over the raw body, keyed by the secret. */
const WEBHOOK_ALGORITHM = "sha512";

export class PaymentsNotConfiguredError extends AppError {
  constructor() {
    super(
      "PAYMENTS_NOT_CONFIGURED",
      "Payments are not configured on this deployment yet",
      503,
    );
  }
}

export class PaystackError extends AppError {
  constructor(message: string, details?: unknown) {
    // 502: the failure is upstream, and saying so keeps it out of the "we broke"
    // bucket when reading logs.
    super("PAYMENT_PROVIDER_ERROR", message, 502, { expose: true, details });
  }
}

function secretKey(): string {
  const key = env().PAYSTACK_SECRET_KEY;
  if (!key) throw new PaymentsNotConfiguredError();
  return key;
}

export function isPaystackConfigured(): boolean {
  return Boolean(env().PAYSTACK_SECRET_KEY);
}

/**
 * A reference we own, unique per payment attempt.
 *
 * Prefixed by purpose so a reference is self-describing in Paystack's dashboard,
 * and suffixed with 12 random hex characters rather than a counter: references
 * are visible to the payer, and a guessable one invites someone to probe another
 * student's payment.
 */
export function generatePaymentReference(purpose: "DF" | "GD"): string {
  return `CM-${purpose}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/**
 * Is this webhook really from Paystack?
 *
 * Compared in constant time over the raw request body — not the re-serialised
 * JSON, which would change the bytes and break every signature. A missing or
 * malformed header is a failure, never a pass.
 */
export function signWebhookPayload(rawBody: string, secret: string): string {
  return createHmac(WEBHOOK_ALGORITHM, secret).update(rawBody, "utf8").digest("hex");
}

/**
 * The secret is a parameter with a default rather than a lookup, so the check can
 * be tested as the pure function it is without a configured environment.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string = secretKey(),
): boolean {
  if (!signature) return false;

  const expected = signWebhookPayload(rawBody, secret);


  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature.trim(), "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

type PaystackEnvelope<T> = { status: boolean; message: string; data: T };

async function paystackRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Never cached: a payment status is the definition of a value that must
      // not be served from a cache.
      cache: "no-store",
    });
  } catch (error) {
    logger.error("Paystack request failed", { path, error });
    throw new PaystackError("Could not reach the payment provider. Please try again.");
  }

  let payload: PaystackEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as PaystackEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.status) {
    const message = payload?.message ?? `Paystack responded with ${response.status}`;
    logger.error("Paystack rejected a request", { path, status: response.status, message });
    throw new PaystackError(message);
  }

  return payload.data;
}

export type SplitSubaccount = {
  /** Paystack subaccount code, e.g. `ACCT_xxxxxxxx`. */
  subaccount: string;
  /** Flat amount in kobo for this subaccount. */
  share: number;
};

export type InitializeTransactionInput = {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  /** Echoed back in the webhook; used for human debugging, never trusted. */
  metadata?: Record<string, unknown>;
  /**
   * Flat-amount split. Whatever is not shared out stays with the platform
   * account, which is how the commission is taken without an internal wallet
   * (Rule 3).
   */
  subaccounts?: SplitSubaccount[];
};

export type InitializedTransaction = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export async function initializeTransaction(
  input: InitializeTransactionInput,
): Promise<InitializedTransaction> {
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) {
    throw new ValidationError("A payment amount must be a positive whole number of kobo");
  }

  return paystackRequest<InitializedTransaction>("/transaction/initialize", {
    method: "POST",
    body: {
      email: input.email,
      amount: input.amountKobo,
      currency: "NGN",
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata ?? {},
      ...(input.subaccounts && input.subaccounts.length > 0
        ? {
            split: {
              type: "flat",
              currency: "NGN",
              // "deduct_from_platform" would take Paystack's fee out of the
              // platform's share; the pilot leaves the default so the fee is
              // borne where Paystack's dashboard is configured to bear it.
              subaccounts: input.subaccounts.map((entry) => ({
                subaccount: entry.subaccount,
                share: entry.share,
              })),
            },
          }
        : {}),
    },
  });
}

export type VerifiedTransaction = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  gateway_response: string | null;
};

/**
 * Ask Paystack what actually happened.
 *
 * Called for every webhook before anything is acted on, so a forged event with a
 * valid-looking body still cannot move an order: the amount and status used are
 * the ones Paystack reports, not the ones delivered to us.
 */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  return paystackRequest<VerifiedTransaction>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
}

export type PaystackRefund = { id: number; status: string };

/**
 * Refund a transaction in full, or partially when `amountKobo` is given.
 *
 * Used when money lands for something that can no longer be delivered — the
 * goods went back to the vendor while the payment was in flight (PRD §46).
 */
export async function refundTransaction(
  reference: string,
  amountKobo?: number,
): Promise<PaystackRefund> {
  return paystackRequest<PaystackRefund>("/refund", {
    method: "POST",
    body: {
      transaction: reference,
      ...(amountKobo !== undefined ? { amount: amountKobo } : {}),
    },
  });
}

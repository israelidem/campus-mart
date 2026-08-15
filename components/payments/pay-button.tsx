"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiClientError, apiPost } from "@/lib/api/client";

type PayButtonProps =
  | { purpose: "delivery-fee"; orderId: string; label?: string }
  | { purpose: "goods"; deliveryId: string; label?: string };

/**
 * Sends the student to Paystack (PRD §32, §46).
 *
 * The component knows no amount and no split — it names the thing being paid for
 * and follows the checkout URL the server hands back. That is the whole point:
 * there is nothing here for a tampered client to change.
 *
 * The redirect is a full navigation rather than a router push, because the
 * destination is Paystack's domain and the student must come back through the
 * callback route to have the outcome verified.
 */
export function PayButton(props: PayButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const label =
    props.label ?? (props.purpose === "goods" ? "Pay for these goods" : "Pay delivery fee");

  async function startPayment() {
    setError(null);
    setIsBusy(true);
    try {
      const { payment } = await apiPost<{
        payment: { authorizationUrl: string };
      }>(
        props.purpose === "goods" ? "/api/payments/goods" : "/api/payments/delivery-fee",
        props.purpose === "goods"
          ? { deliveryId: props.deliveryId }
          : { orderId: props.orderId },
      );

      window.location.assign(payment.authorizationUrl);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "We could not start that payment. Please try again.",
      );
      // Only reset on failure: on success the page is already navigating away,
      // and re-enabling the button would invite a second checkout.
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button isLoading={isBusy} onClick={() => void startPayment()}>
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

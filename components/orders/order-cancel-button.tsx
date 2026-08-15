"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiClientError, apiPost } from "@/lib/api/client";

/**
 * Cancelling an unpaid invoice (PRD §29).
 *
 * A reason is required, because the same reason is what an admin later reads in
 * the audit log. Once the delivery fee is paid the server refuses this call and
 * the student is told a refund is needed instead.
 */
export function OrderCancelButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function cancel() {
    setError(null);
    setIsBusy(true);
    try {
      await apiPost(`/api/orders/${orderId}/cancel`, { reason });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm" htmlFor={`cancel-reason-${orderId}`}>
        Reason for cancelling
      </label>
      <input
        id={`cancel-reason-${orderId}`}
        value={reason}
        maxLength={300}
        onChange={(event) => setReason(event.target.value)}
        className="h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
      />
      <Button
        variant="danger"
        isLoading={isBusy}
        disabled={reason.trim().length < 3}
        onClick={() => void cancel()}
      >
        Cancel this order
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

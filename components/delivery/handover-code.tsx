"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiClientError, apiPost } from "@/lib/api/client";

type Handover = {
  code: string;
  expiresAt: string;
  goodsPaymentWindowMinutes: number;
};

/**
 * The student's hand-over code (PRD §45).
 *
 * The student asks for the code and reads it to the agent — never the other way
 * round, because the code is what unlocks payment for the goods. It is shown
 * once: asking again mints a new one, which is also how a student recovers if the
 * agent mistyped it five times or read it too late.
 */
export function HandoverCode({ deliveryId, pickupName }: { deliveryId: string; pickupName: string }) {
  const router = useRouter();
  const [handover, setHandover] = useState<Handover | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function issue() {
    setError(null);
    setIsBusy(true);
    try {
      const data = await apiPost<{ handover: Handover }>(
        `/api/deliveries/${deliveryId}/handover-code`,
        {},
      );
      setHandover(data.handover);
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
    <div className="space-y-3 rounded-2xl border border-current/15 p-4">
      <p className="text-sm font-medium">Collecting from {pickupName}</p>

      {handover ? (
        <div className="space-y-2">
          <p
            aria-live="polite"
            className="font-mono text-3xl tracking-[0.35em]"
            // Letter spacing so the digits are read out one at a time without
            // the student losing their place.
          >
            {handover.code}
          </p>
          <p className="text-sm opacity-80">
            Read this to the agent. It expires at{" "}
            {new Date(handover.expiresAt).toLocaleTimeString()}. Once they enter it you have{" "}
            {handover.goodsPaymentWindowMinutes} minutes to pay for your goods.
          </p>
        </div>
      ) : (
        <p className="text-sm opacity-80">
          Ask the agent to confirm they have your package, then show your code.
        </p>
      )}

      <Button variant="secondary" isLoading={isBusy} onClick={() => void issue()}>
        {handover ? "Get a new code" : "Show my hand-over code"}
      </Button>

      {handover ? (
        <p className="text-xs opacity-70">
          A new code replaces this one, so only use it if this code stopped working.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

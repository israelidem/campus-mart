"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError, apiPost } from "@/lib/api/client";

/**
 * The agent's side of the hand-over (PRD §45).
 *
 * Digits only, six of them, and no attempt counter of its own: how many tries
 * are left is whatever the server says in its error, because a count kept here
 * would be both wrong and trivially bypassable.
 */
export function HandoverVerify({ deliveryId }: { deliveryId: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setError(null);
    setBusy(true);
    try {
      await apiPost(`/api/deliveries/${deliveryId}/verify-code`, { code });
      setCode("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor={`handover-code-${deliveryId}`}>
        Hand-over code from the student
      </label>
      <input
        autoComplete="one-time-code"
        className="w-full rounded-md border px-3 py-2 font-mono text-lg tracking-[0.3em] sm:max-w-[12rem]"
        id={`handover-code-${deliveryId}`}
        inputMode="numeric"
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        value={code}
      />
      <div>
        <button
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={busy || code.length !== 6}
          onClick={() => void verify()}
          type="button"
        >
          Confirm hand-over
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        The student generates this on their order page. Hand the package over first.
      </p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

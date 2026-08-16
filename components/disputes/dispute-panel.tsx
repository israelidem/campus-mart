"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError, apiPost } from "@/lib/api/client";
import { formatKobo } from "@/lib/money";

export type DisputeView = {
  id: string;
  reference: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "WITHDRAWN";
  reason: string;
  description: string;
  resolution: string | null;
  resolutionNote: string | null;
  refundAmountKobo: number | null;
  createdAt: string;
};

export type DisputeContext = {
  vendorOrderId: string;
  storeName: string;
  canFile: boolean;
  reasonBlocked: string | null;
  daysRemaining: number;
  disputes: DisputeView[];
};

/**
 * The student's side of a dispute (PRD §60).
 *
 * The reasons are worded as a person would say them, not as the enum spells them,
 * because the list is what decides whether a complaint arrives usefully
 * categorised or as eight variations of "OTHER".
 */
const REASONS: { value: string; label: string }[] = [
  { value: "ITEM_NOT_RECEIVED", label: "I never got it" },
  { value: "ITEM_INCOMPLETE", label: "Part of the order was missing" },
  { value: "WRONG_ITEM", label: "I got the wrong thing" },
  { value: "ITEM_DAMAGED", label: "It arrived damaged" },
  { value: "NOT_AS_DESCRIBED", label: "It was not what the listing described" },
  { value: "OVERCHARGED", label: "I was charged too much" },
  { value: "AGENT_CONDUCT", label: "A problem with the delivery agent" },
  { value: "OTHER", label: "Something else" },
];

const STATUS_LABELS: Record<DisputeView["status"], string> = {
  OPEN: "Waiting for review",
  UNDER_REVIEW: "Being reviewed",
  RESOLVED: "Resolved",
  WITHDRAWN: "Withdrawn",
};

const RESOLUTION_LABELS: Record<string, string> = {
  FULL_REFUND: "Full refund",
  PARTIAL_REFUND: "Partial refund",
  NO_REFUND: "No refund",
};

export function DisputePanel({ context }: { context: DisputeContext }) {
  const router = useRouter();
  const [reason, setReason] = useState<string>("ITEM_NOT_RECEIVED");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const live = context.disputes.find(
    (dispute) => dispute.status === "OPEN" || dispute.status === "UNDER_REVIEW",
  );
  const closed = context.disputes.filter(
    (dispute) => dispute.status === "RESOLVED" || dispute.status === "WITHDRAWN",
  );

  async function file(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await apiPost("/api/disputes", {
        vendorOrderId: context.vendorOrderId,
        reason,
        description: description.trim(),
      });
      setDescription("");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That case could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(disputeId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await apiPost(`/api/disputes/${disputeId}/withdraw`, {});
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That case could not be withdrawn.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Something wrong with this order?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? (
          <p role="alert" className="text-sm text-red-600">
            {message}
          </p>
        ) : null}

        {live ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">
              {STATUS_LABELS[live.status]} · {live.reference}
            </p>
            <p className="text-sm opacity-80">{live.description}</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => withdraw(live.id)}
            >
              Withdraw this case
            </Button>
          </div>
        ) : context.canFile ? (
          <form onSubmit={file} className="space-y-3">
            <p className="text-sm opacity-70">
              {/* The countdown is stated because the deadline is the student's, not
                  ours, and a rule nobody was told is not a rule they can meet. */}
              You have {context.daysRemaining} day{context.daysRemaining === 1 ? "" : "s"} left to
              raise a problem with {context.storeName}.
            </p>

            <label className="block space-y-1">
              <span className="text-sm font-medium">What went wrong?</span>
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {REASONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Tell us what happened</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                minLength={20}
                maxLength={2000}
                required
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="The more specific you are, the faster this gets sorted."
              />
            </label>

            <Button type="submit" disabled={busy || description.trim().length < 20}>
              {busy ? "Sending…" : "Open a case"}
            </Button>
          </form>
        ) : (
          <p className="text-sm opacity-70">{context.reasonBlocked}</p>
        )}

        {closed.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Previous cases</p>
            {closed.map((dispute) => (
              <div key={dispute.id} className="text-sm">
                <p>
                  {dispute.reference} · {STATUS_LABELS[dispute.status]}
                  {dispute.resolution
                    ? ` · ${RESOLUTION_LABELS[dispute.resolution] ?? dispute.resolution}`
                    : ""}
                  {dispute.refundAmountKobo && dispute.refundAmountKobo > 0
                    ? ` · ${formatKobo(dispute.refundAmountKobo)} refunded`
                    : ""}
                </p>
                {dispute.resolutionNote ? (
                  <p className="opacity-70">{dispute.resolutionNote}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

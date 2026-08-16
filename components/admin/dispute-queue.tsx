"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError, apiPost } from "@/lib/api/client";
import { formatKobo } from "@/lib/money";

export type QueuedDispute = {
  id: string;
  reference: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "WITHDRAWN";
  reason: string;
  description: string;
  goodsSubtotalKobo: number;
  commissionKobo: number;
  vendorPayoutKobo: number;
  resolution: string | null;
  resolutionNote: string | null;
  refundAmountKobo: number | null;
  createdAt: string;
  storeName: string;
  orderReference: string;
};

const REASON_LABELS: Record<string, string> = {
  ITEM_NOT_RECEIVED: "Never received",
  WRONG_ITEM: "Wrong item",
  ITEM_INCOMPLETE: "Incomplete",
  ITEM_DAMAGED: "Damaged",
  NOT_AS_DESCRIBED: "Not as described",
  OVERCHARGED: "Overcharged",
  AGENT_CONDUCT: "Agent conduct",
  OTHER: "Other",
};

/**
 * The Campus Admin dispute queue (PRD §61–63).
 *
 * Each card carries the money split the decision will be measured against —
 * goods, commission, payout — because an admin choosing a partial refund is
 * deciding what the platform absorbs and what the vendor does, and that is not
 * something to work out from memory.
 */
export function DisputeQueue({ disputes }: { disputes: QueuedDispute[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<
    Record<string, { resolution: string; amount: string; note: string }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  function draftFor(id: string) {
    return drafts[id] ?? { resolution: "FULL_REFUND", amount: "", note: "" };
  }

  function setDraft(id: string, patch: Partial<{ resolution: string; amount: string; note: string }>) {
    setDrafts((current) => ({ ...current, [id]: { ...draftFor(id), ...patch } }));
  }

  async function startReview(disputeId: string) {
    setBusyId(disputeId);
    setMessage(null);
    try {
      await apiPost(`/api/admin/disputes/${disputeId}/review`, {});
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That case could not be picked up.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function resolve(dispute: QueuedDispute) {
    const draft = draftFor(dispute.id);
    setBusyId(dispute.id);
    setMessage(null);
    setWarning(null);
    try {
      const result = await apiPost<{
        refund: { succeeded: boolean; failureReason: string | null } | null;
      }>(`/api/admin/disputes/${dispute.id}/resolve`, {
        resolution: draft.resolution,
        resolutionNote: draft.note.trim(),
        // Naira in the box, kobo on the wire. Parsed here rather than sent raw so
        // a stray decimal is rejected by the schema instead of silently floored.
        ...(draft.resolution === "PARTIAL_REFUND"
          ? { refundAmountKobo: Math.round(Number(draft.amount) * 100) }
          : {}),
      });

      // The case is closed either way; the refund may still need a human.
      if (result.refund && !result.refund.succeeded) {
        setWarning(
          `Case closed, but the refund did not go through: ${
            result.refund.failureReason ?? "the provider did not confirm it"
          }. It is recorded and needs retrying.`,
        );
      }
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That case could not be resolved.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (disputes.length === 0) {
    return <p className="text-sm opacity-70">No cases match this filter.</p>;
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}
      {warning ? (
        <p role="alert" className="text-sm text-amber-700">
          {warning}
        </p>
      ) : null}

      {disputes.map((dispute) => {
        const draft = draftFor(dispute.id);
        const closed = dispute.status === "RESOLVED" || dispute.status === "WITHDRAWN";

        return (
          <Card key={dispute.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {dispute.reference} · {REASON_LABELS[dispute.reason] ?? dispute.reason} ·{" "}
                {dispute.storeName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="opacity-80">{dispute.description}</p>

              <p className="opacity-70">
                Order {dispute.orderReference} · Goods {formatKobo(dispute.goodsSubtotalKobo)} ·
                Commission {formatKobo(dispute.commissionKobo)} · Vendor payout{" "}
                {formatKobo(dispute.vendorPayoutKobo)}
              </p>

              {closed ? (
                <p>
                  {dispute.status === "WITHDRAWN"
                    ? "Withdrawn by the student"
                    : `Resolved · ${dispute.resolution}${
                        dispute.refundAmountKobo
                          ? ` · ${formatKobo(dispute.refundAmountKobo)} refunded`
                          : ""
                      }`}
                  {dispute.resolutionNote ? ` — ${dispute.resolutionNote}` : ""}
                </p>
              ) : (
                <div className="space-y-3">
                  {dispute.status === "OPEN" ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busyId === dispute.id}
                      onClick={() => startReview(dispute.id)}
                    >
                      Start reviewing
                    </Button>
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="font-medium">Outcome</span>
                      <select
                        value={draft.resolution}
                        onChange={(event) =>
                          setDraft(dispute.id, { resolution: event.target.value })
                        }
                        className="w-full rounded-md border px-3 py-2"
                      >
                        <option value="FULL_REFUND">Full refund</option>
                        <option value="PARTIAL_REFUND">Partial refund</option>
                        <option value="NO_REFUND">No refund</option>
                      </select>
                    </label>

                    {draft.resolution === "PARTIAL_REFUND" ? (
                      <label className="space-y-1">
                        <span className="font-medium">Amount (₦)</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          max={dispute.goodsSubtotalKobo / 100}
                          value={draft.amount}
                          onChange={(event) =>
                            setDraft(dispute.id, { amount: event.target.value })
                          }
                          className="w-full rounded-md border px-3 py-2"
                        />
                      </label>
                    ) : null}
                  </div>

                  <label className="block space-y-1">
                    <span className="font-medium">Explain the decision</span>
                    <textarea
                      value={draft.note}
                      onChange={(event) => setDraft(dispute.id, { note: event.target.value })}
                      rows={3}
                      minLength={10}
                      maxLength={1000}
                      className="w-full rounded-md border px-3 py-2"
                      placeholder="The student and the vendor both see this."
                    />
                  </label>

                  <Button
                    type="button"
                    disabled={busyId === dispute.id || draft.note.trim().length < 10}
                    onClick={() => resolve(dispute)}
                  >
                    {busyId === dispute.id ? "Working…" : "Resolve case"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

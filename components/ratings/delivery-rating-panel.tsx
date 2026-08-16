"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StarRating } from "@/components/ratings/star-rating";
import { Button } from "@/components/ui/button";
import { ApiClientError, apiPatch, apiPost } from "@/lib/api/client";

export type RatingSlotView = {
  subject: "VENDOR" | "DELIVERY_AGENT";
  subjectName: string;
  available: boolean;
  mine: {
    id: string;
    score: number;
    comment: string | null;
    editable: boolean;
    hoursLeft: number;
  } | null;
};

/**
 * "How did it go?" for one completed delivery (PRD §57–58).
 *
 * The panel never decides what may be rated — the server sends `available` and
 * `editable`, and both are re-checked when the form is submitted. That matters
 * because the edit window closes while the page is open: an expired window shows
 * a read-only rating here *and* refuses the request if the button is somehow
 * clicked.
 */
export function DeliveryRatingPanel({
  deliveryId,
  rateable,
  slots,
}: {
  deliveryId: string;
  rateable: boolean;
  slots: RatingSlotView[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, { score: number; comment: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  if (!rateable) return null;

  function draftFor(slot: RatingSlotView) {
    return (
      drafts[slot.subject] ?? {
        score: slot.mine?.score ?? 0,
        comment: slot.mine?.comment ?? "",
      }
    );
  }

  function setDraft(subject: string, patch: Partial<{ score: number; comment: string }>) {
    setDrafts((current) => ({
      ...current,
      [subject]: { score: 0, comment: "", ...current[subject], ...patch },
    }));
  }

  async function submit(slot: RatingSlotView) {
    const draft = draftFor(slot);
    if (draft.score < 1) {
      setMessage("Choose a star rating first.");
      return;
    }

    setBusy(slot.subject);
    setMessage(null);
    try {
      if (slot.mine) {
        await apiPatch(`/api/ratings/${slot.mine.id}`, {
          score: draft.score,
          comment: draft.comment.trim() ? draft.comment.trim() : null,
        });
      } else {
        await apiPost(`/api/deliveries/${deliveryId}/ratings`, {
          subject: slot.subject,
          score: draft.score,
          comment: draft.comment.trim() || undefined,
        });
      }
      setEditing((current) => ({ ...current, [slot.subject]: false }));
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That rating could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  const usable = slots.filter((slot) => slot.available);
  if (usable.length === 0) return null;

  return (
    <section className="space-y-4 rounded-2xl border border-current/10 p-4">
      <div>
        <h3 className="text-sm font-semibold">How did it go?</h3>
        <p className="text-xs opacity-70">
          Your rating is public; your full name is not. You can change it for 24 hours.
        </p>
      </div>

      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}

      {usable.map((slot) => {
        const draft = draftFor(slot);
        const isEditing = editing[slot.subject] ?? !slot.mine;
        const label = slot.subject === "VENDOR" ? "Store" : "Delivery agent";

        return (
          <div key={slot.subject} className="space-y-2 border-t border-current/10 pt-3 first:border-0 first:pt-0">
            <p className="text-sm">
              <span className="opacity-60">{label}:</span> <span className="font-medium">{slot.subjectName}</span>
            </p>

            {slot.mine && !isEditing ? (
              <div className="flex flex-wrap items-center gap-3">
                <StarRating value={slot.mine.score} size="sm" />
                {slot.mine.comment ? (
                  <span className="text-sm opacity-80">“{slot.mine.comment}”</span>
                ) : null}
                {slot.mine.editable ? (
                  <Button
                    variant="secondary"
                    onClick={() => setEditing((current) => ({ ...current, [slot.subject]: true }))}
                  >
                    {`Change (${slot.mine.hoursLeft}h left)`}
                  </Button>
                ) : (
                  <span className="text-xs opacity-60">This rating is now final.</span>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <StarRating
                  value={draft.score}
                  name={`rating-${deliveryId}-${slot.subject}`}
                  onChange={(score) => setDraft(slot.subject, { score })}
                  disabled={busy === slot.subject}
                  label={`Rate this ${label.toLowerCase()}`}
                />

                <label className="block space-y-1.5">
                  <span className="text-sm opacity-70">Review (optional)</span>
                  <textarea
                    value={draft.comment}
                    onChange={(event) => setDraft(slot.subject, { comment: event.target.value })}
                    rows={2}
                    maxLength={1000}
                    className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"
                  />
                </label>

                <div className="flex gap-2">
                  <Button onClick={() => submit(slot)} disabled={busy === slot.subject}>
                    {slot.mine ? "Save change" : "Submit rating"}
                  </Button>
                  {slot.mine ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setEditing((current) => ({ ...current, [slot.subject]: false }))
                      }
                      disabled={busy === slot.subject}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

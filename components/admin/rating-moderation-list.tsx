"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StarRating } from "@/components/ratings/star-rating";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError, apiDelete, apiPost } from "@/lib/api/client";

export type ModeratedRating = {
  id: string;
  subject: "VENDOR" | "DELIVERY_AGENT";
  subjectName: string;
  score: number;
  comment: string | null;
  raterName: string;
  raterEmail: string;
  orderReference: string;
  createdAt: string;
  edited: boolean;
  hiddenAt: string | null;
  hiddenReason: string | null;
};

/**
 * Campus Admin review moderation (PRD §59).
 *
 * Hiding, not deleting: the row and its words survive, and the button that put
 * them out of sight can put them back. That is why each card shows the reason a
 * review was hidden — the next admin to look needs to know what the last one
 * decided, and why.
 */
export function RatingModerationList({ ratings }: { ratings: ModeratedRating[] }) {
  const router = useRouter();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function hide(ratingId: string) {
    const reason = reasons[ratingId]?.trim();
    if (!reason) {
      setMessage("Give a reason before hiding a review.");
      return;
    }

    setBusyId(ratingId);
    setMessage(null);
    try {
      await apiPost(`/api/admin/ratings/${ratingId}/hide`, { reason });
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That review could not be hidden.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function restore(ratingId: string) {
    setBusyId(ratingId);
    setMessage(null);
    try {
      await apiDelete(`/api/admin/ratings/${ratingId}/hide`);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That review could not be restored.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (ratings.length === 0) {
    return <p className="text-sm opacity-70">No reviews match this filter.</p>;
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}

      {ratings.map((rating) => (
        <Card key={rating.id}>
          <CardHeader>
            <CardTitle>
              {rating.subject === "VENDOR" ? "Store" : "Agent"}: {rating.subjectName}
            </CardTitle>
            <p className="text-sm opacity-70">
              {rating.raterName} · {rating.raterEmail} · order {rating.orderReference}
            </p>
          </CardHeader>

          <CardContent>
            <div className="flex flex-wrap items-center gap-3">
              <StarRating value={rating.score} size="sm" />
              <span className="text-xs opacity-60">
                {new Date(rating.createdAt).toLocaleString()}
                {rating.edited ? " · edited" : ""}
              </span>
              {rating.hiddenAt ? (
                <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600">
                  Hidden
                </span>
              ) : null}
            </div>

            <p className="text-sm">{rating.comment ? `“${rating.comment}”` : <span className="opacity-60">No written review.</span>}</p>

            {rating.hiddenAt ? (
              <>
                <p className="text-xs opacity-70">
                  Hidden {new Date(rating.hiddenAt).toLocaleString()} — {rating.hiddenReason}
                </p>
                <Button onClick={() => restore(rating.id)} disabled={busyId === rating.id}>
                  Restore review
                </Button>
              </>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Reason (required to hide)</span>
                  <textarea
                    value={reasons[rating.id] ?? ""}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [rating.id]: event.target.value }))
                    }
                    rows={2}
                    maxLength={300}
                    className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"
                  />
                </label>
                <Button
                  variant="danger"
                  onClick={() => hide(rating.id)}
                  disabled={busyId === rating.id}
                >
                  Hide review
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

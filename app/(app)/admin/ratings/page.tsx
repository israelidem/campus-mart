import Link from "next/link";
import { redirect } from "next/navigation";

import {
  RatingModerationList,
  type ModeratedRating,
} from "@/components/admin/rating-moderation-list";
import { getActor } from "@/lib/auth/session";
import { listRatingsForModeration } from "@/lib/ratings/rating-service";
import type { RatingModerationQuery } from "@/validations/rating";

/**
 * Campus Admin review moderation (PRD §59).
 *
 * The default view is low scores, because that is the queue that matters: a
 * campus does not need an admin to read its five-star reviews. The filters are
 * plain links rather than a client-side control, so the page stays a server
 * component and each view is a shareable URL.
 */
export default async function AdminRatingsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; subject?: string; maxScore?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") redirect("/after-sign-in");

  const params = await searchParams;

  const state: RatingModerationQuery["state"] =
    params.state === "hidden" || params.state === "all" ? params.state : "visible";
  const subject: RatingModerationQuery["subject"] =
    params.subject === "VENDOR" || params.subject === "DELIVERY_AGENT" ? params.subject : undefined;
  const parsedMax = Number(params.maxScore);
  const maxScore =
    Number.isInteger(parsedMax) && parsedMax >= 1 && parsedMax <= 5 ? parsedMax : undefined;

  const ratings = await listRatingsForModeration(actor, { state, subject, maxScore, limit: 100 });

  const view: ModeratedRating[] = ratings.map((rating) => ({
    id: rating.id,
    subject: rating.subject,
    subjectName: rating.subjectName,
    score: rating.score,
    comment: rating.comment,
    raterName: rating.raterName,
    raterEmail: rating.raterEmail,
    orderReference: rating.orderReference,
    createdAt: rating.createdAt.toISOString(),
    edited: rating.edited,
    hiddenAt: rating.hiddenAt?.toISOString() ?? null,
    hiddenReason: rating.hiddenReason,
  }));

  const filters: { label: string; href: string; active: boolean }[] = [
    { label: "Visible", href: "/admin/ratings", active: state === "visible" && !maxScore && !subject },
    {
      label: "Low scores (≤2)",
      href: "/admin/ratings?maxScore=2",
      active: maxScore === 2 && state === "visible",
    },
    { label: "Hidden", href: "/admin/ratings?state=hidden", active: state === "hidden" },
    { label: "Stores", href: "/admin/ratings?subject=VENDOR", active: subject === "VENDOR" },
    {
      label: "Agents",
      href: "/admin/ratings?subject=DELIVERY_AGENT",
      active: subject === "DELIVERY_AGENT",
    },
    { label: "All", href: "/admin/ratings?state=all", active: state === "all" },
  ];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Reviews</h1>
        <p className="text-sm opacity-70">
          Hiding a review removes it from the marketplace and from the store&apos;s average. It stays
          on record and can be restored.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 text-sm">
        {filters.map((filter) => (
          <Link
            key={filter.label}
            href={filter.href}
            className={
              filter.active
                ? "rounded-full bg-current/10 px-3 py-1 font-medium"
                : "rounded-full px-3 py-1 opacity-70 hover:opacity-100"
            }
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <RatingModerationList ratings={view} />
    </section>
  );
}

import { redirect } from "next/navigation";

import { VendorReviewList, type ReviewableVendor } from "@/components/admin/vendor-review-list";
import { getActor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listVendorsForReview } from "@/lib/vendors/vendor-service";

/**
 * Campus Admin vendor management (PRD §17, §8).
 *
 * The campus comes from the authenticated admin, so this page can only ever
 * show the admin's own campus (Rule 25).
 */
export default async function AdminVendorsPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "CAMPUS_ADMIN") redirect("/after-sign-in");

  const [campus, pending, approved, suspended] = await Promise.all([
    actor.campusId
      ? prisma.campus.findUnique({
          where: { id: actor.campusId },
          select: { name: true, code: true },
        })
      : null,
    listVendorsForReview(actor, { status: "PENDING_VERIFICATION" }),
    listVendorsForReview(actor, { status: "APPROVED" }),
    listVendorsForReview(actor, { status: "SUSPENDED" }),
  ]);

  const toView = (vendors: Awaited<ReturnType<typeof listVendorsForReview>>): ReviewableVendor[] =>
    vendors.map((vendor) => ({
      ...vendor,
      submittedAt: vendor.submittedAt?.toISOString() ?? null,
    }));

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Vendors</h1>
        <p className="text-sm opacity-70">
          {campus ? `${campus.name} (${campus.code})` : "Your campus"} ·{" "}
          {pending.length === 1 ? "1 application" : `${pending.length} applications`} awaiting review
        </p>
      </header>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
          Awaiting review
        </h2>
        <VendorReviewList vendors={toView(pending)} mode="PENDING" />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">Approved stores</h2>
        <VendorReviewList vendors={toView(approved)} mode="APPROVED" />
      </div>

      {suspended.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">Suspended</h2>
          <VendorReviewList vendors={toView(suspended)} mode="SUSPENDED" />
        </div>
      ) : null}
    </section>
  );
}

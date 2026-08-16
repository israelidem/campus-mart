import Link from "next/link";
import { redirect } from "next/navigation";

import { DisputeQueue, type QueuedDispute } from "@/components/admin/dispute-queue";
import { getActor } from "@/lib/auth/session";
import { listCampusDisputes } from "@/lib/disputes/dispute-service";
import type { DisputeQueueQuery } from "@/validations/dispute";

/**
 * Campus Admin dispute queue (PRD §61–63).
 *
 * Opens on the live cases, oldest first, because that is the only view that is a
 * queue rather than a report. The filters are links so each view is a shareable
 * URL and the page stays a server component.
 */
export default async function AdminDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; reason?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") redirect("/after-sign-in");

  const params = await searchParams;

  const allowedStates = ["live", "open", "under_review", "resolved", "withdrawn", "all"] as const;
  const state: DisputeQueueQuery["state"] = allowedStates.includes(
    params.state as (typeof allowedStates)[number],
  )
    ? (params.state as DisputeQueueQuery["state"])
    : "live";

  const disputes = await listCampusDisputes(actor, { state, limit: 100 });

  const view: QueuedDispute[] = disputes.map((dispute) => ({
    id: dispute.id,
    reference: dispute.reference,
    status: dispute.status,
    reason: dispute.reason,
    description: dispute.description,
    goodsSubtotalKobo: dispute.goodsSubtotalKobo,
    commissionKobo: dispute.commissionKobo,
    vendorPayoutKobo: dispute.vendorPayoutKobo,
    resolution: dispute.resolution,
    resolutionNote: dispute.resolutionNote,
    refundAmountKobo: dispute.refundAmountKobo,
    createdAt: dispute.createdAt.toISOString(),
    storeName: dispute.vendorOrder.vendorProfile.storeName,
    orderReference: dispute.order.reference,
  }));

  const filters: { label: string; href: string; active: boolean }[] = [
    { label: "Live", href: "/admin/disputes", active: state === "live" },
    { label: "New", href: "/admin/disputes?state=open", active: state === "open" },
    {
      label: "Under review",
      href: "/admin/disputes?state=under_review",
      active: state === "under_review",
    },
    { label: "Resolved", href: "/admin/disputes?state=resolved", active: state === "resolved" },
    { label: "All", href: "/admin/disputes?state=all", active: state === "all" },
  ];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Disputes</h1>
        <p className="text-sm opacity-70">
          A refund comes out of the vendor&apos;s payout first, and out of the platform&apos;s
          commission only once the payout is exhausted. Both the student and the vendor see the
          explanation you write.
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

      <DisputeQueue disputes={view} />
    </section>
  );
}

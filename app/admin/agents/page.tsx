import type { Metadata } from "next";

import { AgentReviewQueue } from "@/components/admin/agent-review-queue";
import { requireRole } from "@/lib/auth/session";
import { listAgentsForAdmin } from "@/lib/delivery/agent-service";

export const metadata: Metadata = {
  title: "Delivery agents · Campus Mart",
};

/**
 * Campus Admin review of delivery agents (PRD §36, §42).
 *
 * The service scopes the list to the admin's own campus in the query, so this
 * page cannot be coaxed into showing another campus's applicants.
 */
export default async function AdminAgentsPage() {
  const actor = await requireRole("CAMPUS_ADMIN", "SUPER_ADMIN");
  const agents = await listAgentsForAdmin(actor);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Delivery agents</h1>
        <p className="text-sm text-muted-foreground">
          Approve the students who may carry packages on your campus, and act on those whose
          cancellations have been flagged.
        </p>
      </header>

      <AgentReviewQueue initialAgents={agents} />
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AgentConsole, type AgentDelivery } from "@/components/delivery/agent-console";
import { getActor } from "@/lib/auth/session";
import { getMyAgentProfile } from "@/lib/delivery/agent-service";
import { listMyDeliveries, listPool } from "@/lib/delivery/delivery-service";

export const metadata: Metadata = {
  title: "Deliveries · Campus Mart",
};

/**
 * The delivery agent area.
 *
 * Open to any signed-in student, because applying to deliver has to start
 * somewhere; what an agent may actually *do* is decided by their approved agent
 * profile on every request, not by the fact that they reached this page.
 *
 * The pool is fetched here rather than in the browser so the destination lock and
 * campus scope are applied in the query (Rule 25). An off-duty or unapproved
 * agent simply gets an empty pool — the service refuses, which is the correct
 * answer, not an error worth showing.
 */
export default async function AgentPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=/agent");

  const agent = await getMyAgentProfile(actor);

  let mine: AgentDelivery[] = [];
  let pool: AgentDelivery[] = [];

  if (agent?.status === "APPROVED") {
    mine = await listMyDeliveries(actor);
    if (agent.isOnDuty) pool = await listPool(actor);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <AgentConsole agent={agent} mine={mine} pool={pool} />
    </main>
  );
}

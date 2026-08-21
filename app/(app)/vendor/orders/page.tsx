import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { VendorOrderQueue } from "@/components/vendors/order-queue";
import { getActor } from "@/lib/auth/session";
import { listVendorOrders } from "@/lib/orders/order-service";
import { getVendorState } from "@/lib/vendors/vendor-service";

/** The vendor's incoming orders (PRD §27). */
export default async function VendorOrdersPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  const state = await getVendorState(actor);

  if (state.status !== "APPROVED") {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Your orders</h1>
        <Card>
          <p className="text-sm">
            You will receive orders once your store is approved. Your store is currently{" "}
            <strong>{state.status.toLowerCase().replace(/_/g, " ")}</strong>.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/vendor/store" className="underline">
              Go to your store
            </Link>
          </p>
        </Card>
      </section>
    );
  }

  const orders = await listVendorOrders(actor);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Your orders</h1>
        <p className="text-sm opacity-70">
          Prepare each order, then mark it ready. A delivery agent collects it from you.
        </p>
      </header>

      <VendorOrderQueue
        orders={orders.map((order) => ({
          ...order,
          placedAt: order.placedAt.toISOString(),
        }))}
      />
    </section>
  );
}

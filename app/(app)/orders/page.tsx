import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";
import { formatKobo } from "@/lib/money";
import { listStudentOrders } from "@/lib/orders/order-service";

/** The student's invoices, newest first (PRD §26). */
export default async function OrdersPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  let orders;
  try {
    orders = await listStudentOrders(actor);
  } catch {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Your orders</h1>
        <Card>
          <p className="text-sm">Only students with an approved verification can place orders.</p>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Your orders</h1>

      {orders.length === 0 ? (
        <Card>
          <p className="text-sm">You have not placed an order yet.</p>
          <p className="mt-2 text-sm">
            <Link href="/marketplace" className="underline">
              Browse the marketplace
            </Link>
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Card>
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/orders/${order.id}`} className="font-medium underline">
                    {order.reference}
                  </Link>
                  <span className="text-sm">{formatKobo(order.totalKobo)}</span>
                </div>
                <p className="mt-1 text-sm opacity-70">
                  {order.status.toLowerCase().replace(/_/g, " ")} ·{" "}
                  {order.vendorOrders.length === 1
                    ? "1 store"
                    : `${order.vendorOrders.length} stores`}{" "}
                  · {order.deliveryLocationName}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

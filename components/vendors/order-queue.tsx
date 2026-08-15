"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError, apiPatch } from "@/lib/api/client";
import { formatKobo } from "@/lib/money";

/**
 * Vendor fulfilment queue (PRD §27).
 *
 * A vendor only ever sees their own slice of an invoice, and only the two moves
 * that are theirs to make: start preparing, and mark ready for pickup. Handing
 * goods over and completing the order belong to the delivery engine, so no
 * button here can reach those states.
 */

export type VendorOrderRow = {
  id: string;
  orderReference: string;
  status: string;
  placedAt: string;
  goodsSubtotalKobo: number;
  commissionKobo: number;
  vendorPayoutKobo: number;
  deliveryLocationName: string;
  contactPhone: string;
  deliveryNote: string | null;
  items: { id: string; productName: string; quantity: number; lineTotalKobo: number }[];
};

/** The single next move a vendor may make, or null when it is out of their hands. */
function nextStatus(status: string): { value: string; label: string } | null {
  if (status === "PLACED") return { value: "PREPARING", label: "Start preparing" };
  if (status === "PREPARING") return { value: "READY_FOR_PICKUP", label: "Mark ready for pickup" };
  return null;
}

export function VendorOrderQueue({ orders }: { orders: VendorOrderRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function advance(vendorOrderId: string, status: string) {
    setError(null);
    setBusyId(vendorOrderId);
    try {
      await apiPatch(`/api/vendors/me/orders/${vendorOrderId}`, { status });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (orders.length === 0) {
    return (
      <Card>
        <p className="text-sm">No orders yet.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {orders.map((order) => {
        const move = nextStatus(order.status);

        return (
          <Card key={order.id}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-medium">{order.orderReference}</h2>
              <span className="text-sm opacity-70">
                {order.status.toLowerCase().replace(/_/g, " ")}
              </span>
            </div>

            <ul className="mt-3 space-y-2">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    {item.productName} × {item.quantity}
                  </span>
                  <span>{formatKobo(item.lineTotalKobo)}</span>
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt>Items</dt>
                <dd>{formatKobo(order.goodsSubtotalKobo)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Platform commission</dt>
                <dd>−{formatKobo(order.commissionKobo)}</dd>
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <dt>Your payout</dt>
                <dd>{formatKobo(order.vendorPayoutKobo)}</dd>
              </div>
            </dl>

            <p className="mt-3 text-sm opacity-70">
              For delivery to {order.deliveryLocationName}
              {order.deliveryNote ? ` — ${order.deliveryNote}` : null}
            </p>

            {move ? (
              <div className="mt-3">
                <Button
                  size="sm"
                  isLoading={busyId === order.id}
                  onClick={() => void advance(order.id, move.value)}
                >
                  {move.label}
                </Button>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

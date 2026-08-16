import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HandoverCode } from "@/components/delivery/handover-code";
import { OrderCancelButton } from "@/components/orders/order-cancel-button";
import { PayButton } from "@/components/payments/pay-button";
import { DeliveryRatingPanel } from "@/components/ratings/delivery-rating-panel";
import { Card } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";
import { listDeliveriesForStudentOrder } from "@/lib/delivery/delivery-service";
import { formatKobo } from "@/lib/money";
import { getOrderForStudent } from "@/lib/orders/order-service";
import { getDeliveryRatingState } from "@/lib/ratings/rating-service";



/**
 * One invoice (PRD §26).
 *
 * Every figure here was frozen at checkout, so this page reads stored values
 * rather than recomputing anything.
 */
export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  let order;
  try {
    order = await getOrderForStudent(actor, orderId);
  } catch {
    notFound();
  }

  // Ownership was already proven by the call above; this one re-checks it anyway,
  // because a service that trusts its caller stops being a security boundary.
  const deliveries = await listDeliveriesForStudentOrder(actor, order.id);

  // The rating state is fetched per delivery rather than per order: a two-store
  // order is two hand-overs, and a student may have been well served by one and
  // badly by the other (PRD §57).
  const ratingStates = await Promise.all(
    deliveries.map((delivery) => getDeliveryRatingState(actor, delivery.id)),
  );



  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href="/orders" className="underline">
            All orders
          </Link>
        </p>
        <h1 className="text-xl font-semibold">{order.reference}</h1>
        <p className="text-sm opacity-70">
          {order.status.toLowerCase().replace(/_/g, " ")} · placed{" "}
          {order.placedAt.toLocaleString("en-NG")}
        </p>
      </header>

      {order.vendorOrders.map((vendorOrder) => (
        <Card key={vendorOrder.id}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-medium">{vendorOrder.storeName}</h2>
            <span className="text-sm opacity-70">
              {vendorOrder.status.toLowerCase().replace(/_/g, " ")}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {vendorOrder.items.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  {item.productName} × {item.quantity}
                  {item.unitLabel ? ` (${item.unitLabel})` : null}
                </span>
                <span>{formatKobo(item.lineTotalKobo)}</span>
              </li>
            ))}
          </ul>
          {vendorOrder.cancellationReason ? (
            <p className="mt-2 text-sm text-red-700">Cancelled: {vendorOrder.cancellationReason}</p>
          ) : null}
        </Card>
      ))}

      <Card>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt>Items</dt>
            <dd>{formatKobo(order.goodsSubtotalKobo)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Delivery</dt>
            <dd>{formatKobo(order.deliveryFeeKobo)}</dd>
          </div>
          <div className="flex justify-between gap-3 font-medium">
            <dt>Total</dt>
            <dd>{formatKobo(order.totalKobo)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm opacity-70">
          Delivering to {order.deliveryLocationName}
          {order.deliveryNote ? ` — ${order.deliveryNote}` : null} · {order.contactPhone}
        </p>
      </Card>

      {deliveries.length > 0 ? (
        <Card>
          <h2 className="font-medium">Delivery</h2>
          <ul className="mt-3 space-y-4">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="space-y-2">
                <p className="text-sm">
                  {delivery.pickupName} —{" "}
                  <span className="opacity-70">
                    {delivery.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                </p>
                {delivery.agentName ? (
                  <p className="text-sm opacity-70">
                    Agent {delivery.agentName}
                    {delivery.agentPhone ? ` · ${delivery.agentPhone}` : null}
                  </p>
                ) : null}

                {/*
                  The code only makes sense while someone is standing there with
                  the package, so it is offered from arrival until the hand-over
                  is confirmed (PRD §45).
                */}
                {delivery.status === "ARRIVED" || delivery.status === "AWAITING_OTP" ? (
                  <HandoverCode deliveryId={delivery.id} pickupName={delivery.pickupName} />
                ) : null}

                {delivery.status === "PAYMENT_PENDING" ? (
                  <div className="space-y-2">
                    {delivery.goodsPaymentDeadline ? (
                      <p className="text-sm">
                        Package received. Pay for your goods by{" "}
                        {delivery.goodsPaymentDeadline.toLocaleTimeString("en-NG")} or they go back
                        to the store.
                      </p>
                    ) : null}
                    {/*
                      The amount is not passed in: the server reads it from the
                      vendor order it froze at checkout (Rule 1).
                    */}
                    <PayButton purpose="goods" deliveryId={delivery.id} />
                  </div>
                ) : null}

                {/*
                  Rating is offered on the same row as the delivery it is about,
                  and the panel renders nothing at all until the server says the
                  delivery completed (PRD §57).
                */}
                {(() => {
                  const state = ratingStates.find((item) => item.deliveryId === delivery.id);
                  if (!state) return null;
                  return (
                    <DeliveryRatingPanel
                      deliveryId={state.deliveryId}
                      rateable={state.rateable}
                      slots={state.slots.map((slot) => ({
                        subject: slot.subject as "VENDOR" | "DELIVERY_AGENT",
                        subjectName: slot.subjectName,
                        available: slot.available,
                        mine: slot.mine
                          ? {
                              id: slot.mine.id,
                              score: slot.mine.score,
                              comment: slot.mine.comment,
                              editable: slot.mine.editable,
                              hoursLeft: slot.mine.hoursLeft,
                            }
                          : null,
                      }))}
                    />
                  );
                })()}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {order.status === "AWAITING_DELIVERY_PAYMENT" ? (

        <Card>
          <p className="text-sm">
            Pay the {formatKobo(order.deliveryFeeKobo)} delivery fee to release your packages to a
            delivery agent. You pay for the goods themselves only when they reach you.
          </p>
          <div className="mt-3">
            <PayButton purpose="delivery-fee" orderId={order.id} />
          </div>
          <p className="mt-4 text-sm opacity-70">
            Changed your mind? Cancelling now puts your items back on the shelf.
          </p>
          <div className="mt-2">
            <OrderCancelButton orderId={order.id} />
          </div>
        </Card>

      ) : null}
    </section>
  );
}

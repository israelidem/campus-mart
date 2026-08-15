"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError, apiDelete, apiPatch, apiPost } from "@/lib/api/client";
import type { CartView } from "@/lib/orders/cart-view";
import { formatKobo } from "@/lib/money";

/**
 * Cart and checkout (PRD §25–26).
 *
 * The component holds no prices of its own: every mutation returns the freshly
 * priced cart from the server and that replaces the local state, so what the
 * student sees is always what the server would charge. The delivery fee is
 * deliberately not previewed as a number here — it is computed at checkout from
 * the destination, and inventing a client-side estimate would be a promise the
 * server has not made.
 */

export type DeliveryLocationOption = {
  id: string;
  name: string;
  description: string | null;
};

type Props = {
  cart: CartView;
  locations: DeliveryLocationOption[];
};

export function CartManager({ cart: initialCart, locations }: Props) {
  const router = useRouter();
  const [cart, setCart] = useState(initialCart);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  /** Runs a cart mutation and adopts the server's version of the cart. */
  async function mutate(itemId: string | null, action: () => Promise<{ cart: CartView }>) {
    setError(null);
    setBusyItemId(itemId);
    try {
      const result = await action();
      setCart(result.cart);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusyItemId(null);
    }
  }

  async function checkout() {
    setError(null);
    try {
      const { order } = await apiPost<{ order: { id: string } }>("/api/orders", {
        deliveryLocationId: locationId,
        deliveryNote: deliveryNote.trim() === "" ? undefined : deliveryNote.trim(),
        contactPhone,
      });
      startTransition(() => router.push(`/orders/${order.id}`));
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
    }
  }

  if (cart.vendors.length === 0) {
    return (
      <Card>
        <p className="text-sm">Your cart is empty.</p>
        <p className="mt-2 text-sm">
          <Link href="/marketplace" className="underline">
            Browse the marketplace
          </Link>

        </p>
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

      {cart.vendors.map((vendor) => (
        <Card key={vendor.vendorProfileId}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-medium">{vendor.storeName}</h2>
            <span className="text-sm opacity-70">{formatKobo(vendor.goodsSubtotalKobo)}</span>
          </div>

          <ul className="mt-3 space-y-3">
            {vendor.items.map((item) => (
              <li key={item.id} className="border-t border-current/10 pt-3 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.productName}</p>
                    <p className="text-sm opacity-70">
                      {formatKobo(item.unitPriceKobo)}
                      {item.unitLabel ? ` per ${item.unitLabel}` : null}
                    </p>
                  </div>
                  <p className="text-sm font-medium">{formatKobo(item.lineTotalKobo)}</p>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <label className="text-sm" htmlFor={`quantity-${item.id}`}>
                    Quantity
                  </label>
                  <input
                    id={`quantity-${item.id}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={Math.max(item.stockQuantity, 1)}
                    value={item.quantity}
                    disabled={busyItemId === item.id}
                    onChange={(event) => {
                      const quantity = Number(event.target.value);
                      if (!Number.isInteger(quantity) || quantity < 1) return;
                      void mutate(item.id, () =>
                        apiPatch<{ cart: CartView }>(`/api/cart/items/${item.id}`, { quantity }),
                      );
                    }}
                    className="h-11 w-20 rounded-xl border border-current/20 px-2 text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={busyItemId === item.id}
                    onClick={() =>
                      void mutate(item.id, () =>
                        apiDelete<{ cart: CartView }>(`/api/cart/items/${item.id}`),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>

                {item.unorderableReason ? (
                  <p className="mt-2 text-sm text-red-700">{item.unorderableReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm">Items</span>
          <span className="text-sm">{formatKobo(cart.goodsSubtotalKobo)}</span>
        </div>
        <p className="mt-2 text-sm opacity-70">
          The delivery fee is calculated from the location you choose and shown on your invoice
          before you pay.
        </p>
      </Card>

      <Card>
        <h2 className="font-medium">Where should this go?</h2>

        {locations.length === 0 ? (
          <p className="mt-2 text-sm">
            Your campus has no delivery locations yet. Ask your campus admin to add one.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-sm" htmlFor="delivery-location">
                Delivery location
              </label>
              <select
                id="delivery-location"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm" htmlFor="delivery-note">
                Room, flat or landmark (optional)
              </label>
              <input
                id="delivery-note"
                value={deliveryNote}
                maxLength={300}
                onChange={(event) => setDeliveryNote(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm" htmlFor="contact-phone">
                Phone number for the delivery agent
              </label>
              <input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
              />
            </div>

            <Button
              size="lg"
              isLoading={isPending}
              disabled={!cart.isCheckoutReady || locationId === "" || contactPhone.trim() === ""}
              onClick={() => void checkout()}
            >
              Place order
            </Button>

            {!cart.isCheckoutReady ? (
              <p className="text-sm text-red-700">
                Fix the highlighted items above before placing this order.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

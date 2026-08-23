"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { BrowseMarketplaceEmpty, Notice } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { ApiClientError, apiDelete, apiPatch, apiPost } from "@/lib/api/client";
import type { CartView } from "@/lib/orders/cart-view";
import { formatKobo } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Cart and checkout (PRD §25–26).
 *
 * The data contract is unchanged and deliberately so: the component holds no
 * prices of its own, every mutation adopts the freshly priced cart the server
 * returns, and the delivery fee is still not previewed as a number because it is
 * computed at checkout from the destination. Inventing a client-side estimate
 * would be a promise the server has not made.
 *
 * What the redesign changed:
 *
 *  • **A real duplicate-order guard.** `isPending` previously wrapped only the
 *    `router.push`, so for the whole duration of `POST /api/orders` the button
 *    was still enabled. Two taps on a slow campus connection meant two orders,
 *    two invoices and two charges. The busy flag now covers the request itself.
 *  • The `type="number"` quantity input became a −/+ stepper, matching
 *    `add-to-cart.tsx`. Native spinners are far below the 44px touch floor.
 *  • Lines that cannot be ordered are visually separated from lines that can,
 *    rather than explained in red text under an otherwise normal-looking row.
 *  • Delivery location is only pre-selected when the campus has exactly one.
 *    Silently defaulting to the first of several sends food to the wrong hostel,
 *    and the student would not notice until it arrived somewhere else.
 *  • The phone number is validated inline against the same shape the server
 *    enforces, so the error arrives before the order is attempted.
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

/**
 * Mirrors `contactPhoneSchema` in validations/order.ts. The server remains the
 * authority — this only saves a round trip on an obviously wrong number.
 */
function phoneError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "We need a number the agent can call.";
  if (trimmed.length < 7) return "That number looks too short.";
  if (!/^\+?[0-9\s-]+$/.test(trimmed)) return "Use digits only, with an optional +234 prefix.";
  return null;
}

export function CartManager({ cart: initialCart, locations }: Props) {
  const router = useRouter();
  const toast = useToast();

  const [cart, setCart] = React.useState(initialCart);
  const [busyItemId, setBusyItemId] = React.useState<string | null>(null);
  const [isPlacing, setIsPlacing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Pre-selected only when there is no choice to get wrong.
  const [locationId, setLocationId] = React.useState(
    locations.length === 1 ? (locations[0]?.id ?? "") : "",
  );
  const [deliveryNote, setDeliveryNote] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [phoneTouched, setPhoneTouched] = React.useState(false);

  const phoneProblem = phoneError(contactPhone);
  const blockedLines = cart.vendors.flatMap((vendor) =>
    vendor.items.filter((item) => !item.isOrderable),
  );

  /** Runs a cart mutation and adopts the server's version of the cart. */
  async function mutate(itemId: string, action: () => Promise<{ cart: CartView }>) {
    setError(null);
    setBusyItemId(itemId);
    try {
      const result = await action();
      setCart(result.cart);
      router.refresh(); // keeps the header's cart count honest
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusyItemId(null);
    }
  }

  async function placeOrder() {
    if (isPlacing) return; // belt and braces alongside the disabled attribute
    setError(null);
    setIsPlacing(true);
    try {
      const { order } = await apiPost<{ order: { id: string } }>("/api/orders", {
        deliveryLocationId: locationId,
        deliveryNote: deliveryNote.trim() === "" ? undefined : deliveryNote.trim(),
        contactPhone: contactPhone.trim(),
      });
      toast.success("Order placed");
      router.push(`/orders/${order.id}`);
      // Intentionally not clearing `isPlacing`: the button stays busy until the
      // new route takes over, so the last frame before navigation cannot be
      // tapped again.
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
      setIsPlacing(false);
    }
  }

  if (cart.vendors.length === 0) {
    return (
      <BrowseMarketplaceEmpty
        title="Your cart is empty"
        description="Discover something good on campus."
      />
    );
  }

  const canPlaceOrder =
    cart.isCheckoutReady && locationId !== "" && phoneProblem === null && !isPlacing;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="space-y-4">
        {error ? (
          <Notice tone="danger" title="That didn't work">
            {error}
          </Notice>
        ) : null}

        {blockedLines.length > 0 ? (
          <Notice tone="warning" title="Some items can't be ordered right now">
            Remove them, or come back when they’re available. The rest of your cart is fine.
          </Notice>
        ) : null}

        {cart.vendors.map((vendor) => (
          <Card key={vendor.vendorProfileId} flush>
            <div className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3 sm:px-5">
              <Link
                href={`/store/${vendor.vendorProfileId}`}
                className="min-w-0 truncate font-medium text-ink hover:text-brand-700"
              >
                {vendor.storeName}
              </Link>
              <span className="shrink-0 font-mono text-sm tabular-nums text-ink-2">
                {formatKobo(vendor.goodsSubtotalKobo)}
              </span>
            </div>

            <ul className="divide-y divide-rule">
              {vendor.items.map((item) => {
                const isBusy = busyItemId === item.id;
                const atStockCeiling = item.quantity >= item.stockQuantity;

                return (
                  <li
                    key={item.id}
                    className={cn(
                      "px-4 py-4 sm:px-5",
                      item.isOrderable ? null : "bg-warning-soft/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{item.productName}</p>
                        <p className="mt-0.5 text-sm text-ink-3">
                          <span className="font-mono tabular-nums">
                            {formatKobo(item.unitPriceKobo)}
                          </span>
                          {item.unitLabel ? ` per ${item.unitLabel}` : null}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-sm font-medium tabular-nums text-ink">
                        {formatKobo(item.lineTotalKobo)}
                      </p>
                    </div>

                    {item.unorderableReason ? (
                      <p className="mt-2 text-sm font-medium text-warning-strong">
                        {item.unorderableReason}
                      </p>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1 rounded-control border border-rule-2 bg-surface p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reduce ${item.productName} quantity`}
                          disabled={isBusy || item.quantity <= 1}
                          onClick={() =>
                            void mutate(item.id, () =>
                              apiPatch<{ cart: CartView }>(`/api/cart/items/${item.id}`, {
                                quantity: item.quantity - 1,
                              }),
                            )
                          }
                        >
                          <span aria-hidden>−</span>
                        </Button>

                        <span
                          className="min-w-10 text-center font-mono text-sm tabular-nums"
                          aria-live="polite"
                          aria-label={`Quantity: ${item.quantity}`}
                        >
                          {item.quantity}
                        </span>

                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Increase ${item.productName} quantity`}
                          disabled={isBusy || atStockCeiling}
                          onClick={() =>
                            void mutate(item.id, () =>
                              apiPatch<{ cart: CartView }>(`/api/cart/items/${item.id}`, {
                                quantity: item.quantity + 1,
                              }),
                            )
                          }
                        >
                          <span aria-hidden>+</span>
                        </Button>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        isLoading={isBusy}
                        onClick={() =>
                          void mutate(item.id, () =>
                            apiDelete<{ cart: CartView }>(`/api/cart/items/${item.id}`),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>

                    {atStockCeiling && item.isOrderable ? (
                      <p className="mt-2 text-xs text-ink-3">
                        That’s all {vendor.storeName} has left.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20">
        <Card>
          <CardTitle className="text-base">Order summary</CardTitle>

          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-2">
                Items{cart.itemCount > 0 ? ` (${cart.itemCount})` : null}
              </dt>
              <dd className="font-mono tabular-nums">{formatKobo(cart.goodsSubtotalKobo)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-2">Delivery</dt>
              <dd className="text-ink-3">Calculated at checkout</dd>
            </div>
          </dl>

          <p className="mt-3 border-t border-rule pt-3 text-sm text-ink-3">
            Your delivery fee depends on where this is going. You’ll see the full total on your
            invoice before you pay.
          </p>
        </Card>

        <Card>
          <CardTitle className="text-base">Where should this go?</CardTitle>

          {locations.length === 0 ? (
            <Notice tone="warning" className="mt-3">
              Your campus has no delivery locations yet. Ask your campus admin to add one — orders
              can’t be placed until then.
            </Notice>
          ) : (
            <div className="mt-4 space-y-4">
              <Field id="delivery-location" label="Delivery location">
                <Select
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  {locations.length === 1 ? null : (
                    <option value="">Choose a location</option>
                  )}
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                id="delivery-note"
                label="Room, flat or landmark"
                optional
                hint={`${deliveryNote.length}/300`}
              >
                <Textarea
                  rows={2}
                  maxLength={300}
                  value={deliveryNote}
                  placeholder="Block B, Room 204"
                  onChange={(event) => setDeliveryNote(event.target.value)}
                />
              </Field>

              <Field
                id="contact-phone"
                label="Phone number"
                hint="The delivery agent calls this when they arrive."
                error={phoneTouched && phoneProblem ? phoneProblem : undefined}
              >
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={contactPhone}
                  placeholder="0803 000 0000"
                  onBlur={() => setPhoneTouched(true)}
                  onChange={(event) => setContactPhone(event.target.value)}
                />
              </Field>

              <Button
                size="lg"
                block
                isLoading={isPlacing}
                loadingLabel="Placing order…"
                disabled={!canPlaceOrder}
                onClick={() => {
                  setPhoneTouched(true);
                  if (canPlaceOrder) void placeOrder();
                }}
              >
                Place order
              </Button>

              {!cart.isCheckoutReady ? (
                <p className="text-sm text-warning-strong">
                  Remove the flagged items above before placing this order.
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

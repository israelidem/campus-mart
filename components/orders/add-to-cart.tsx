"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiClientError, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Add to cart (PRD §25).
 *
 * The quantity here is a request, not a decision: the server re-checks stock,
 * store approval and campus before it accepts, and its refusal is what the
 * student is shown. The UI never looks like it is the authority.
 *
 * What changed in the redesign, and why — the network call itself was already
 * correct and is untouched:
 *
 *  • The number input became a −/+ stepper. A bare `type="number"` on a phone
 *    opens the numeric keyboard to change "1" to "2", and its spinners are far
 *    below the 44px touch floor. Two buttons are one tap each.
 *  • Success is a toast with a "View cart" action instead of a line of text that
 *    appears under the fold. Adding to a cart is a step on the way somewhere,
 *    so the confirmation carries the next step with it.
 *  • `router.refresh()` after a successful add re-runs the server component, so
 *    the header cart count and any stock figure update. Without it the page
 *    kept asserting the pre-add state and the student saw a stale cart.
 *  • The stepper is capped at `stockQuantity` when known, so the common failure
 *    is prevented rather than explained after a round trip.
 *  • `closedReason` renders the store-closed / sold-out case as disabled state
 *    with a reason, replacing the old bare "Out of stock right now." — the
 *    student can still read the page and reach the store.
 */
export function AddToCartButton({
  productId,
  inStock,
  /** Hard ceiling for the stepper. Omit when the screen does not know it. */
  maxQuantity,
  /**
   * Set when the product cannot be ordered for a reason other than stock, e.g.
   * the store is closed. Shown instead of the controls.
   */
  closedReason,
  /** Renders full width, for the sticky mobile bar. */
  block = false,
  className,
}: {
  productId: string;
  inStock: boolean;
  maxQuantity?: number;
  closedReason?: string | null;
  block?: boolean;
  className?: string;
}) {
  const [quantity, setQuantity] = React.useState(1);
  const [isBusy, setIsBusy] = React.useState(false);
  const router = useRouter();
  const toast = useToast();

  // A ceiling of at least 1 keeps the stepper coherent when stock is unknown.
  const ceiling = Math.max(1, maxQuantity ?? Number.MAX_SAFE_INTEGER);

  async function add() {
    // Guard against a double tap landing two POSTs: the button is disabled
    // while busy, but a fast double-tap can fire before React re-renders.
    if (isBusy) return;

    setIsBusy(true);
    try {
      await apiPost("/api/cart", { productId, quantity });

      toast.success(quantity === 1 ? "Added to your cart" : `${quantity} added to your cart`, {
        label: "View cart",
        onClick: () => router.push("/cart"),
      });

      // The server owns the cart, so re-read it rather than guessing locally.
      router.refresh();
      setQuantity(1);
    } catch (caught) {
      // The server's message is the useful one ("Only 3 left in stock"), so it
      // is shown verbatim; the fallback covers a dropped connection.
      toast.error(
        caught instanceof ApiClientError
          ? caught.message
          : "Could not reach Campus Mart. Check your connection and try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  const unavailable = !inStock || Boolean(closedReason);

  if (unavailable) {
    return (
      <div className={cn("space-y-2", className)}>
        <Button variant="secondary" disabled block={block}>
          {inStock ? "Store closed" : "Sold out"}
        </Button>
        <p className="text-xs text-ink-2">
          {closedReason ??
            "This item is out of stock. Try another store, or check back later."}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2.5", block && "w-full", className)}>
      {/* A labelled group, so a screen reader announces what the −/+ change. */}
      <div
        role="group"
        aria-label="Quantity"
        className="flex h-11 shrink-0 items-center rounded-control border border-rule-2 bg-surface"
      >
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-l-control text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={() => setQuantity((current) => Math.max(1, current - 1))}
          disabled={quantity <= 1 || isBusy}
          aria-label="Reduce quantity"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5.5 10h9" strokeLinecap="round" />
          </svg>
        </button>

        {/*
          A live region rather than an input: the value only ever changes via the
          two buttons, so a focusable field would be a tab stop that does nothing
          while still opening a keyboard on mobile.
        */}
        <span
          aria-live="polite"
          className="tabular w-8 text-center font-mono text-sm font-medium text-ink"
        >
          {quantity}
        </span>

        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-r-control text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={() => setQuantity((current) => Math.min(ceiling, current + 1))}
          disabled={quantity >= ceiling || isBusy}
          aria-label="Increase quantity"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 5.5v9M5.5 10h9" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <Button
        isLoading={isBusy}
        loadingLabel="Adding…"
        onClick={() => void add()}
        className="flex-1"
      >
        Add to cart
      </Button>
    </div>
  );
}

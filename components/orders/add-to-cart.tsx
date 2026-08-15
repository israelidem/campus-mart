"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiClientError, apiPost } from "@/lib/api/client";

/**
 * Add to cart (PRD §25).
 *
 * The quantity here is a request, not a decision: the server re-checks stock,
 * store approval and campus before it accepts, and its refusal is what the
 * student is shown. Buttons are only hidden for the obvious case (out of stock)
 * so the UI never looks like it is the authority.
 */
export function AddToCartButton({
  productId,
  inStock,
}: {
  productId: string;
  inStock: boolean;
}) {
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function add() {
    setError(null);
    setIsBusy(true);
    try {
      await apiPost("/api/cart", { productId, quantity });

      setAdded(true);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  if (!inStock) {
    return <p className="text-sm opacity-70">Out of stock right now.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-sm" htmlFor="add-quantity">
          Quantity
        </label>
        <input
          id="add-quantity"
          type="number"
          inputMode="numeric"
          min={1}
          value={quantity}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isInteger(next) && next >= 1) setQuantity(next);
          }}
          className="h-11 w-20 rounded-xl border border-current/20 px-2 text-sm"
        />
        <Button isLoading={isBusy} onClick={() => void add()}>
          Add to cart
        </Button>
      </div>

      {added ? (
        <p className="text-sm" role="status">
          Added.{" "}
          <Link href="/cart" className="underline">
            Go to your cart
          </Link>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

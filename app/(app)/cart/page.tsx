import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CartManager } from "@/components/orders/cart-manager";
import { ButtonLink } from "@/components/ui/button";
import { GateState } from "@/components/ui/state";
import { ForbiddenError } from "@/lib/errors";
import { getActor } from "@/lib/auth/session";
import { getCart } from "@/lib/orders/cart-service";
import { listDeliveryLocations } from "@/lib/orders/delivery-location-service";
import { logger } from "@/lib/logger";

export const metadata: Metadata = { title: "Your cart" };

/**
 * The student's cart (PRD §25).
 *
 * Rendered on the server so the first paint already carries server prices; a
 * student whose verification is not approved is told why rather than shown a
 * checkout the API would refuse.
 *
 * One correction made during the UI pass: the previous `catch {}` treated *every*
 * failure as "you are not approved to shop". A database blip, a dropped
 * connection or a genuine bug would all have told a fully verified student that
 * their account was the problem — sending them to their campus admin over an
 * outage. Only an authorization refusal now produces that message; anything else
 * is logged and re-thrown so `app/error.tsx` can offer a retry (§23).
 */
export default async function CartPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  let cart;
  let locations;
  try {
    [cart, locations] = await Promise.all([getCart(actor), listDeliveryLocations(actor)]);
  } catch (caught) {
    if (caught instanceof ForbiddenError) {
      return (
        <GateState
          title="Shopping opens once you're verified"
          description="Only students with an approved campus verification can order. Finish your details, or wait for your campus admin to review them."
          action={
            <ButtonLink href="/student/onboarding" variant="outline">
              Check my verification
            </ButtonLink>
          }
        />
      );
    }
    logger.error("cart page failed to load", { err: caught, userId: actor.userId });
    throw caught;
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Your cart</h1>
        <p className="text-sm text-ink-3">
          Items from different stores are delivered together on one invoice.
        </p>
      </header>

      <CartManager
        cart={cart}
        locations={locations.map((location) => ({
          id: location.id,
          name: location.name,
          description: location.description,
        }))}
      />
    </section>
  );
}

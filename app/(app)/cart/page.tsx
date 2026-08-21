import { redirect } from "next/navigation";

import { CartManager } from "@/components/orders/cart-manager";
import { Card } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";
import { getCart } from "@/lib/orders/cart-service";
import { listDeliveryLocations } from "@/lib/orders/delivery-location-service";

/**
 * The student's cart (PRD §25).
 *
 * Rendered on the server so the first paint already carries server prices; a
 * student whose verification is not approved is told why rather than shown a
 * checkout the API would refuse.
 */
export default async function CartPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  let cart;
  let locations;
  try {
    [cart, locations] = await Promise.all([getCart(actor), listDeliveryLocations(actor)]);
  } catch {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Your cart</h1>
        <Card>
          <p className="text-sm">
            Only students with an approved verification can shop. Finish your onboarding, or wait for
            your campus admin to review it.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Your cart</h1>
        <p className="text-sm opacity-70">
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

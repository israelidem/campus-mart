import { redirect } from "next/navigation";

import { DeliveryLocationManager } from "@/components/admin/delivery-location-manager";
import { getActor } from "@/lib/auth/session";
import { listDeliveryLocations } from "@/lib/orders/delivery-location-service";

/**
 * Campus Admin delivery locations (PRD §28).
 *
 * Inactive locations are shown here — and only here — so an admin can see what
 * they have retired without students being offered it at checkout.
 */
export default async function DeliveryLocationsPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "CAMPUS_ADMIN" && actor.role !== "SUPER_ADMIN") redirect("/after-sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  const locations = await listDeliveryLocations(actor, { includeInactive: true });

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Delivery locations</h1>
        <p className="text-sm opacity-70">
          Students choose one of these at checkout. The delivery fee is calculated from the distance
          between the campus and the location.
        </p>
      </header>

      <DeliveryLocationManager
        locations={locations.map((location) => ({
          id: location.id,
          name: location.name,
          description: location.description,
          latitude: location.latitude,
          longitude: location.longitude,
          isActive: location.isActive,
        }))}
      />
    </section>
  );
}

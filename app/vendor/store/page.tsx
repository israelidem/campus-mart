import { redirect } from "next/navigation";

import { StoreManager, type StoreView } from "@/components/vendors/store-manager";
import { getActor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getVendorState } from "@/lib/vendors/vendor-service";

/**
 * Vendor application and store management (PRD §17, §19, §23).
 *
 * Administrators are redirected away: an admin who could open a store on their
 * own campus would be their own approver.
 */
export default async function VendorStorePage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role === "CAMPUS_ADMIN" || actor.role === "SUPER_ADMIN") redirect("/after-sign-in");
  if (!actor.campusId) redirect("/after-sign-in");

  const [state, studentProfile] = await Promise.all([
    getVendorState(actor),
    prisma.studentProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    }),
  ]);

  const store: StoreView = {
    status: state.status,
    storeName: state.storeName,
    description: state.description,
    phone: state.phone,
    storefrontLocation: state.storefrontLocation,
    acceptingOrders: state.acceptingOrders,
    isOpenNow: state.isOpenNow,
    reviewNote: state.reviewNote,
    operatingHours: state.operatingHours,
    studentVendorsAllowed: state.studentVendorsAllowed,
    isStudent: studentProfile !== null,
  };

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Your store</h1>
        <p className="text-sm opacity-70">
          Apply once, then manage your store details and opening hours here.
        </p>
      </header>

      <StoreManager store={store} />
    </section>
  );
}

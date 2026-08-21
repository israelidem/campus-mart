import { redirect } from "next/navigation";

import { getActor } from "@/lib/auth/session";
import { getVendorState } from "@/lib/vendors/vendor-service";

/**
 * `/vendor` — the seller entry point.
 *
 * This page did not exist, yet `after-sign-in` redirected every VENDOR account
 * here: signing in as a vendor produced a 404. It resolves to the screen that is
 * useful for the state the vendor is actually in, rather than picking one and
 * being wrong half the time.
 */
export default async function VendorHomePage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in?next=/vendor");

  const state = await getVendorState(actor);

  // An approved vendor wants the order queue; anyone else needs the application
  // and its status, which is what the store screen shows.
  redirect(state.status === "APPROVED" ? "/vendor/orders" : "/vendor/store");
}

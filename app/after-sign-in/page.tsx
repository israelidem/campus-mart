import { redirect } from "next/navigation";

import { getActor } from "@/lib/auth/session";

/**
 * Post-sign-in router. The destination is decided on the server from the
 * database-resolved role, so a client cannot route itself into an area it is
 * not entitled to (the destination pages enforce their own access as well).
 */
export default async function AfterSignInPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  if (actor.isSuspended) redirect("/suspended");

  switch (actor.role) {
    case "SUPER_ADMIN":
      redirect("/super-admin/campuses");

    case "CAMPUS_ADMIN":
      redirect("/admin/students");
    case "VENDOR":
      redirect("/vendor");
    case "DELIVERY_AGENT":
      redirect("/agent");
    case "STUDENT":
    default:
      redirect("/student/onboarding");
  }
}

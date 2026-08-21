import { redirect } from "next/navigation";

import { getActor } from "@/lib/auth/session";
import { resolveShellContext } from "@/lib/navigation/capabilities";
import { homeHref } from "@/lib/navigation/navigation";

/**
 * Post-sign-in router. The destination is decided on the server from the
 * database-resolved role, so a client cannot route itself into an area it is
 * not entitled to (the destination pages enforce their own access as well).
 *
 * The destination now comes from the same navigation model that draws the shell,
 * rather than a second `switch` that could disagree with it. It did disagree: the
 * old switch sent every VENDOR to `/vendor`, which had no page, and every student
 * to onboarding even when they were long since approved.
 */
export default async function AfterSignInPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  if (actor.isSuspended) redirect("/suspended");

  const { capabilities } = await resolveShellContext(actor);

  // The first primary destination is by definition the most useful thing this
  // person can do, so it is also the right place to land.
  redirect(homeHref(capabilities));
}

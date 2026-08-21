import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Account suspended",
};

/**
 * `/suspended` — where a suspended account is sent.
 *
 * `after-sign-in` has redirected here since Phase 1, but the page was never
 * written: a suspended user signing in got a 404, which reads as "the app is
 * broken" rather than "your account was stopped". Someone who has lost access
 * needs to know it was a decision, and who can undo it.
 *
 * Deliberately outside the (app) shell. A suspended account cannot transact, so
 * wrapping this in navigation would offer a marketplace that every API underneath
 * will refuse.
 */
export default async function SuspendedPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");

  // Not suspended after all — the state is re-read from the database on every
  // request, so an account that has been restored should not be held here.
  if (!actor.isSuspended) redirect("/after-sign-in");

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>This account is suspended</CardTitle>
          <CardDescription>
            {actor.campusId
              ? "Your campus admin has suspended this account, so it cannot buy, sell or deliver for now."
              : "This account has been suspended by the platform team."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-ink-2">
          <p>
            Orders and payments that were already completed are unaffected and remain on record.
          </p>
          <p>
            If you believe this is a mistake, contact your campus admin. Suspensions are recorded
            with a reason and can be lifted by the admin who applied it.
          </p>
          <p className="font-mono text-xs">{actor.email}</p>
        </CardContent>
      </Card>
    </main>
  );
}

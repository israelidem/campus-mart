import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";

export default async function HomePage() {
  const actor = await getActor();

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-10">
      <header className="pt-6">
        <p className="text-sm font-medium text-brand-600">Campus Mart</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Your campus marketplace, delivered.
        </h1>
        <p className="mt-2 text-sm opacity-70">
          Order from approved vendors on your campus. Verified student agents deliver, you confirm
          with an OTP, and you only pay for goods once they arrive.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{actor ? `Signed in as ${actor.name}` : "Get started"}</CardTitle>
          <CardDescription>
            {actor
              ? "Continue where your role belongs on this campus."
              : "Create an account to begin campus verification."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {actor ? (
              // The destination is resolved server-side from the stored role, so
              // this link cannot be used to reach an area the actor lacks.
              <Link href="/after-sign-in" className="w-full sm:w-auto">
                <Button>Continue</Button>
              </Link>
            ) : (

              <>
                <Link href="/sign-up" className="w-full sm:w-auto">
                  <Button>Create account</Button>
                </Link>
                <Link href="/sign-in" className="w-full sm:w-auto">
                  <Button variant="outline">Sign in</Button>
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build status</CardTitle>
          <CardDescription>
            Campus Mart is being delivered phase by phase, per the product specification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li>✅ Phase 0 — foundation: database, authentication, logging, base UI</li>
            <li>✅ Phase 1 — student registration, verification &amp; document uploads</li>
            <li>✅ Phase 2 — campus management, admin roles, campus isolation</li>
            <li>✅ Phase 3 — vendor applications, review queue &amp; storefronts</li>
            <li>✅ Phase 4 — marketplace: products, inventory, search &amp; filters</li>
            <li>⏳ Phase 5 — cart &amp; checkout, delivery fees</li>
            <li>⏳ Phase 6+ — delivery engine, OTP, payments, ratings</li>

          </ul>
        </CardContent>
      </Card>
    </main>
  );
}

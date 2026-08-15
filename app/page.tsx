import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";
import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * Landing page and progress index.
 *
 * Doubles as a map of everything that has actually been built, so the link can be
 * shared and walked through. It lists destinations, it does not grant access: each
 * page still resolves the actor server-side and redirects if the role or campus is
 * wrong, so an entry appearing here is never a way in.
 */

type Destination = {
  href: string;
  label: string;
  description: string;
  /** Roles that can open it. `undefined` means anyone signed in. */
  roles?: UserRole[];
};

type Area = {
  title: string;
  description: string;
  destinations: Destination[];
};

const AREAS: Area[] = [
  {
    title: "Shopping",
    description: "What a verified student on a campus can do today.",
    destinations: [
      {
        href: "/marketplace",
        label: "Marketplace",
        description: "Browse approved vendors' products. Search, filter by category and price, sort.",
      },
      {
        href: "/cart",
        label: "Cart & checkout",
        description:
          "One cart across several vendors. Choose a delivery location and place the order.",
      },
      {
        href: "/orders",
        label: "My orders",
        description: "Invoices, per-vendor totals, delivery fee, and cancellation while unpaid.",
      },
    ],
  },
  {
    title: "Selling",
    description: "Vendor tools. Applying is open to any verified student.",
    destinations: [
      {
        href: "/vendor/store",
        label: "Store",
        description: "Apply to sell, upload storefront evidence, set operating hours.",
      },
      {
        href: "/vendor/products",
        label: "Products",
        description: "Create products, set prices in naira, upload photos, adjust stock.",
      },
      {
        href: "/vendor/orders",
        label: "Incoming orders",
        description: "Accept, prepare and mark orders ready for pickup. Payout is shown per order.",
      },
    ],
  },
  {
    title: "Campus administration",
    description: "Campus Admin only. Everything is scoped to that admin's campus.",
    destinations: [
      {
        href: "/admin/students",
        label: "Students",
        description: "Review registrations against the student registry and verify or reject.",
        roles: ["CAMPUS_ADMIN", "SUPER_ADMIN"],
      },
      {
        href: "/admin/vendors",
        label: "Vendors",
        description: "Vendor review queue, approvals, suspension and reinstatement.",
        roles: ["CAMPUS_ADMIN", "SUPER_ADMIN"],
      },
      {
        href: "/admin/delivery-locations",
        label: "Delivery locations",
        description: "Curate the destinations students can choose at checkout.",
        roles: ["CAMPUS_ADMIN", "SUPER_ADMIN"],
      },
      {
        href: "/admin/settings",
        label: "Campus settings",
        description: "Commission, delivery fee base and per-kilometre rate, fee floor and cap.",
        roles: ["CAMPUS_ADMIN", "SUPER_ADMIN"],
      },
    ],
  },
  {
    title: "Platform",
    description: "Owner-level. Campuses are created here before anyone can register.",
    destinations: [
      {
        href: "/super-admin/campuses",
        label: "Campuses",
        description: "Create campuses, assign campus admins, activate or suspend a campus.",
        roles: ["SUPER_ADMIN"],
      },
    ],
  },
];

const PHASES: { label: string; done: boolean }[] = [
  { label: "Phase 0 — foundation: database, authentication, logging, base UI", done: true },
  { label: "Phase 1 — student registration, verification & document uploads", done: true },
  { label: "Phase 2 — campus management, admin roles, campus isolation", done: true },
  { label: "Phase 3 — vendor applications, review queue & storefronts", done: true },
  { label: "Phase 4 — marketplace: products, inventory, search & filters", done: true },
  { label: "Phase 5 — multi-vendor cart, checkout, invoices & delivery fees", done: true },
  { label: "Phase 6 — delivery engine: pool, assignment, pickup rules", done: false },
  { label: "Phase 7+ — delivery OTP, Paystack payments, notifications, ratings", done: false },
];

function roleLabel(role: UserRole): string {
  if (role === "CAMPUS_ADMIN") return "Campus Admin";
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "VENDOR") return "Vendor";
  return "Student";
}

export default async function HomePage() {
  const actor = await getActor();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 pb-12">
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
              ? `${roleLabel(actor.role)} on this campus. Continue where your role belongs.`

              : "Create an account to begin campus verification, or sign in if you already have one."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {actor ? (
              <>
                {/* The destination is resolved server-side from the stored role, so
                    this link cannot be used to reach an area the actor lacks. */}
                <Link href="/after-sign-in">
                  <Button>Continue</Button>
                </Link>
                <Link href="/marketplace">
                  <Button variant="outline">Browse the marketplace</Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/sign-up">
                  <Button>Create account</Button>
                </Link>
                <Link href="/sign-in">
                  <Button variant="outline">Sign in</Button>
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">What is live</h2>
          <p className="mt-1 text-sm opacity-70">
            Every page below is built and working. Signing in is required, and each one checks your
            role and campus on the server — so admin links will turn you away unless you are one.
          </p>
        </div>

        {AREAS.map((area) => (
          <Card key={area.title}>
            <CardHeader>
              <CardTitle>{area.title}</CardTitle>
              <CardDescription>{area.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {area.destinations.map((destination) => (
                  <li key={destination.href} className="border-t border-current/10 pt-3 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={destination.href} className="font-medium underline">
                        {destination.label}
                      </Link>
                      {destination.roles ? (
                        <span className="text-xs opacity-60">
                          {destination.roles.map(roleLabel).join(" or ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm opacity-70">{destination.description}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Build status</CardTitle>
          <CardDescription>
            Campus Mart is being delivered phase by phase, per the product specification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {PHASES.map((phase) => (
              <li key={phase.label}>
                <span aria-hidden="true">{phase.done ? "✅" : "⏳"}</span>{" "}
                <span className={phase.done ? undefined : "opacity-70"}>{phase.label}</span>
                <span className="sr-only">{phase.done ? " (done)" : " (not started)"}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <footer className="text-sm opacity-60">
        <p>
          Money is never held by Campus Mart — payments settle through Paystack from Phase 8. Prices,
          stock and campus boundaries are decided by the server, never the browser.
        </p>
      </footer>
    </main>
  );
}

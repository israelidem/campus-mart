import Link from "next/link";
import { redirect } from "next/navigation";

import { getActor } from "@/lib/auth/session";

/**
 * Shell for platform-owner screens. The role check lives here so every page
 * under /super-admin is gated even if a new page forgets to check.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "SUPER_ADMIN") redirect("/after-sign-in");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href="/" className="text-lg font-semibold">
          Campus Mart
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link className="underline" href="/super-admin/campuses">
            Campuses
          </Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

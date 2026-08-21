import Link from "next/link";

import { NotificationMenu } from "@/components/notifications/notification-menu";
import { AccountMenu } from "@/components/shell/account-menu";
import { PrimaryNav } from "@/components/shell/primary-nav";
import { getActor } from "@/lib/auth/session";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { resolveShellContext } from "@/lib/navigation/capabilities";
import { buildNavigation, homeHref } from "@/lib/navigation/navigation";

/**
 * The application shell: one header, one navigation, every page.
 *
 * This replaces five per-folder layouts that each hardcoded their own subset of
 * links and their own max-width. That arrangement is what made the deployed app
 * unusable without typing URLs — the student shell had no links at all — and it
 * meant a screen added in a new phase was reachable only from whichever shell its
 * author happened to edit.
 *
 * Rendered on the server so the first byte of HTML already has the right links
 * for the right person. It offers destinations; it does not grant access. Every
 * page underneath still resolves the actor and refuses the wrong role (Rule 29).
 */

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  CAMPUS_ADMIN: "Campus Admin",
  VENDOR: "Vendor",
  DELIVERY_AGENT: "Delivery Agent",
  STUDENT: "Student",
};

export async function AppShell({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  // Signed out: the wordmark is the only honest control. No nav, because there
  // is nothing behind it, and no account menu for an account that isn't there.
  if (!actor) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="border-b border-rule">
          <div className="mx-auto flex h-16 w-full max-w-screen-lg items-center justify-between px-4">
            <Link href="/" className="font-display text-lg text-ink">
              Campus Mart
            </Link>
            <Link
              href="/sign-in"
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
            >
              Sign in
            </Link>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    );
  }

  const { capabilities, campusName, campusCode } = await resolveShellContext(actor);
  const nav = buildNavigation(capabilities);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-screen-lg items-center gap-3 px-4">
          <Link href={homeHref(capabilities)} className="flex items-baseline gap-2">
            <span className="font-display text-lg text-ink">Campus Mart</span>
            {/*
              The campus is part of the identity of the page, not decoration: the
              whole product is one campus at a time, and an admin acting on the
              wrong campus is the expensive mistake. A Super Admin sees no campus
              because they belong to none.
            */}
            {campusCode ? (
              <span
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2"
                title={campusName ?? undefined}
              >
                {campusCode}
              </span>
            ) : null}
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <PrimaryNav items={nav.primary} variant="row" />
            <NotificationMenu />
            <AccountMenu
              name={actor.name}
              email={actor.email}
              roleLabel={ROLE_LABELS[actor.role]}
              groups={nav.groups}
            />
          </div>
        </div>
      </header>

      {/*
        The bottom padding clears the fixed phone nav bar. Without it the last
        control on a long page sits underneath the bar and cannot be tapped —
        which on a checkout screen is the button that matters most.
      */}
      <div className="mx-auto flex w-full max-w-screen-lg flex-1 flex-col px-4 pb-24 pt-6 md:pb-10">
        {children}
      </div>

      <PrimaryNav items={nav.primary} variant="bar" />
    </div>
  );
}

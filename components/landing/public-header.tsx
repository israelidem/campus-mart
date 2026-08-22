"use client";

import Link from "next/link";
import * as React from "react";

import { ButtonLink } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Wordmark } from "@/components/shell/wordmark";

/**
 * Header for the public site.
 *
 * Separate from the signed-in app shell on purpose: a visitor needs marketing
 * navigation and two clear entry points, not the app's tab bar. On mobile the
 * secondary links move into a sheet, which is the same overlay primitive the
 * rest of the product uses — the "Sign in" action stays visible in the bar
 * rather than being buried in a menu, because it is the reason most returning
 * students open this page.
 */
export function PublicHeader() {
  const [menuOpen, setMenuOpen] = React.useState(false);

  const links = [
    { href: "#how-it-works", label: "How it works" },
    { href: "#categories", label: "What you can buy" },
    { href: "#delivery", label: "Delivery" },
    { href: "#trust", label: "Trust & safety" },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="shrink-0" aria-label="Campus Mart home">
            <Wordmark />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <ButtonLink href="/sign-in" variant="ghost" size="sm" className="hidden sm:inline-flex">
              Sign in
            </ButtonLink>
            <ButtonLink href="/sign-up" size="sm">
              Get started
            </ButtonLink>

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="flex size-10 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-sunken md:hidden"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Campus Mart">
        <nav aria-label="Mobile" className="space-y-1 pb-2">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-[3rem] items-center rounded-control px-3 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-sunken"
            >
              {link.label}
            </a>
          ))}

          <div className="!mt-4 space-y-2 border-t border-rule pt-4">
            <ButtonLink href="/sign-in" variant="outline" className="w-full">
              Sign in
            </ButtonLink>
            <ButtonLink href="/sign-up" className="w-full">
              Create an account
            </ButtonLink>
          </div>
        </nav>
      </Sheet>
    </>
  );
}

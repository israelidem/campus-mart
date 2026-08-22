"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "@/lib/hooks/browser";
import { Sheet } from "@/components/ui/sheet";
import { signOut } from "@/lib/auth/client";
import type { Navigation } from "@/lib/navigation/navigation";
import { cn } from "@/lib/utils";

/**
 * The account menu.
 *
 * The previous implementation was a single `absolute right-0 w-72` dropdown
 * containing every navigation group, rendered identically at every width. On a
 * 375px phone that is a panel taller than the viewport, anchored to the top-right
 * corner, with its own inner scroll container fighting the page's — the exact
 * failure in the screenshot referenced by §6.
 *
 * The fix is not to shrink it. A phone and a desktop want different objects:
 *
 *  • **Phone** → a bottom sheet. It is thumb-reachable, it is a familiar mobile
 *    pattern, it can be dismissed by tapping away, and `Sheet` already handles
 *    the scroll lock, focus trap, Escape key and `env(safe-area-inset-bottom)`
 *    padding so content never sits under the home indicator.
 *  • **Desktop** → a compact dropdown, anchored under the avatar, where a
 *    pointer already is.
 *
 * Both render from the same `groups` data, so nothing can drift between them.
 * The breakpoint is resolved with a media query rather than CSS visibility,
 * because rendering both and hiding one would put two dialogs and two focus
 * traps in the DOM at once.
 */
export function AccountMenu({
  name,
  email,
  roleLabel,
  groups,
}: {
  name: string;
  email: string;
  roleLabel: string;
  groups: Navigation["groups"];
}) {
  const [open, setOpen] = useState(false);
  const [isSigningOut, setSigningOut] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  // Matches Tailwind's `md`, and stays subscribed, so rotating a tablet
  // mid-session swaps the presentation rather than leaving a dropdown stranded
  // at phone width.
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Outside-click and Escape for the *desktop dropdown only*. The mobile sheet
  // owns its own dismissal; wiring both would close the sheet twice.
  useEffect(() => {
    if (!open || !isDesktop) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, isDesktop]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // Leave regardless. A failed sign-out call must not strand someone in a
      // session they have asked to end; the cookie is cleared server-side and
      // the refresh below re-resolves it either way.
      router.push("/");
      router.refresh();
    }
  }

  const initial = (name.trim()[0] ?? email[0] ?? "?").toUpperCase();

  /** The identity block. Same content in both presentations. */
  const identity = (
    <div className="flex items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display text-base font-semibold text-brand-800">
        {initial}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[0.9375rem] font-semibold text-ink">{name}</p>
        <p className="truncate text-xs text-ink-2">{email}</p>
      </div>
    </div>
  );

  const signOutButton = (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className={cn(
        "flex min-h-[3rem] w-full items-center gap-2.5 rounded-control px-3 text-left",
        "text-[0.9375rem] font-medium text-danger transition-colors",
        "hover:bg-danger-soft disabled:opacity-60",
      )}
    >
      {isSigningOut ? (
        <span
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[1.125rem] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M12.5 6.5V4.8A1.3 1.3 0 0011.2 3.5H5.3A1.3 1.3 0 004 4.8v10.4a1.3 1.3 0 001.3 1.3h5.9a1.3 1.3 0 001.3-1.3v-1.7" strokeLinecap="round" />
          <path d="M8 10h8m0 0l-2.3-2.3M16 10l-2.3 2.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {isSigningOut ? "Signing out…" : "Sign out"}
    </button>
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${name}`}
        className={cn(
          "flex size-10 items-center justify-center rounded-full border border-rule",
          "bg-surface font-display text-sm font-semibold text-ink transition-colors",
          "hover:border-brand-300 hover:bg-brand-50",
          open && "border-brand-300 bg-brand-50",
        )}
      >
        {initial}
      </button>

      {/* ── Mobile: bottom sheet ─────────────────────────────────────────── */}
      {!isDesktop ? (
        <Sheet open={open} onClose={() => setOpen(false)} title="Account">
          <div className="space-y-4">
            <div className="rounded-card border border-rule bg-sunken/60 p-3">
              {identity}
              <p className="mt-2.5 border-t border-rule pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
                {roleLabel}
              </p>
            </div>

            {groups.map((group) => (
              <div key={group.title}>
                <p className="px-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  {group.title}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      // min-h keeps every row at a comfortable touch target even
                      // when it has no hint line.
                      className="flex min-h-[3rem] flex-col justify-center rounded-control px-3 py-2 transition-colors hover:bg-sunken"
                    >
                      <span className="text-[0.9375rem] font-medium text-ink">{item.label}</span>
                      {item.hint ? (
                        <span className="mt-0.5 text-xs text-ink-2">{item.hint}</span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            ))}

            <div className="border-t border-rule pt-3">{signOutButton}</div>
          </div>
        </Sheet>
      ) : null}

      {/* ── Desktop: anchored dropdown ───────────────────────────────────── */}
      {isDesktop && open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-50 mt-2 w-[17.5rem] origin-top-right overflow-hidden",
            "rounded-sheet border border-rule bg-surface shadow-lift",
            "animate-in",
          )}
        >
          <div className="border-b border-rule p-3">
            {identity}
            <p className="mt-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {roleLabel}
            </p>
          </div>

          {/* Capped and scrollable. On a laptop the viewport is short, and an
              admin has enough destinations to overflow it. */}
          <div className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain p-1.5">
            {groups.map((group) => (
              <div key={group.title} className="mb-1 last:mb-0">
                <p className="px-2.5 pb-0.5 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  {group.title}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-sunken"
                  >
                    <span className="block text-sm font-medium text-ink">{item.label}</span>
                    {item.hint ? (
                      <span className="block text-xs text-ink-2">{item.hint}</span>
                    ) : null}
                  </Link>
                ))}
              </div>
            ))}
          </div>

          <div className="border-t border-rule p-1.5">{signOutButton}</div>
        </div>
      ) : null}
    </div>
  );
}

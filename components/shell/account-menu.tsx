"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/lib/auth/client";
import type { Navigation } from "@/lib/navigation/navigation";
import { cn } from "@/lib/utils";

/**
 * The account menu: everything that is not a primary destination, plus sign-out.
 *
 * Sign-out did not exist anywhere in the app before this. Twelve phases shipped
 * with no way to leave an account, which on a shared phone — the normal case on
 * campus — means the next person inherits the session. That is the reason this
 * component is a client component at all.
 *
 * After signing out the router is refreshed as well as pushed. Every page here
 * reads the session on the server, so without `refresh()` the cached RSC payload
 * for the destination can still be the signed-in render.
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

  // Close on outside click and on Escape: a menu that traps the reader on a
  // phone is worse than one that is slightly too eager to close.
  useEffect(() => {
    if (!open) return;

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
  }, [open]);

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
          "bg-paper-2 font-display text-sm text-ink transition-colors hover:bg-brand-50",
        )}
      >
        {initial}
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl",
            "border border-rule bg-paper-2 shadow-lg",
          )}
        >
          <div className="border-b border-rule px-4 py-3">
            <p className="truncate font-display text-sm text-ink">{name}</p>
            <p className="truncate text-xs text-ink-2">{email}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-2">
              {roleLabel}
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {groups.map((group) => (
              <div key={group.title} className="border-b border-rule py-2 last:border-b-0">
                <p className="px-4 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-2">
                  {group.title}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block px-4 py-2 hover:bg-brand-50"
                  >
                    <span className="block text-sm text-ink">{item.label}</span>
                    {item.hint ? (
                      <span className="block text-xs text-ink-2">{item.hint}</span>
                    ) : null}
                  </Link>
                ))}
              </div>
            ))}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className={cn(
              "w-full border-t border-rule px-4 py-3 text-left text-sm",
              "text-stamp hover:bg-brand-50 disabled:opacity-60",
            )}
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActiveHref, type NavItem } from "@/lib/navigation/navigation";
import { cn } from "@/lib/utils";

/**
 * The primary destinations, rendered twice from one list: a row in the header on
 * a wide screen, a fixed bar at the bottom of a phone. Both read the same array,
 * so the two can never drift apart the way the five old shells did.
 *
 * A client component only because the active item depends on the current path.
 * The items themselves are decided on the server and passed in.
 */
export function PrimaryNav({ items, variant }: { items: NavItem[]; variant: "bar" | "row" }) {
  const pathname = usePathname();

  if (items.length === 0) return null;

  if (variant === "row") {
    return (
      <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
        {items.map((item) => {
          const active = isActiveHref(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-brand-50 text-brand-800" : "text-ink-2 hover:text-ink",
              )}
            >
              {item.label}
              {item.badge ? (
                <span className="ml-1.5 font-mono text-xs text-brand-700">{item.badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper-2/95 backdrop-blur",
        "md:hidden",
      )}
      // Keeps the last row of targets clear of the iOS home indicator.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-screen-sm items-stretch">
        {items.map((item) => {
          const active = isActiveHref(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 px-1 text-center",
                  active ? "text-brand-700" : "text-ink-2",
                )}
              >
                <span className="relative">
                  {/* Truncation is per-item so a long label cannot push a
                      neighbouring target off the row on a 320px screen. */}
                  <span className="block max-w-[4.5rem] truncate text-[11px] leading-tight">
                    {item.label}
                  </span>
                  {item.badge ? (
                    <span
                      className={cn(
                        "absolute -right-2 -top-1.5 min-w-4 rounded-full bg-brand-600 px-1",
                        "font-mono text-[10px] leading-4 text-white",
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-0.5 w-6 rounded-full",
                    active ? "bg-brand-600" : "bg-transparent",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

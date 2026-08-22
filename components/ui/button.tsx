import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The one button in Campus Mart.
 *
 * Two changes from the previous version matter beyond looks:
 *
 * 1. It no longer defaults to `w-full` on mobile. That default is why every
 *    small action — "Retry", "+", a chip-sized filter — stretched edge to edge
 *    on a phone, and it forced screens to override the primitive constantly.
 *    Full width is now opt-in via `block`, which is what a form's submit wants
 *    and nothing else does.
 * 2. `isLoading` swaps the label for a spinner *and* keeps the button's width,
 *    so a row of controls does not reflow mid-submit. Combined with the
 *    disabled state, this is the duplicate-submission guard.
 */

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  // The two "on ink" variants. A primary green button on the near-black CTA
  // panel is legible but muddy, and an `outline` button there would draw a
  // cream border against cream text. These exist so dark sections do not each
  // invent their own one-off classes.
  | "inverse"
  | "ghostInverse";

type Size = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-soft hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none",
  secondary: "bg-brand-50 text-brand-900 hover:bg-brand-100 active:bg-brand-200",
  outline: "border border-rule-2 bg-surface text-ink hover:border-brand-300 hover:bg-brand-50",
  ghost: "bg-transparent text-ink-2 hover:bg-sunken hover:text-ink",
  danger: "bg-danger text-white shadow-soft hover:brightness-95 active:brightness-90",
  inverse: "bg-paper text-ink hover:bg-white active:bg-cream-200",
  ghostInverse: "border border-white/25 bg-transparent text-white hover:bg-white/10",
};

const SIZE: Record<Size, string> = {
  // 44px is the floor for anything a thumb has to find. `sm` is 36px and is
  // only for controls inside a dense admin table, where a mouse is a given.
  sm: "h-9 gap-1.5 px-3 text-[0.8125rem]",
  md: "h-11 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-[0.9375rem]",
  icon: "size-11 shrink-0",
};

const BASE = cn(
  "relative inline-flex select-none items-center justify-center rounded-control font-medium",
  "whitespace-nowrap transition-[background-color,border-color,color,box-shadow,filter] duration-150",
  "disabled:cursor-not-allowed disabled:opacity-70",
);

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  /** Full width. Use on form submits and primary CTAs in a narrow column. */
  block?: boolean;
  /** Shown in place of the label while loading, e.g. "Signing in…". */
  loadingLabel?: string;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  isLoading = false,
  block = false,
  loadingLabel,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], block && "w-full", className)}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * A link that looks like a button. Separate component rather than an `asChild`
 * prop so the anchor keeps its real semantics — right-click, middle-click and
 * prefetch all still work, which matters for navigation CTAs.
 */
export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  block = false,
  href,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Link> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(BASE, VARIANT[variant], SIZE[size], block && "w-full", className)}
      {...props}
    >
      {children}
    </Link>
  );
}

/**
 * The quiet inline action: "Forgot password?", "Change", "View all".
 * Underlined on hover only, so a paragraph of links does not look striped.
 */
export function TextButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "rounded text-sm font-medium text-brand-700 underline-offset-4 transition-colors",
        "hover:text-brand-800 hover:underline disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

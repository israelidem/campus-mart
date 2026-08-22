import * as React from "react";

import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Empty, error and loading states.
 *
 * These were the three biggest gaps in the old frontend: an empty list printed
 * nothing at all, a failure printed a raw message, and a pending request
 * printed "Loading…". All three left the student unsure whether the app was
 * working. Each state here is a designed answer to "what do I do now?" — every
 * one of them offers a next step.
 */

/**
 * Nothing here yet.
 *
 * `title` states the fact, `description` gives a reason to care, `action` is
 * the way out. An empty state without an action is a dead end, so the action
 * is strongly encouraged even where it is technically optional.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-rule-2 bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-[38ch] text-sm leading-relaxed text-ink-2">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Something went wrong.
 *
 * Deliberately does not print the exception. A student cannot act on
 * "PrismaClientKnownRequestError", and a message from the server may leak
 * internals; `detail` is for the sentences we chose to show.
 */
export function ErrorState({
  title = "Something went wrong",
  detail,
  onRetry,
  retryLabel = "Try again",
  className,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-danger/20 bg-danger-soft px-6 py-10 text-center",
        className,
      )}
      role="alert"
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-white text-danger">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {detail ? (
        <p className="mx-auto mt-1.5 max-w-[42ch] text-sm leading-relaxed text-ink-2">{detail}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-control bg-ink px-5 text-sm font-medium text-white transition-colors hover:bg-brand-900"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A blocked state with an explanation — awaiting verification, store not yet
 * approved, campus suspended. Distinct from an error: nothing failed, the
 * account simply cannot do this yet, and telling the user *who* is acting next
 * is the whole point.
 */
export function GateState({
  title,
  description,
  status,
  action,
  className,
}: {
  title: string;
  description: string;
  status?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-rule bg-surface p-5 sm:p-6", className)}>
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {status}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{description}</p>
          {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Base skeleton block. Composed into content-shaped skeletons below. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-lg", className)} />;
}

/**
 * Product-card skeleton, matching the real card's aspect ratio and line count
 * so the grid does not jump when data lands. Shape-matching is the entire
 * point of a skeleton — a generic grey box just moves the layout shift later.
 */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-rule bg-surface">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      role="status"
      aria-label="Loading products"
    >
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Row skeleton for lists: orders, deliveries, admin queues. */
export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-rule bg-surface p-4">
      <Skeleton className="size-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-8 w-20 shrink-0" />
    </div>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Inline "working on it" for a region that is being refreshed rather than
 * loaded for the first time. Polite live region, so a screen reader announces
 * it without interrupting.
 */
export function InlineLoading({ label = "Loading" }: { label?: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 py-6 text-sm text-ink-2"
    >
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600"
      />
      {label}
    </p>
  );
}

/**
 * A short, coloured explanation attached to a form or a panel: a validation
 * summary, a rejection note from an admin, a warning about a deadline.
 */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger" | "brand";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info/20 bg-info-soft text-ink",
    success: "border-success/20 bg-success-soft text-ink",
    warning: "border-warning/25 bg-warning-soft text-ink",
    danger: "border-danger/20 bg-danger-soft text-ink",
    brand: "border-brand-200 bg-brand-50 text-brand-900",
  }[tone];

  return (
    <div
      className={cn("rounded-control border px-3.5 py-3 text-sm leading-relaxed", tones, className)}
      role={tone === "danger" ? "alert" : undefined}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1 text-ink-2")}>{children}</div> : null}
    </div>
  );
}

/**
 * Convenience empty state for "you have nothing, go and shop" — the exact copy
 * from §22, in one place so the cart, orders and search all agree.
 */
export function BrowseMarketplaceEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      icon={
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M4 7h16l-1.3 11.2a2 2 0 01-2 1.8H7.3a2 2 0 01-2-1.8L4 7z" strokeLinejoin="round" />
          <path d="M9 7V5.5a3 3 0 016 0V7" strokeLinecap="round" />
        </svg>
      }
      action={<ButtonLink href="/marketplace">Browse marketplace</ButtonLink>}
    />
  );
}

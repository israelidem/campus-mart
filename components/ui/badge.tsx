import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Status badges and chips.
 *
 * Domain statuses arrive from Prisma as `PENDING_VERIFICATION`,
 * `AWAITING_PICKUP`, `PAID_TO_VENDOR` and so on. Screens were each doing their
 * own `.replaceAll("_", " ").toLowerCase()` and picking their own colour, which
 * is why the same order could look neutral on one screen and alarming on the
 * next. `statusTone` maps every status in the schema to a tone once, here.
 */

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 ring-rule",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/20",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
};

/**
 * Every status the product can show, mapped to a tone.
 *
 * Grouped by meaning rather than by model: "something is wrong" is red
 * wherever it appears, "waiting on someone" is amber, "finished well" is green.
 * A status not listed here falls back to neutral, which is the safe default —
 * an unknown status should look unremarkable, not alarming.
 */
const STATUS_TONE: Record<string, Tone> = {
  // Verification lifecycle
  DRAFT: "neutral",
  PENDING_VERIFICATION: "warning",
  UNDER_REVIEW: "warning",
  APPROVED: "success",
  VERIFIED: "success",
  ACTIVE: "success",
  REJECTED: "danger",
  SUSPENDED: "danger",
  INACTIVE: "neutral",

  // Orders
  PENDING_PAYMENT: "warning",
  AWAITING_VENDOR: "warning",
  PREPARING: "info",
  READY_FOR_PICKUP: "info",
  AWAITING_PICKUP: "info",
  IN_TRANSIT: "info",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
  EXPIRED: "neutral",

  // Deliveries
  PENDING: "warning",
  AVAILABLE: "brand",
  ACCEPTED: "info",
  PICKED_UP: "info",
  ARRIVED: "info",
  FAILED: "danger",

  // Payments
  PAID: "success",
  PAID_TO_VENDOR: "success",
  UNPAID: "warning",
  REFUNDED: "info",
  HELD: "warning",

  // Disputes
  OPEN: "danger",
  RESOLVED: "success",
  WITHDRAWN: "neutral",
  DISMISSED: "neutral",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

/** `AWAITING_PICKUP` → `Awaiting pickup`. */
export function humanizeStatus(status: string): string {
  const words = status.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-[0.6875rem] font-semibold uppercase tracking-[0.04em]",
        "ring-1 ring-inset",
        TONE[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/**
 * A badge that takes a raw domain status and works out its own label and
 * colour. Screens pass the enum through untouched, so a status can never be
 * mislabelled in one place and not another.
 */
export function StatusBadge({
  status,
  className,
  label,
}: {
  status: string;
  className?: string;
  label?: string;
}) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {label ?? humanizeStatus(status)}
    </Badge>
  );
}

/**
 * Live open/closed indicator for a storefront, with a dot so it reads at a
 * glance in a dense vendor list.
 */
export function OpenBadge({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <Badge tone={isOpen ? "success" : "neutral"} className={className}>
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", isOpen ? "bg-success" : "bg-ink-3")}
      />
      {isOpen ? "Open now" : "Closed"}
    </Badge>
  );
}

/**
 * Filter chip. Renders as a button or, when `href` is given, an anchor — the
 * marketplace filters are URLs so a student can share or bookmark a search.
 */
export function Chip({
  active = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-rule-2 bg-surface text-ink-2 hover:border-brand-300 hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}

/** Small inline star + score. Used on product and vendor cards. */
export function RatingPill({
  score,
  count,
  className,
}: {
  score: number | null;
  count?: number;
  className?: string;
}) {
  if (score === null) {
    return <span className={cn("text-xs text-ink-3", className)}>No ratings yet</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-ink-2", className)}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 text-warning" fill="currentColor">
        <path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4 4.2 13.4l.7-4.3-3.1-3 4.3-.6L8 1.6z" />
      </svg>
      <span className="tabular">{score.toFixed(1)}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="text-ink-3">({count})</span>
      ) : null}
      <span className="sr-only">out of 5</span>
    </span>
  );
}

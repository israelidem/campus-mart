import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Surfaces.
 *
 * The old card used `bg-white/60` with a backdrop blur and a dark-mode variant.
 * Translucency over a warm page turned every card slightly grey, the blur cost
 * a repaint on scroll for no visual gain, and the dark variant was never
 * finished. This is opaque, cheap, and one step above the paper.
 *
 * `flush` exists because a card containing a table or a list of rows must not
 * add its own padding — the rows own their insets, and doubling them is what
 * made admin tables look inset by an arbitrary amount.
 */
export function Card({
  className,
  flush = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-card border border-rule bg-surface",
        flush ? "overflow-hidden" : "p-4 sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 space-y-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("text-base font-semibold tracking-tight text-ink", className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm leading-relaxed text-ink-2", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mt-4 flex flex-wrap items-center gap-2", className)} {...props} />
  );
}

/**
 * A single number with its label — the unit admin dashboards and the vendor
 * home are built from. Deliberately not a `Card`: stat tiles sit in tight
 * grids where a card's padding is too generous, and the whole point of §19 is
 * that not every piece of information should become a card.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "brand" | "warning" | "danger" | "success";
  className?: string;
}) {
  const toneClass = {
    neutral: "text-ink",
    brand: "text-brand-700",
    warning: "text-warning",
    danger: "text-danger",
    success: "text-success",
  }[tone];

  return (
    <div
      className={cn(
        "rounded-card border border-rule bg-surface px-4 py-3.5",
        className,
      )}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </p>
      <p className={cn("tabular mt-1.5 text-2xl font-semibold leading-none", toneClass)}>{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

/**
 * Section heading with an optional action on the right — "Popular near you /
 * See all". Used by every marketplace rail so the rhythm is identical.
 */
export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[1.0625rem] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 truncate text-sm text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

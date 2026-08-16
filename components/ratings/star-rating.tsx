"use client";

import { MAX_SCORE } from "@/lib/ratings/rating-policy";
import { cn } from "@/lib/utils";

/**
 * Stars, either as a control or as a read-out.
 *
 * One component for both because the shape must be identical: a student who
 * picked four stars should see exactly the four they later read back. Built from
 * real radio inputs when interactive, so it is keyboard-operable and announces
 * itself without any ARIA guesswork.
 */
export function StarRating({
  value,
  onChange,
  name,
  disabled,
  size = "md",
  label,
}: {
  value: number;
  onChange?: (score: number) => void;
  /** Required when interactive: groups the radios. */
  name?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
}) {
  const scores = Array.from({ length: MAX_SCORE }, (_, index) => index + 1);
  const starSize = size === "sm" ? "text-base" : "text-2xl";

  // Read-only: a plain string is kinder to a screen reader than five inputs.
  if (!onChange) {
    return (
      <span className={cn("inline-flex items-center gap-1", starSize)} aria-hidden={false}>
        <span className="sr-only">{`${value} out of ${MAX_SCORE} stars`}</span>
        {scores.map((score) => (
          <span key={score} className={score <= value ? "opacity-100" : "opacity-25"}>
            ★
          </span>
        ))}
      </span>
    );
  }

  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      {label ? <legend className="text-sm font-medium">{label}</legend> : null}
      <div className={cn("flex items-center gap-1", starSize)}>
        {scores.map((score) => (
          <label
            key={score}
            className={cn(
              "cursor-pointer transition-opacity",
              score <= value ? "opacity-100" : "opacity-30 hover:opacity-60",
              disabled && "cursor-not-allowed",
            )}
          >
            <input
              type="radio"
              name={name}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
              disabled={disabled}
              className="sr-only"
            />
            <span aria-hidden>★</span>
            <span className="sr-only">{`${score} star${score === 1 ? "" : "s"}`}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A subject's average, or an honest silence.
 *
 * Shows nothing rather than "0.0" for an unrated store: a new store has no
 * reputation, which is different from a bad one.
 */
export function RatingBadge({
  average,
  count,
  className,
}: {
  average: string | null;
  count: number;
  className?: string;
}) {
  if (!average || count === 0) {
    return <span className={cn("text-xs opacity-60", className)}>No ratings yet</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", className)}>
      <span aria-hidden>★</span>
      <span className="font-medium">{average}</span>
      <span className="opacity-60">{`(${count})`}</span>
      <span className="sr-only">{`${average} out of 5, from ${count} rating${count === 1 ? "" : "s"}`}</span>
    </span>
  );
}
